require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const GameEngine = require('./game/gameEngine');
const RoomManager = require('./game/roomManager');

// Initialize Express and HTTP server
const app = express();
const server = http.createServer(app);

// Environment variables
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mgt-tooza.onrender.com';
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// Secure CORS configuration
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Additional security headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('X-Content-Type-Options', 'nosniff');
  next();
});

// MongoDB connection (optimized for production)
const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      retryWrites: true,
      w: 'majority'
    });
    console.log('✅ MongoDB connected successfully');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

// Secure Socket.IO configuration
const io = socketIo(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true
  }
});

// Socket.IO authentication middleware
io.use((socket, next) => {
  const { token } = socket.handshake.auth;
  // Add your JWT/API key validation logic here
  if (process.env.NODE_ENV === 'development' || isValidToken(token)) {
    return next();
  }
  next(new Error('Authentication error'));
});

// Game initialization
const initializeGame = (roomCode, hostPlayer) => {
  const gameState = GameEngine.initializeGame([hostPlayer]);
  RoomManager.createRoom(roomCode, gameState);
  return gameState;
};

// API routes
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date()
  });
});

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  socket.on('createRoom', ({ playerName, avatar }) => {
    const roomCode = RoomManager.generateRoomCode();
    const gameState = initializeGame(roomCode, {
      id: socket.id,
      name: playerName,
      avatar,
      isHost: true
    });
    
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, gameState });
    console.log(`🚪 Room created: ${roomCode}`);
  });

  socket.on('joinRoom', ({ roomCode, playerName, avatar }) => {
    const room = RoomManager.getRoom(roomCode);
    if (!room || room.players.length >= 8) {
      return socket.emit('error', 'Room full or not found');
    }

    const newPlayer = {
      id: socket.id,
      name: playerName,
      avatar,
      isHost: false
    };

    GameEngine.addPlayer(room.gameState, newPlayer);
    socket.join(roomCode);
    io.to(roomCode).emit('playerJoined', newPlayer);
    console.log(`🎮 Player joined: ${playerName} in ${roomCode}`);
  });

  socket.on('gameAction', ({ roomCode, action, data }) => {
    const room = RoomManager.getRoom(roomCode);
    if (!room) return;

    try {
      const updatedState = GameEngine.handleAction(
        room.gameState,
        action,
        { ...data, playerId: socket.id }
      );
      
      room.gameState = updatedState;
      io.to(roomCode).emit('gameUpdate', updatedState);
    } catch (err) {
      socket.emit('error', err.message);
      console.error(`⚠️ Action error: ${err.message}`);
    }
  });

  socket.on('disconnect', () => {
    RoomManager.handleDisconnect(socket.id);
    console.log(`❌ Disconnected: ${socket.id}`);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('🔥 Server error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const startServer = async () => {
  await connectDB();
  server.listen(PORT, () => {
    console.log(`
      🚀 Server running on port ${PORT}
      🌐 CORS configured for: ${FRONTEND_URL}
      📡 Socket.IO ready (${Object.keys(io.engine.clients).length} active connections)
    `);
  });
};

startServer();

// Helper function (replace with your auth logic)
function isValidToken(token) {
  // Implement JWT verification or API key check
  return !!token; // Simplified for example
}
