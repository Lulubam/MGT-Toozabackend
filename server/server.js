require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://mgt-tooza.onrender.com',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Socket.IO Setup
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'https://mgt-tooza.onrender.com',
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// JWT Verification Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.cookie?.split('=')[1];
  if (!token) return next(new Error('Authentication error'));
  
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = decoded;
    next();
  });
});

// Socket.IO Events
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user?.username || 'Anonymous'}`);

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });

  // Add your game event handlers here
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}`);
});
