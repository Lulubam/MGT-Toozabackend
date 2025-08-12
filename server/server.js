// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const GameEngine = require('./game/gameEngine');
const RoomManager = require('./game/roomManager');

// Initialize Express and Socket.IO
const app = express();
const server = http.createServer(app);

// Wide-Open CORS Configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// MongoDB Connection (Optimized for Render)
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      retryWrites: true,
      w: 'majority'
    });
    console.log('MongoDB connected to Render');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

// Socket.IO with Wide-Open CORS
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Game State Initialization
const initializeGame = (roomCode, hostPlayer) => {
  const gameState = GameEngine.initializeGame([hostPlayer]);
  RoomManager.createRoom(roomCode, gameState);
  return gameState;
};

// API Routes
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date()
  });
});

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Room Creation
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
  });

  // Room Joining
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
  });

  // Game Actions
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
    }
  });

  // Disconnection Handler
  socket.on('disconnect', () => {
    RoomManager.handleDisconnect(socket.id);
    console.log('Client disconnected:', socket.id);
  });
});

// Start Server
const startServer = async () => {
  await connectDB();
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('CORS configured to accept all origins');
  });
};

startServer();
