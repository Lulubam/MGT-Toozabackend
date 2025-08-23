// server.jsv8cclaude - Enhanced version with better error handling and debugging
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

const AI_PLAYERS = {
  otu: { name: 'Otu', level: 'beginner', avatar: '🤖' },
  ase: { name: 'Ase', level: 'beginner', avatar: '🎭' },
  dede: { name: 'Dede', level: 'intermediate', avatar: '🎪' },
  ogbologbo: { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
  agba: { name: 'Agba', level: 'advanced', avatar: '🏆' }
};

const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? 'https://mgt-tooza.onrender.com'
      : 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? 'https://mgt-tooza.onrender.com'
    : 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());

// Connect to MongoDB with better error handling
mongoose.connect(process.env.MONGODB_URI, {
  retryWrites: true,
  w: 'majority'
}).then(() => {
  console.log('✅ Connected to MongoDB successfully');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

const gameEngines = {};
const aiQueue = new Map();

// Enhanced AI processing function
async function processAIMove(roomCode, gameEngine) {
  if (aiQueue.has(roomCode)) return;
  
  aiQueue.set(roomCode, true);
  
  try {
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    
    const result = gameEngine.handleAIMove();
    
    if (result.success) {
      io.to(roomCode).emit('game-state', gameEngine.getGameState());
      
      if (result.message) {
        io.to(roomCode).emit('game-message', { message: result.message });
      }
      
      if (result.needsAIMove) {
        setTimeout(() => processAIMove(roomCode, gameEngine), 1000);
      }
    }
  } catch (error) {
    console.error('AI move error for room', roomCode, ':', error);
  } finally {
    aiQueue.delete(roomCode);
  }
}

// Create room endpoint
app.post('/api/create-room', async (req, res) => {
  try {
    const { playerName } = req.body;
    if (!playerName || !playerName.trim()) {
      return res.status(400).json({ success: false, error: 'Player name is required' });
    }

    const roomCode = generateRoomCode().toUpperCase();
    const newRoom = new Room({ code: roomCode, maxPlayers: 6 });
    const player = new Player({ 
      username: playerName.trim(), 
      roomCode, 
      isDealer: false,
      isAI: false,
      avatar: '👤'
    });

    await player.save();
    newRoom.players.push(player._id);
    await newRoom.save();

    gameEngines[roomCode] = new GameEngine(roomCode);
    gameEngines[roomCode].updatePlayers([player]);

    console.log(`Room created: ${roomCode} by ${playerName}`);
    res.status(200).json({ success: true, roomCode, playerId: player._id.toString() });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Join room endpoint
app.post('/api/join-room', async (req, res) => {
  try {
    const { playerName, roomCode } = req.body;
    if (!playerName || !roomCode) {
      return res.status(400).json({ success: false, error: 'Player name and room code are required' });
    }

    const room = await Room.findOne({ code: roomCode.toUpperCase() }).populate('players');
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    if (room.players.length >= 6) return res.status(400).json({ success: false, error: 'Room is full' });

    const existing = room.players.find(p => p.username === playerName.trim());
    if (existing) return res.status(400).json({ success: false, error: 'Player name taken' });

    const player = new Player({ 
      username: playerName.trim(), 
      roomCode: roomCode.toUpperCase(), 
      isAI: false,
      avatar: '👤'
    });
    await player.save();
    room.players.push(player._id);
    await room.save();

    const gameEngine = gameEngines[roomCode.toUpperCase()] || new GameEngine(roomCode.toUpperCase());
    if (!gameEngines[roomCode.toUpperCase()]) gameEngines[roomCode.toUpperCase()] = gameEngine;

    const updatedRoom = await Room.findOne({ code: roomCode.toUpperCase() }).populate('players');
    gameEngine.updatePlayers(updatedRoom.players);

    io.to(roomCode.toUpperCase()).emit('game-state', gameEngine.getGameState());

    console.log(`Player ${playerName} joined room ${roomCode.toUpperCase()}`);
    res.status(200).json({ success: true, roomCode: roomCode.toUpperCase(), playerId: player._id.toString() });
  } catch (error) {
    console.error('Join room error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Socket.IO connection handling with enhanced error handling
io.on('connection', (socket) => {
  console.log('🔌 Player connected:', socket.id);

  // Enhanced join-game handler with better error handling
  socket.on('join-game', async ({ playerId, roomCode }) => {
    console.log('📡 Join game request:', { playerId, roomCode, socketId: socket.id });
    
    try {
      // Validate input parameters
      if (!playerId || !roomCode) {
        console.error('❌ Invalid join-game parameters:', { playerId, roomCode });
        return socket.emit('error', { message: 'Missing playerId or roomCode' });
      }

      // Find player
      console.log('🔍 Looking for player:', playerId);
      const player = await Player.findById(playerId);
      if (!player) {
        console.error('❌ Player not found:', playerId);
        return socket.emit('error', { message: 'Player not found' });
      }

      // Find room
      console.log('🔍 Looking for room:', roomCode);
      const room = await Room.findOne({ code: roomCode }).populate('players');
      if (!room) {
        console.error('❌ Room not found:', roomCode);
        return socket.emit('error', { message: 'Room not found' });
      }

      // Verify player belongs to this room
      if (player.roomCode !== roomCode) {
        console.error('❌ Player room mismatch:', { playerRoom: player.roomCode, requestedRoom: roomCode });
        return socket.emit('error', { message: 'Player does not belong to this room' });
      }

      // Update player socket ID
      player.socketId = socket.id;
      player.isActive = true;
      await player.save();
      console.log('✅ Player updated with socket ID:', { playerId, socketId: socket.id });

      // Join socket room
      socket.join(roomCode);
      console.log('✅ Socket joined room:', roomCode);

      // Get or create game engine
      let gameEngine = gameEngines[roomCode];
      if (!gameEngine) {
        console.log('🎮 Creating new game engine for room:', roomCode);
        gameEngine = new GameEngine(roomCode);
        gameEngines[roomCode] = gameEngine;
      }

      // Update game engine with current players
      const updatedRoom = await Room.findOne({ code: roomCode }).populate('players');
      if (updatedRoom) {
        gameEngine.updatePlayers(updatedRoom.players);
        console.log('✅ Game engine updated with players:', updatedRoom.players.length);
      }
      
      // Trigger AI move if current player is AI
      if (gameEngine.isCurrentPlayerAI() && gameEngine.gameState.gamePhase === 'playing') {
        console.log('🤖 Triggering AI move');
        setTimeout(() => processAIMove(roomCode, gameEngine), 1000);
      }

      // Send game state to player
      const gameState = gameEngine.getGameState();
      socket.emit('game-state', gameState);
      console.log('✅ Game state sent to player:', playerId);

      // Notify other players
      socket.to(roomCode).emit('player-joined', { 
        playerId: player._id,
        username: player.username,
        avatar: player.avatar 
      });

    } catch (error) {
      console.error('❌ Join game error:', error);
      console.error('Error stack:', error.stack);
      socket.emit('error', { 
        message: 'Failed to join game', 
        details: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
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
        if (room.players.length >= 6) {
          return socket.emit('error', { message: 'Room is full' });
        }

        const existsInDB = room.players.find(p => p.username === config.name && p.isAI);
        if (existsInDB) {
          return socket.emit('error', { message: 'AI already in room' });
        }

        result = gameEngine.addAIPlayer(aiKey);
        if (!result.success) {
          return socket.emit('error', { message: result.error });
        }

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

      } else if (action === 'remove') {
        const aiPlayerInDB = room.players.find(p => p.username === config.name && p.isAI);
        if (!aiPlayerInDB) {
          return socket.emit('error', { message: 'AI not found in database' });
        }

        result = gameEngine.removeAIPlayer(aiKey);
        if (!result.success) {
          return socket.emit('error', { message: result.error });
        }

        await Player.findByIdAndDelete(aiPlayerInDB._id);
        room.players = room.players.filter(p => p._id.toString() !== aiPlayerInDB._id.toString());
        await room.save();
      } else {
        return socket.emit('error', { message: 'Invalid action' });
      }

      const updatedRoom = await Room.findOne({ code: room.code }).populate('players');
      gameEngine.updatePlayers(updatedRoom.players);
      
      io.to(room.code).emit('game-state', gameEngine.getGameState());
      io.to(room.code).emit('game-message', { message: result.message });

    } catch (error) {
      console.error('Error managing AI:', error);
      socket.emit('error', { message: 'Failed to manage AI' });
    }
  });

  socket.on('game-action', async ({ action, cardId, data }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (!player) return socket.emit('error', { message: 'Player not found' });

      const gameEngine = gameEngines[player.roomCode];
      if (!gameEngine) return socket.emit('error', { message: 'Game not found' });

      let result;
      if (action === 'startGame') {
        result = gameEngine.handleAction(action, player._id.toString(), cardId, data || {});
      } else if (action === 'playCard') {
        result = gameEngine.handleAction(action, player._id.toString(), cardId);
      } else if (action === 'adjustPoints') {
        result = gameEngine.handleAction(action, player._id.toString(), cardId, data);
      } else if (action === 'optOutLastTrick') {
        result = gameEngine.handleAction(action, player._id.toString());
      } else if (action === 'continueToNextRound') {
        result = gameEngine.dealCards();
      } else {
        return socket.emit('error', { message: 'Unknown action' });
      }

      if (result.success) {
        await Room.findOneAndUpdate(
          { code: player.roomCode },
          { gameState: gameEngine.getGameState() },
          { new: true }
        );

        io.to(player.roomCode).emit('game-state', gameEngine.getGameState());
        
        if (result.message) {
          io.to(player.roomCode).emit('game-message', { message: result.message });
        }

        if (result.dealerInfo) {
          io.to(player.roomCode).emit('dealer-selected', result.dealerInfo);
        }

        if (result.needsAIMove) {
          setTimeout(() => processAIMove(player.roomCode, gameEngine), 1000);
        }
      } else {
        socket.emit('error', { message: result.error });
      }
    } catch (error) {
      console.error('Game action error:', error);
      socket.emit('error', { message: 'Game action failed' });
    }
  });

  socket.on('disconnect', async () => {
    console.log('🔌 Player disconnected:', socket.id);
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (player) {
        player.isActive = false;
        await player.save();
        console.log('✅ Player marked as inactive:', player.username);
      }
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  });

  // Add error handling for socket errors
  socket.on('error', (error) => {
    console.error('Socket error for', socket.id, ':', error);
  });
});

// Helper function to generate room codes
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.IO server ready`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});
