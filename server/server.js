require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const GameEngine = require('./game/gameEngine');
const RoomManager = require('./game/roomManager');

// Initialize app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const token = req.cookies?.jwt || req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Routes
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  // Replace with your actual user validation
  const validUser = username === "test" && password === "123"; // Demo only
  
  if (!validUser) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { userId: 123, username },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }).json({ message: "Logged in successfully" });
});

app.get('/protected', authenticateToken, (req, res) => {
  res.json({ message: `Hello ${req.user.username}` });
});

// Socket.IO Setup
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Socket.IO Authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.cookie?.split('=')[1];
  if (!token) return next(new Error('Authentication error'));

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = decoded;
    next();
  });
});

// Socket.IO Event Handlers
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user.username}`);

  socket.on('createRoom', (data) => {
    const roomCode = RoomManager.generateRoomCode();
    const gameState = GameEngine.initializeGame([{
      id: socket.id,
      name: socket.user.username,
      isHost: true
    }]);
    
    RoomManager.createRoom(roomCode, gameState);
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, gameState });
  });

  // Add other game event handlers...
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
