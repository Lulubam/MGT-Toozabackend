// server.js - Complete Trick-Taking Game Server
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

// =========================================================================
// AI Players Configuration
// =========================================================================
const AI_PLAYERS = {
  'otu': { name: 'Otu', level: 'beginner', avatar: '🤖' },
  'ase': { name: 'Ase', level: 'beginner', avatar: '🎭' },
  'dede': { name: 'Dede', level: 'intermediate', avatar: '🎪' },
  'ogbologbo': { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
  'agba': { name: 'Agba', level: 'advanced', avatar: '👑' }
};

// =========================================================================
// MongoDB Connection
// =========================================================================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trickster', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  retryWrites: true,
  w: 'majority',
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// =========================================================================
// Middleware
// =========================================================================
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// =========================================================================
// API Routes
// =========================================================================
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Create a new game room
app.post('/api/create-room', async (req, res) => {
  try {
    console.log('Create room request:', req.body);
    const { playerName } = req.body;
    
    if (!playerName || playerName.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        error: 'Player name is required' 
      });
    }

    const roomCode = generateRoomCode();
    
    // Create player first
    const player = new Player({
      username: playerName.trim(),
      roomCode: roomCode,
      isDealer: false,
      isAI: false,
      isActive: true
    });
    await player.save();
    
    // Create room with the player
    const newRoom = new Room({
      code: roomCode,
      maxPlayers: 4,
      players: [player._id]
    });
    await newRoom.save();

    // Initialize game engine
    gameEngines[roomCode] = new GameEngine(roomCode);

    console.log(`✅ Room created: ${roomCode} with player ${playerName}`);
    
    res.status(201).json({ 
      success: true, 
      message: 'Room created successfully', 
      roomCode, 
      playerId: player._id 
    });

  } catch (error) {
    console.error('❌ Error creating room:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Join an existing game room
app.post('/api/join-room', async (req, res) => {
  try {
    console.log('Join room request:', req.body);
    const { playerName, roomCode } = req.body;
    
    if (!playerName || !roomCode) {
      return res.status(400).json({ 
        success: false, 
        error: 'Player name and room code are required' 
      });
    }

    const formattedRoomCode = roomCode.trim().toUpperCase();
    const room = await Room.findOne({ code: formattedRoomCode }).populate('players');
    
    if (!room) {
      return res.status(404).json({ 
        success: false, 
        error: 'Room not found' 
      });
    }

    if (room.players.length >= room.maxPlayers) {
      return res.status(400).json({ 
        success: false, 
        error: 'Room is full' 
      });
    }

    // Check if player name already exists in room (only for human players)
    const existingPlayer = room.players.find(p => 
      p.username === playerName.trim() && !p.isAI
    );
    
    if (existingPlayer) {
      return res.status(400).json({ 
        success: false, 
        error: 'Player name already taken in this room' 
      });
    }

    const player = new Player({
      username: playerName.trim(),
      roomCode: formattedRoomCode,
      isAI: false,
      isActive: true
    });
    await player.save();
    
    room.players.push(player._id);
    await room.save();

    // Initialize game engine if it doesn't exist
    if (!gameEngines[formattedRoomCode]) {
      gameEngines[formattedRoomCode] = new GameEngine(formattedRoomCode);
    }
    
    // Update game engine with new player
    gameEngines[formattedRoomCode].updatePlayers(room.players);

    console.log(`✅ Player ${playerName} joined room: ${formattedRoomCode}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'Joined room successfully', 
      roomCode: formattedRoomCode, 
      playerId: player._id 
    });

  } catch (error) {
    console.error('❌ Error joining room:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    activeRooms: Object.keys(gameEngines).length
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Trick-Taking Card Game Server is running!',
    features: [
      'Create/Join rooms',
      'Add/Remove AI players in-game',
      'Real-time multiplayer with proper synchronization', 
      'Trick-taking game rules implementation',
      'Advanced AI with different difficulty levels',
      'Elimination-based scoring system'
    ]
  });
});

// =========================================================================
// Socket.IO Logic
// =========================================================================
const io = socketIo(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// In-memory map for game engine instances
const gameEngines = {};
const playerSockets = {}; // Track socket connections per player

io.on('connection', (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);

  // Join a game room with the socket
  socket.on('join-game', async ({ playerId, roomCode }) => {
    try {
      const player = await Player.findById(playerId);
      const room = await Room.findOne({ code: roomCode }).populate('players');
      
      if (!player || !room) {
        return socket.emit('error', { message: 'Player or room not found.' });
      }

      // Update player's socket ID and status
      player.socketId = socket.id;
      player.isActive = true;
      player.lastSeen = new Date();
      await player.save();

      // Track this player's socket connection
      playerSockets[playerId] = socket.id;

      // Join the socket room
      socket.join(roomCode);
      socket.playerInfo = { playerId, roomCode, playerName: player.username };
      console.log(`Socket ${socket.id} (${player.username}) joined room ${roomCode}`);

      // Initialize or get game engine
      if (!gameEngines[roomCode]) {
        gameEngines[roomCode] = new GameEngine(roomCode);
        // Load existing game state from database if it exists
        if (room.gameState && Object.keys(room.gameState).length > 0) {
          gameEngines[roomCode].gameState = room.gameState;
        }
      }

      // Update game state with ALL players from database
      gameEngines[roomCode].updatePlayers(room.players);
      
      // Broadcast the updated game state to ALL players in the room
      const currentGameState = gameEngines[roomCode].getGameState();
      console.log(`Broadcasting game state to room ${roomCode}:`, {
        playerCount: currentGameState.players.length,
        status: currentGameState.status,
        phase: currentGameState.gamePhase
      });
      
      io.to(roomCode).emit('game-state', currentGameState);
      io.to(roomCode).emit('player-joined', { 
        username: player.username,
        totalPlayers: room.players.length 
      });

      // Auto-process AI turn if needed
      setTimeout(() => {
        if (currentGameState.status === 'playing') {
          processAITurnChain(roomCode);
        }
      }, 1000);

    } catch (error) {
      console.error('Error in join-game:', error);
      socket.emit('error', { message: 'Failed to join game.' });
    }
  });

  // Handle game actions
  socket.on('game-action', async ({ action, data }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (!player) {
        return socket.emit('error', { message: 'Player not found.' });
      }

      const roomCode = player.roomCode;
      const gameEngine = gameEngines[roomCode];
      if (!gameEngine) {
        return socket.emit('error', { message: 'Game not found.' });
      }

      console.log(`Processing action '${action}' from ${player.username} in room ${roomCode}`, data);

      // Handle the action
      const result = gameEngine.handleAction(action, player._id, data);
      
      if (result.success) {
        // Update the database with the new game state
        const room = await Room.findOneAndUpdate(
          { code: roomCode },
          { gameState: gameEngine.getGameState() },
          { new: true, populate: 'players' }
        );
        
        // Broadcast to ALL sockets in the room
        const gameState = gameEngine.getGameState();
        console.log(`Broadcasting updated game state after ${action}:`, {
          currentPlayer: gameState.players[gameState.currentPlayerIndex]?.username,
          status: gameState.status,
          phase: gameState.gamePhase
        });
        
        io.to(roomCode).emit('game-state', gameState);
        
        if (result.message) {
          io.to(roomCode).emit('game-message', { message: result.message });
        }

        // Process AI turns in sequence
        setTimeout(() => {
          if (gameState.status === 'playing' && gameState.gamePhase === 'playing') {
            processAITurnChain(roomCode);
          }
        }, 500);

      } else {
        console.log(`Action failed: ${result.error}`);
        socket.emit('error', { message: result.error });
      }

    } catch (error) {
      console.error('Error in game-action:', error);
      socket.emit('error', { message: 'An unexpected error occurred during the game action.' });
    }
  });

  // Handle AI player management
  socket.on('manage-ai', async ({ action, aiKey }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (!player) {
        return socket.emit('error', { message: 'Player not found.' });
      }

      const roomCode = player.roomCode;
      const room = await Room.findOne({ code: roomCode }).populate('players');
      const gameEngine = gameEngines[roomCode];
      
      if (!gameEngine || !room) {
        return socket.emit('error', { message: 'Game not found.' });
      }

      let result;
      if (action === 'add') {
        // First check if we can add
        if (room.players.length >= 4) {
          return socket.emit('error', { message: 'Room is full' });
        }

        const AI_CONFIG = AI_PLAYERS[aiKey];
        if (!AI_CONFIG) {
          return socket.emit('error', { message: 'Invalid AI player' });
        }

        // Check if AI already exists in database
        const existingAI = room.players.find(p => 
          p.username === AI_CONFIG.name && p.isAI
        );
        if (existingAI) {
          return socket.emit('error', { message: 'AI player already in room' });
        }

        // Create AI player in database
        const aiPlayer = new Player({
          username: AI_CONFIG.name,
          roomCode: roomCode,
          isAI: true,
          aiLevel: AI_CONFIG.level,
          avatar: AI_CONFIG.avatar,
          isDealer: false,
          isActive: true,
          socketId: 'AI_PLAYER'
        });

        await aiPlayer.save();
        room.players.push(aiPlayer._id);
        await room.save();

        // Update game engine
        result = gameEngine.addAIPlayer(aiKey);
        result.message = `${AI_CONFIG.name} joined the game`;

      } else if (action === 'remove') {
        const AI_CONFIG = AI_PLAYERS[aiKey];
        if (!AI_CONFIG) {
          return socket.emit('error', { message: 'Invalid AI player' });
        }

        // Find and remove AI from database
        const aiPlayer = room.players.find(p => 
          p.username === AI_CONFIG.name && p.isAI
        );
        
        if (!aiPlayer) {
          return socket.emit('error', { message: 'AI player not found' });
        }

        // Remove from database
        await Player.findByIdAndDelete(aiPlayer._id);
        room.players = room.players.filter(p => p._id.toString() !== aiPlayer._id.toString());
        await room.save();

        // Update game engine
        result = gameEngine.removeAIPlayer(aiKey);
        result.message = `${AI_CONFIG.name} left the game`;

      } else {
        return socket.emit('error', { message: 'Invalid AI action.' });
      }

      if (result.success) {
        // Reload room with updated players
        const updatedRoom = await Room.findOne({ code: roomCode }).populate('players');
        gameEngine.updatePlayers(updatedRoom.players);

        // Update database and broadcast
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

  // Player leaves room
  socket.on('leave-room', async ({ playerId, roomCode }) => {
    try {
      const room = await Room.findOne({ code: roomCode }).populate('players');
      if (!room) return;

      // Remove player from database (but not AI players)
      const playerToRemove = room.players.find(p => p._id.toString() === playerId);
      if (playerToRemove && !playerToRemove.isAI) {
        await Player.findByIdAndDelete(playerId);
      }
      
      // Remove from socket tracking
      delete playerSockets[playerId];

      // Update room's player list
      room.players = room.players.filter(p => p._id.toString() !== playerId);
      await room.save();

      // Reload players to get the updated list
      const updatedRoom = await Room.findOne({ code: roomCode }).populate('players');

      // Update the game engine and broadcast
      if (gameEngines[roomCode]) {
        gameEngines[roomCode].updatePlayers(updatedRoom.players);
        io.to(roomCode).emit('game-state', gameEngines[roomCode].getGameState());
        io.to(roomCode).emit('game-message', { 
          message: `Player left the game. ${updatedRoom.players.length} players remaining.` 
        });
      }

      // Clean up empty rooms
      if (updatedRoom.players.length === 0) {
        delete gameEngines[roomCode];
        await Room.findByIdAndDelete(updatedRoom._id);
        console.log(`Room ${roomCode} is empty and has been deleted.`);
      }

    } catch (error) {
      console.error('Error leaving room:', error);
    }
  });

  socket.on('disconnect', async () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    
    try {
      // Find and update player status
      const player = await Player.findOneAndUpdate(
        { socketId: socket.id },
        { isActive: false, socketId: null, lastSeen: new Date() }
      );

      if (player && socket.playerInfo) {
        const { roomCode } = socket.playerInfo;
        
        // Remove from socket tracking
        delete playerSockets[player._id];
        
        // Update game state if room still exists
        const room = await Room.findOne({ code: roomCode }).populate('players');
        if (room && gameEngines[roomCode]) {
          gameEngines[roomCode].updatePlayers(room.players);
          io.to(roomCode).emit('game-state', gameEngines[roomCode].getGameState());
        }
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// =========================================================================
// Enhanced AI Processing Functions
// =========================================================================

// Process AI turns in sequence to avoid conflicts
async function processAITurnChain(roomCode, maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    console.log(`Max AI turn depth reached for room ${roomCode}`);
    return;
  }

  const gameEngine = gameEngines[roomCode];
  if (!gameEngine || !gameEngine.shouldProcessAITurn()) {
    return;
  }

  const currentPlayer = gameEngine.gameState.players[gameEngine.gameState.currentPlayerIndex];
  console.log(`AI Turn Chain - Processing turn for ${currentPlayer.username} (depth: ${currentDepth})`);

  try {
    // Add realistic delay for AI thinking
    const delay = getAIDelay(currentPlayer.aiLevel);
    
    setTimeout(async () => {
      const result = gameEngine.processAITurn();
      
      if (result.success) {
        // Update database
        const room = await Room.findOneAndUpdate(
          { code: roomCode },
          { gameState: gameEngine.getGameState() },
          { new: true, populate: 'players' }
        );
        
        // Broadcast the updated state
        const gameState = gameEngine.getGameState();
        io.to(roomCode).emit('game-state', gameState);
        
        if (result.message) {
          io.to(roomCode).emit('game-message', { message: result.message });
        }

        // Check if game ended
        if (result.gameOver) {
          io.to(roomCode).emit('game-over', { 
            winner: result.gameWinner,
            message: result.message 
          });
          return;
        }

        // Continue AI chain if next player is also AI
        setTimeout(() => {
          processAITurnChain(roomCode, maxDepth, currentDepth + 1);
        }, 500);
        
      } else {
        console.error(`AI turn failed for ${currentPlayer.username}:`, result.error);
        io.to(roomCode).emit('game-message', { 
          message: `${currentPlayer.username} encountered an error and skipped their turn.` 
        });
        
        // Skip to next player
        gameEngine.nextPlayer();
        setTimeout(() => {
          processAITurnChain(roomCode, maxDepth, currentDepth + 1);
        }, 1000);
      }
    }, delay);
    
  } catch (error) {
    console.error(`Error in AI turn chain for room ${roomCode}:`, error);
  }
}

function getAIDelay(aiLevel) {
  switch(aiLevel) {
    case 'beginner': return Math.random() * 2000 + 1000; // 1-3 seconds
    case 'intermediate': return Math.random() * 1500 + 1500; // 1.5-3 seconds  
    case 'advanced': return Math.random() * 1000 + 2000; // 2-3 seconds
    default: return 1500;
  }
}

// =========================================================================
// Enhanced Cleanup Routine
// =========================================================================
setInterval(async () => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Delete inactive human players (keep AI players that are in active rooms)
    const inactiveHumanPlayers = await Player.find({ 
      isAI: false,
      $or: [
        { socketId: null, updatedAt: { $lt: oneDayAgo } },
        { isActive: false, updatedAt: { $lt: oneDayAgo } }
      ]
    });
    
    for (const player of inactiveHumanPlayers) {
      await Player.findByIdAndDelete(player._id);
      
      // Clean up AI players in empty rooms
      const room = await Room.findOne({ code: player.roomCode }).populate('players');
      if (room) {
        room.players = room.players.filter(p => p._id.toString() !== player._id.toString());
        if (room.players.length === 0) {
          await Player.deleteMany({ roomCode: player.roomCode, isAI: true });
          await Room.findByIdAndDelete(room._id);
          delete gameEngines[player.roomCode];
          console.log(`Cleaned up empty room: ${player.roomCode}`);
        } else {
          await room.save();
        }
      }
    }
    
    console.log(`Cleanup completed - removed ${inactiveHumanPlayers.length} inactive players`);
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}, 60 * 60 * 1000); // Run every hour

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🎮 Trick-Taking Game Server running on port ${PORT}`));
