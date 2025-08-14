require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // For testing only - restrict in production
    methods: ["GET", "POST"]
  }
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/card-game', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => console.log('Connected to MongoDB'));

// MongoDB Schemas
const roomSchema = new mongoose.Schema({
  code: String,
  gameState: Object,
  createdAt: { type: Date, default: Date.now, expires: 86400 } // Auto-delete after 24h
});
const Room = mongoose.model('Room', roomSchema);

const playerSchema = new mongoose.Schema({
  id: String,
  roomCode: String,
  name: String,
  socketId: String
});
const Player = mongoose.model('Player', playerSchema);

app.use(cors());
app.use(express.json());

// Import game logic
const GameEngine = require('./gameEngine');

const PORT = process.env.PORT || 3001;

// HTTP Routes
app.post('/api/create-room', async (req, res) => {
  const { playerName } = req.body;
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const playerId = uuidv4();
  
  const game = new GameEngine(roomCode);
  game.addPlayer(playerId, playerName);
  
  // Save to MongoDB
  const room = new Room({
    code: roomCode,
    gameState: game.getGameState()
  });
  
  const player = new Player({
    id: playerId,
    roomCode,
    name: playerName
  });

  try {
    await room.save();
    await player.save();
    
    res.json({
      success: true,
      roomCode,
      playerId,
      gameState: game.getGameState()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/join-room', async (req, res) => {
  const { playerName, roomCode } = req.body;
  
  try {
    const room = await Room.findOne({ code: roomCode });
    if (!room) {
      return res.json({ success: false, error: 'Room not found' });
    }
    
    const game = new GameEngine(roomCode);
    game.players = room.gameState.players;
    
    if (game.players.length >= 4) {
      return res.json({ success: false, error: 'Room is full' });
    }
    
    const playerId = uuidv4();
    game.addPlayer(playerId, playerName);
    
    // Update MongoDB
    room.gameState = game.getGameState();
    await room.save();
    
    const player = new Player({
      id: playerId,
      roomCode,
      name: playerName
    });
    await player.save();
    
    res.json({
      success: true,
      roomCode,
      playerId,
      gameState: game.getGameState()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// WebSocket handling
io.on('connection', async (socket) => {
  console.log('Player connected:', socket.id);
  
  socket.on('join-game', async ({ playerId, roomCode }) => {
    try {
      const player = await Player.findOne({ id: playerId, roomCode });
      if (!player) return;
      
      player.socketId = socket.id;
      await player.save();
      
      const room = await Room.findOne({ code: roomCode });
      if (!room) return;
      
      socket.join(roomCode);
      socket.playerId = playerId;
      socket.roomCode = roomCode;
      
      // Send current game state
      socket.emit('game-state', room.gameState);
    } catch (err) {
      console.error('Join game error:', err);
    }
  });
  
  socket.on('game-action', async ({ action, data }) => {
    const { playerId, roomCode } = socket;
    
    try {
      const room = await Room.findOne({ code: roomCode });
      if (!room) return;
      
      const game = new GameEngine(roomCode);
      game.players = room.gameState.players;
      game.gamePhase = room.gameState.gamePhase;
      // ... copy all other game state properties
      
      const result = game.handleAction(action, playerId, data);
      
      if (result.success) {
        // Save updated state to MongoDB
        room.gameState = game.getGameState();
        await room.save();
        
        // Broadcast updated state
        io.to(roomCode).emit('game-state', room.gameState);
        
        // Handle AI turns
        if (game.shouldProcessAITurn()) {
          setTimeout(async () => {
            game.processAITurn();
            room.gameState = game.getGameState();
            await room.save();
            io.to(roomCode).emit('game-state', room.gameState);
          }, 1000);
        }
      } else {
        socket.emit('error', { message: result.error });
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });
  
  socket.on('disconnect', async () => {
    console.log('Player disconnected:', socket.id);
    try {
      await Player.findOneAndUpdate(
        { socketId: socket.id },
        { $set: { socketId: null } }
      );
    } catch (err) {
      console.error('Disconnect update error:', err);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
