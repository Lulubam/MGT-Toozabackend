// server.js
require('dotenv').config();
const GameEngine = require('./game/GameEngine');
const Player = require('./models/Player');
const Room = require('./models/Room');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? 'https://mgt-toozabackend.onrender.com' 
      : 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trickgame', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const gameEngines = {};

// AI Players Configuration
const AI_PLAYERS = {
  otu: { name: 'Otu', level: 'beginner', avatar: '🤖' },
  ase: { name: 'Ase', level: 'beginner', avatar: '🎭' },
  dede: { name: 'Dede', level: 'intermediate', avatar: '🎪' },
  ogbologbo: { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
  agba: { name: 'Agba', level: 'advanced', avatar: '👑' }
};

// Create room
app.post('/api/rooms', async (req, res) => {
  const { playerName } = req.body;
  if (!playerName) {
    return res.status(400).json({ success: false, error: 'Player name is required' });
  }

  const roomCode = generateRoomCode();
  const room = new Room({ code: roomCode, maxPlayers: 4 });
  await room.save();

  const player = new Player({ username: playerName, roomCode, isDealer: false, isAI: false });
  room.players.push(player._id);
  await player.save();
  await room.save();

  gameEngines[roomCode] = new GameEngine(roomCode);
  gameEngines[roomCode].updatePlayers(room.players);

  res.status(200).json({
    success: true,
    roomCode,
    playerId: player._id
  });
});

// Join room
app.post('/api/rooms/join', async (req, res) => {
  const { playerName, roomCode } = req.body;
  if (!playerName || !roomCode) {
    return res.status(400).json({ success: false, error: 'Player name and room code are required' });
  }

  const room = await Room.findOne({ code: roomCode }).populate('players');
  if (!room) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }

  if (room.players.length >= room.maxPlayers) {
    return res.status(400).json({ success: false, error: 'Room is full' });
  }

  const existingPlayer = room.players.find(p => p.username === playerName);
  if (existingPlayer) {
    return res.status(400).json({ success: false, error: 'Player name already taken in this room' });
  }

  const player = new Player({ username: playerName, roomCode, isDealer: false, isAI: false });
  room.players.push(player._id);
  await player.save();
  await room.save();

  const gameEngine = gameEngines[roomCode] || new GameEngine(roomCode);
  if (!gameEngines[roomCode]) {
    gameEngines[roomCode] = gameEngine;
  }
  gameEngine.updatePlayers(room.players);

  res.status(200).json({
    success: true,
    message: 'Joined room successfully',
    roomCode,
    playerId: player._id
  });
});

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join-game', async ({ playerId, roomCode }) => {
    try {
      const player = await Player.findById(playerId);
      if (!player || player.roomCode !== roomCode) {
        return socket.emit('error', { message: 'Invalid player or room' });
      }

      socket.join(roomCode);
      socket.playerId = playerId;
      socket.roomCode = roomCode;

      const room = await Room.findOne({ code: roomCode }).populate('players');
      let gameEngine = gameEngines[roomCode];
      if (!gameEngine) {
        gameEngine = new GameEngine(roomCode);
        gameEngines[roomCode] = gameEngine;
      }
      gameEngine.updatePlayers(room.players);

      io.to(roomCode).emit('game-state', gameEngine.getGameState());
      socket.emit('game-message', { message: 'Welcome to the game!' });
    } catch (error) {
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  socket.on('manage-ai', async ({ action, aiKey, roomCode }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (!player) {
        return socket.emit('error', { message: 'Player not found.' });
      }

      const room = await Room.findOne({ code: roomCode }).populate('players');
      const gameEngine = gameEngines[roomCode];
      if (!gameEngine || !room) {
        return socket.emit('error', { message: 'Game not found.' });
      }

      let result;
      if (action === 'add') {
        if (room.players.length >= 4) {
          return socket.emit('error', { message: 'Room is full' });
        }

        const config = AI_PLAYERS[aiKey];
        if (!config) {
          return socket.emit('error', { message: 'Invalid AI player' });
        }

        const existingAI = room.players.find(p => p.username === config.name && p.isAI);
        if (existingAI) {
          return socket.emit('error', { message: 'AI player already in room' });
        }

        const aiPlayer = new Player({
          username: config.name,
          roomCode: roomCode,
          isAI: true,
          aiLevel: config.level,
          avatar: config.avatar,
          socketId: 'AI_PLAYER'
        });
        await aiPlayer.save();
        room.players.push(aiPlayer._id);
        await room.save();

        result = gameEngine.addAIPlayer(aiKey);
      } else if (action === 'remove') {
        const config = AI_PLAYERS[aiKey];
        if (!config) {
          return socket.emit('error', { message: 'Invalid AI player' });
        }

        const aiPlayer = room.players.find(p => p.username === config.name && p.isAI);
        if (!aiPlayer) {
          return socket.emit('error', { message: 'AI player not found' });
        }

        await Player.findByIdAndDelete(aiPlayer._id);
        room.players = room.players.filter(p => p._id.toString() !== aiPlayer._id.toString());
        await room.save();

        result = gameEngine.removeAIPlayer(aiKey);
      } else {
        return socket.emit('error', { message: 'Invalid AI action.' });
      }

      if (result.success) {
        const updatedRoom = await Room.findOne({ code: roomCode }).populate('players');
        gameEngine.updatePlayers(updatedRoom.players);
        await Room.findOneAndUpdate(
          { code: roomCode },
          { gameState: gameEngine.getGameState() },
          { new: true }
        );
        io.to(roomCode).emit('game-state', gameEngine.getGameState());
        io.to(roomCode).emit('game-message', { message: result.message });
      } else {
        socket.emit('error', { message: result.error });
      }
    } catch (error) {
      console.error('Error managing AI:', error);
      socket.emit('error', { message: 'Failed to manage AI player.' });
    }
  });

  socket.on('game-action', async ({ action, playerId, cardId }) => {
    try {
      const player = await Player.findById(playerId);
      if (!player) {
        return socket.emit('error', { message: 'Player not found.' });
      }

      const roomCode = player.roomCode;
      const gameEngine = gameEngines[roomCode];
      if (!gameEngine) {
        return socket.emit('error', { message: 'Game not found.' });
      }

      const result = await gameEngine.handleAction(action, playerId, cardId);
      if (result.success) {
        io.to(roomCode).emit('game-state', gameEngine.getGameState());
        if (result.message) {
          io.to(roomCode).emit('game-message', { message: result.message });
        }
      } else {
        socket.emit('error', { message: result.error });
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('disconnect', async () => {
    const player = await Player.findOne({ socketId: socket.id });
    if (player) {
      const room = await Room.findOne({ code: player.roomCode }).populate('players');
      if (room) {
        room.players = room.players.filter(p => p._id.toString() !== player._id.toString());
        if (room.players.length === 0) {
          await Player.deleteMany({ roomCode: player.roomCode, isAI: true });
          await Room.findByIdAndDelete(room._id);
          delete gameEngines[player.roomCode];
        } else {
          await room.save();
        }
        io.to(player.roomCode).emit('game-state', gameEngines[player.roomCode]?.getGameState());
      }
    }
    console.log('Client disconnected:', socket.id);
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}
