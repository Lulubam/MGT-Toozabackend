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
      ? ['https://mgt-toozabackend.onrender.com', 'https://mgt-tooza.netlify.app']
      : 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://mgt-toozabackend.onrender.com', 'https://mgt-tooza.netlify.app']
    : 'http://localhost:3000',
  credentials: true
}));
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
  agba: { name: 'Agba', level: 'advanced', avatar: '🏆' }
};

// Create room
app.post('/api/create-room', async (req, res) => {
  try {
    const { playerName } = req.body;
    if (!playerName || !playerName.trim()) {
      return res.status(400).json({ success: false, error: 'Player name is required' });
    }

    const roomCode = generateRoomCode();
    const newRoom = new Room({
      code: roomCode,
      maxPlayers: 6,
      gameState: {}
    });

    const player = new Player({
      username: playerName.trim(),
      roomCode,
      isDealer: true,
      isAI: false
    });
    
    await player.save();
    newRoom.players.push(player._id);
    await newRoom.save();

    // Initialize game engine
    gameEngines[roomCode] = new GameEngine(roomCode);
    gameEngines[roomCode].updatePlayers([player]);

    res.status(200).json({
      success: true,
      roomCode,
      playerId: player._id.toString()
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
    if (!playerName || !roomCode || !playerName.trim() || !roomCode.trim()) {
      return res.status(400).json({ success: false, error: 'Player name and room code are required' });
    }

    const room = await Room.findOne({ code: roomCode.toUpperCase() }).populate('players');
    if (!room) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }

    if (room.players.length >= room.maxPlayers) {
      return res.status(400).json({ success: false, error: 'Room is full' });
    }

    const existingPlayer = room.players.find(p => p.username === playerName.trim());
    if (existingPlayer) {
      return res.status(400).json({ success: false, error: 'Player name already taken' });
    }

    const player = new Player({
      username: playerName.trim(),
      roomCode: roomCode.toUpperCase(),
      isDealer: false,
      isAI: false
    });
    
    await player.save();
    room.players.push(player._id);
    await room.save();

    // Update game engine
    const gameEngine = gameEngines[roomCode.toUpperCase()];
    if (gameEngine) {
      const updatedRoom = await Room.findOne({ code: roomCode.toUpperCase() }).populate('players');
      gameEngine.updatePlayers(updatedRoom.players);
    }

    res.status(200).json({
      success: true,
      message: 'Joined room successfully',
      roomCode: roomCode.toUpperCase(),
      playerId: player._id.toString()
    });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-game', async ({ playerId, roomCode }) => {
    try {
      const player = await Player.findById(playerId);
      const room = await Room.findOne({ code: roomCode }).populate('players');
      
      if (!player || !room) {
        return socket.emit('error', { message: 'Invalid player or room' });
      }

      // Update player socket info
      player.socketId = socket.id;
      player.isActive = true;
      await player.save();

      playerSockets[playerId] = socket.id;
      socket.join(roomCode);

      // Initialize or get game engine
      if (!gameEngines[roomCode]) {
        gameEngines[roomCode] = new GameEngine(roomCode);
      }
      
      const gameEngine = gameEngines[roomCode];
      gameEngine.updatePlayers(room.players);
      
      // Send current game state
      io.to(roomCode).emit('game-state', gameEngine.getGameState());
      
      console.log(`Player ${player.username} joined room ${roomCode}`);
    } catch (error) {
      console.error('Error joining game:', error);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  socket.on('manage-ai', async ({ action, aiKey }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (!player) return socket.emit('error', { message: 'Player not found' });

      const room = await Room.findOne({ code: player.roomCode }).populate('players');
      const gameEngine = gameEngines[room.code];
      
      if (!gameEngine || !room) {
        return socket.emit('error', { message: 'Game not found' });
      }

      const config = AI_PLAYERS[aiKey];
      if (!config) return socket.emit('error', { message: 'Invalid AI player' });

      let result;
      if (action === 'add') {
        if (room.players.length >= 6) {
          return socket.emit('error', { message: 'Room is full (max 6 players)' });
        }
        
        const exists = room.players.find(p => p.username === config.name && p.isAI);
        if (exists) return socket.emit('error', { message: 'AI already in room' });

        // Create AI player in database
        const aiPlayer = new Player({
          username: config.name,
          roomCode: room.code,
          isAI: true,
          aiLevel: config.level,
          avatar: config.avatar,
          socketId: 'AI_PLAYER',
          isActive: true
        });
        await aiPlayer.save();
        
        room.players.push(aiPlayer._id);
        await room.save();

        // Add to game engine
        result = gameEngine.addAIPlayer(aiKey);
        
      } else if (action === 'remove') {
        const aiPlayer = room.players.find(p => p.username === config.name && p.isAI);
        if (!aiPlayer) return socket.emit('error', { message: 'AI not found' });

        // Remove from database
        await Player.findByIdAndDelete(aiPlayer._id);
        room.players = room.players.filter(p => p._id.toString() !== aiPlayer._id.toString());
        await room.save();

        // Remove from game engine
        result = gameEngine.removeAIPlayer(aiKey);
      } else {
        return socket.emit('error', { message: 'Invalid action' });
      }

      if (result.success) {
        // Update game engine with new player list
        const updatedRoom = await Room.findOne({ code: room.code }).populate('players');
        gameEngine.updatePlayers(updatedRoom.players);
        
        // Broadcast updated state
        io.to(room.code).emit('game-state', gameEngine.getGameState());
        io.to(room.code).emit('game-message', { message: result.message });
      } else {
        socket.emit('error', { message: result.error });
      }
    } catch (error) {
      console.error('Error managing AI:', error);
      socket.emit('error', { message: 'Failed to manage AI player' });
    }
  });

  socket.on('game-action', async ({ action, cardId }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (!player) return socket.emit('error', { message: 'Player not found' });

      const gameEngine = gameEngines[player.roomCode];
      if (!gameEngine) return socket.emit('error', { message: 'Game not found' });

      let result;
      if (action === 'startGame') {
        result = gameEngine.startGame();
      } else {
        result = gameEngine.handleAction(action, player._id.toString(), cardId);
      }

      if (result.success) {
        // Update room in database
        const room = await Room.findOneAndUpdate(
          { code: player.roomCode },
          { gameState: gameEngine.getGameState() },
          { new: true }
        );

        // Broadcast updated state
        io.to(player.roomCode).emit('game-state', gameEngine.getGameState());
        
        if (result.message) {
          io.to(player.roomCode).emit('game-message', { message: result.message });
        }
      } else {
        socket.emit('error', { message: result.error });
      }
    } catch (error) {
      console.error('Error handling game action:', error);
      socket.emit('error', { message: 'Game action failed' });
    }
  });

  socket.on('leave-room', async ({ playerId, roomCode }) => {
    try {
      const player = await Player.findById(playerId);
      if (player) {
        player.isActive = false;
        await player.save();
        socket.leave(roomCode);
        delete playerSockets[playerId];
        
        console.log(`Player ${player.username} left room ${roomCode}`);
      }
    } catch (error) {
      console.error('Error leaving room:', error);
    }
  });

  socket.on('disconnect', async () => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (player) {
        player.isActive = false;
        await player.save();
        delete playerSockets[player._id];
        console.log(`Player ${player.username} disconnected`);
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
