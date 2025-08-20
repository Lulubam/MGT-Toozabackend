// server.js - Fixed Server with Proper AI Management
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
  otu: { name: 'Otu', level: 'beginner', avatar: '🤖' },
  ase: { name: 'Ase', level: 'beginner', avatar: '🎭' },
  dede: { name: 'Dede', level: 'intermediate', avatar: '🎪' },
  ogbologbo: { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
  agba: { name: 'Agba', level: 'advanced', avatar: '👑' }
};

// =========================================================================
// Middleware
// =========================================================================
app.use(cors());
app.use(express.json());

// =========================================================================
// Database Connection
// =========================================================================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trickgame', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// =========================================================================
// API Routes - Fixed for Better Player Management
// =========================================================================

// Create a new game room
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

    const player = new Player({
      username: playerName,
      roomCode: roomCode,
      isDealer: true,
      isAI: false
    });

    newRoom.players.push(player._id);
    await newRoom.save();
    await player.save();

    console.log(`Room created: ${roomCode} with player ${playerName}`);
    res.status(201).json({
      success: true,
      message: 'Room created successfully',
      roomCode,
      playerId: player._id
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Join an existing game room
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
      roomCode: roomCode,
      isDealer: false,
      isAI: false
    });

    room.players.push(player._id);
    await player.save();
    await room.save();

    console.log(`Player ${playerName} joined room ${roomCode}`);
    res.status(200).json({
      success: true,
      message: 'Joined room successfully',
      playerId: player._id
    });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
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
// Socket.IO Logic - Enhanced for Better Sync
// =========================================================================
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// In-memory map for game engine instances
const gameEngines = {};
const playerSockets = {}; // Track socket connections per player

