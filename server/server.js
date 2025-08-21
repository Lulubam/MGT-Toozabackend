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
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trickgame', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const gameEngines = {};
const playerSockets = {};

const AI_PLAYERS = {
  otu: { name: 'Otu', level: 'beginner', avatar: '🤖' },
  ase: { name: 'Ase', level: 'beginner', avatar: '🎭' },
  dede: { name: 'Dede', level: 'intermediate', avatar: '🎪' },
  ogbologbo: { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
  agba: { name: 'Agba', level: 'advanced', avatar: '👑' }
};

// Create room
app.post('/api/create-room', async (req, res) => {
  try {
    const { playerName } = req.body;
    if (!playerName) {
      return res.status(400).json({ success: false, error: 'Player name is required' });
    }

    const roomCode = generateRoomCode();
    const newRoom = new Room({
      code: roomCode,
      maxPlayers: 4,
      gameState: new GameEngine(roomCode).getGameState()
    });
    await newRoom.save();

    const player = new Player({
      username: playerName,
      roomCode,
      isDealer: true,
      isAI: false
    });
    newRoom.players.push(player._id);
    await player.save();
    await newRoom.save();

    gameEngines[roomCode] = new GameEngine(roomCode);
    gameEngines[roomCode].updatePlayers(newRoom.players);

    res.status(200).json({
      success: true,
      roomCode,
      playerId: player._id
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Join room
app.post('/api/join-room', async (req, res) => {
  try {
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
      return res.status(400).json({ success: false, error: 'Player name already taken' });
    }

    const player = new Player({
      username: playerName,
      roomCode,
      isDealer: false,
      isAI: false
    });
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
      message: 'Joined room',
      roomCode,
      playerId: player._id
    });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  socket.on('join-game', async ({ playerId, roomCode }) => {
    try {
      const player = await Player.findById(playerId);
      const room = await Room.findOne({ code: roomCode }).populate('players');
      if (!player || !room) {
        return socket.emit('error', { message: 'Invalid player or room' });
      }

      player.socketId = socket.id;
      player.isActive = true;
      await player.save();

      playerSockets[playerId] = socket.id;
      socket.join(roomCode);

      const gameEngine = gameEngines[roomCode];
      if (gameEngine) {
        gameEngine.updatePlayers(room.players);
      }

      io.to(roomCode).emit('game-state', gameEngine?.getGameState());
    } catch (error) {
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  socket.on('manage-ai', async ({ action, aiKey }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (!player) return socket.emit('error', { message: 'Player not found' });

      const room = await Room.findOne({ code: player.roomCode }).populate('players');
      const gameEngine = gameEngines[room.code];
      if (!gameEngine || !room) return socket.emit('error', { message: 'Game not found' });

      const config = AI_PLAYERS[aiKey];
      if (!config) return socket.emit('error', { message: 'Invalid AI player' });

      let result;
      if (action === 'add') {
        if (room.players.length >= 4) return socket.emit('error', { message: 'Room is full' });
        const exists = room.players.find(p => p.username === config.name && p.isAI);
        if (exists) return socket.emit('error', { message: 'AI already in room' });

        const aiPlayer = new Player({
          username: config.name,
          roomCode: room.code,
          isAI: true,
          aiLevel: config.level,
          avatar: config.avatar,
          socketId: 'AI_PLAYER'
        });
        await aiPlayer.save();
        room.players.push(aiPlayer._id);
        await room.save();

        result = gameEngine.addAIPlayer(aiKey);
        result.message = `${config.name} joined the game`;
      } else if (action === 'remove') {
        const aiPlayer = room.players.find(p => p.username === config.name && p.isAI);
        if (!aiPlayer) return socket.emit('error', { message: 'AI not found' });

        await Player.findByIdAndDelete(aiPlayer._id);
        room.players = room.players.filter(p => p._id.toString() !== aiPlayer._id.toString());
        await room.save();

        result = gameEngine.removeAIPlayer(aiKey);
        result.message = `${config.name} left the game`;
      } else {
        return socket.emit('error', { message: 'Invalid action' });
      }

      if (result.success) {
        const updatedRoom = await Room.findOne({ code: room.code }).populate('players');
        gameEngine.updatePlayers(updatedRoom.players);
        await Room.findOneAndUpdate({ code: room.code }, { gameState: gameEngine.getGameState() });
        io.to(room.code).emit('game-state', gameEngine.getGameState());
        io.to(room.code).emit('game-message', { message: result.message });
      } else {
        socket.emit('error', { message: result.error });
      }
    } catch (error) {
      console.error('Error managing AI:', error);
      socket.emit('error', { message: 'Failed to manage AI' });
    }
  });

  socket.on('game-action', async ({ action, cardId }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (!player) return socket.emit('error', { message: 'Player not found' });

      const gameEngine = gameEngines[player.roomCode];
      if (!gameEngine) return socket.emit('error', { message: 'Game not found' });

      const result = gameEngine.handleAction(action, player._id, cardId);
      if (result.success) {
        io.to(player.roomCode).emit('game-state', gameEngine.getGameState());
        if (result.message) {
          io.to(player.roomCode).emit('game-message', { message: result.message });
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
      player.isActive = false;
      await player.save();
      delete playerSockets[player._id];
    }
  });
});

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