io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // Join a game room with the socket - FIXED for proper sync
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

      // Attach player info to socket
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
      io.to(roomCode).emit('game-state', gameEngines[roomCode].getGameState());
      socket.emit('game-message', { message: 'Welcome to the game!' });
    } catch (error) {
      console.error('Error in join-game:', error);
      socket.emit('error', { message: 'Failed to join game.' });
    }
  });

  // Handle game actions - ENHANCED
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
      let result;
      switch (action) {
        case 'startGame':
          result = gameEngine.startGame(data.playerId);
          break;
        case 'playCard':
          result = await gameEngine.handleAction('play-card', data.playerId, data.cardId);
          break;
        case 'dealCards':
          result = gameEngine.dealCards();
          break;
        case 'addAI':
          result = gameEngine.addAIPlayer(data.aiKey);
          break;
        case 'removeAI':
          result = gameEngine.removeAIPlayer(data.aiKey);
          break;
        default:
          return socket.emit('error', { message: 'Unknown action' });
      }

      if (result.success) {
        // Save updated game state to database
        await Room.findOneAndUpdate(
          { code: roomCode },
          { gameState: gameEngine.getGameState() },
          { new: true }
        );

        // Broadcast updated state
        io.to(roomCode).emit('game-state', gameEngine.getGameState());
        if (result.message) {
          io.to(roomCode).emit('game-message', { message: result.message });
        }

        // Process AI turns in sequence
        setTimeout(() => {
          if (gameEngine.getGameState().status === 'playing' && gameEngine.getGameState().gamePhase === 'playing') {
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

  // Handle AI player management - FIXED TO SAVE TO DATABASE
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
        if (room.players.length >= 4) {
          return socket.emit('error', { message: 'Room is full' });
        }

        const AI_CONFIG = AI_PLAYERS[aiKey];
        if (!AI_CONFIG) {
          return socket.emit('error', { message: 'Invalid AI player' });
        }

        const existingAI = room.players.find(p => p.username === AI_CONFIG.name && p.isAI);
        if (existingAI) {
          return socket.emit('error', { message: 'AI player already in room' });
        }

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

        result = gameEngine.addAIPlayer(aiKey);
      } else if (action === 'remove') {
        const AI_CONFIG = AI_PLAYERS[aiKey];
        if (!AI_CONFIG) {
          return socket.emit('error', { message: 'Invalid AI player' });
        }

        const aiPlayer = room.players.find(p => p.username === AI_CONFIG.name && p.isAI);
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

  // Player leaves room - ENHANCED
  socket.on('leave-room', async ({ playerId, roomCode }) => {
    try {
      const room = await Room.findOne({ code: roomCode }).populate('players');
      if (!room) return;

      const player = room.players.find(p => p._id.toString() === playerId.toString() && !p.isAI);
      if (player) {
        await Player.findByIdAndDelete(playerId);
        room.players = room.players.filter(p => p._id.toString() !== playerId.toString());
        await room.save();
      }

      if (room.players.length === 0) {
        await Room.findByIdAndDelete(room._id);
        delete gameEngines[roomCode];
      } else {
        const gameEngine = gameEngines[roomCode];
        if (gameEngine) {
          gameEngine.updatePlayers(room.players);
          io.to(roomCode).emit('game-state', gameEngine.getGameState());
        }
      }
    } catch (error) {
      console.error('Error leaving room:', error);
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log(`Client disconnected: ${socket.id}`);
    try {
      const player = await Player.findOneAndUpdate(
        { socketId: socket.id },
        { isActive: false, socketId: null, lastSeen: new Date() }
      );

      if (player && socket.playerInfo) {
        const { roomCode } = socket.playerInfo;
        delete playerSockets[player._id];

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
async function processAITurnChain(roomCode, maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    console.log(`Max AI turn depth reached for room ${roomCode}`);
    return;
  }

  const gameEngine = gameEngines[roomCode];
  if (!gameEngine) return;

  const gameState = gameEngine.getGameState();
  if (gameState.status !== 'playing' || gameState.gamePhase !== 'playing') return;

  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  if (!currentPlayer || !currentPlayer.isAI || currentPlayer.isEliminated) {
    gameEngine.nextPlayer();
    return setTimeout(() => processAITurnChain(roomCode, maxDepth, currentDepth + 1), 100);
  }

  const aiDelay = getAIDelay(currentPlayer.aiLevel);
  setTimeout(async () => {
    try {
      const cardToPlay = selectAICard(gameEngine, currentPlayer);
      if (!cardToPlay) {
        console.log(`AI ${currentPlayer.username} has no valid card`);
        gameEngine.nextPlayer();
        return processAITurnChain(roomCode, maxDepth, currentDepth + 1);
      }

      const result = await gameEngine.handleAction('play-card', currentPlayer._id, cardToPlay.id);
      if (result.success) {
        await Room.findOneAndUpdate(
          { code: roomCode },
          { gameState: gameEngine.getGameState() },
          { new: true }
        );
        io.to(roomCode).emit('game-state', gameEngine.getGameState());
        if (result.message) {
          io.to(roomCode).emit('game-message', { message: result.message });
        }
      } else {
        io.to(roomCode).emit('game-message', {
          message: `${currentPlayer.username} encountered an error and skipped their turn.`
        });
        gameEngine.nextPlayer();
      }
      processAITurnChain(roomCode, maxDepth, currentDepth + 1);
    } catch (error) {
      console.error(`Error in AI turn chain for room ${roomCode}:`, error);
    }
  }, aiDelay);
}

function getAIDelay(aiLevel) {
  switch(aiLevel) {
    case 'beginner': return Math.random() * 2000 + 1000; // 1-3 seconds
    case 'intermediate': return Math.random() * 1500 + 1500; // 1.5-3 seconds
    case 'advanced': return Math.random() * 1000 + 1000; // 1-2 seconds
    default: return 2000;
  }
}

function selectAICard(gameEngine, player) {
  const validCards = player.cards.filter(card => {
    if (gameEngine.gameState.currentTrick.length === 0) return true;
    if (gameEngine.gameState.callingSuit === null) return true;
    return card.suit === gameEngine.gameState.callingSuit;
  });

  if (validCards.length === 0) return player.cards[0];
  return validCards[Math.floor(Math.random() * validCards.length)];
}

// =========================================================================
// Helper Functions
// =========================================================================
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// =========================================================================
// Start Server
// =========================================================================
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
