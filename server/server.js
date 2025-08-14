require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Improved CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'https://mgt-tooza.onrender.com',
  credentials: true
};

app.use(cors(corsOptions));

// Configure Socket.IO with proper CORS
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'https://mgt-tooza.onrender.com',
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'] // Explicitly specify transports
});

// MongoDB Connection - use environment variable
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  retryWrites: true,
  w: 'majority'
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// ... (keep your existing schemas and models)

// Serve static files if needed
app.use(express.static(path.join(__dirname, 'public')));

// API Routes with better error handling
app.post('/api/create-room', async (req, res) => {
  try {
    const { playerName } = req.body;
    if (!playerName) {
      return res.status(400).json({ success: false, error: 'Player name is required' });
    }

    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const playerId = uuidv4();
    
    const game = new GameEngine(roomCode);
    game.addPlayer(playerId, playerName);
    
    const [room, player] = await Promise.all([
      new Room({
        code: roomCode,
        gameState: game.getGameState()
      }).save(),
      new Player({
        id: playerId,
        roomCode,
        name: playerName
      }).save()
    ]);
    
    res.json({
      success: true,
      roomCode,
      playerId,
      gameState: game.getGameState()
    });
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Improved WebSocket handling
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('join-game', async ({ playerId, roomCode }) => {
    try {
      const [player, room] = await Promise.all([
        Player.findOne({ id: playerId, roomCode }),
        Room.findOne({ code: roomCode })
      ]);

      if (!player || !room) {
        return socket.emit('error', { message: 'Invalid room or player' });
      }

      player.socketId = socket.id;
      await player.save();
      
      socket.join(roomCode);
      socket.playerId = playerId;
      socket.roomCode = roomCode;
      
      socket.emit('game-state', room.gameState);
    } catch (err) {
      console.error('Join game error:', err);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  socket.on('game-action', async ({ action, data }) => {
    try {
      const { playerId, roomCode } = socket;
      if (!playerId || !roomCode) return;

      const room = await Room.findOne({ code: roomCode });
      if (!room) return;

      const game = new GameEngine(roomCode);
      Object.assign(game, room.gameState); // Restore full game state
      
      const result = game.handleAction(action, playerId, data);
      if (!result.success) {
        return socket.emit('error', { message: result.error });
      }

      // Update and broadcast game state
      room.gameState = game.getGameState();
      await room.save();
      io.to(roomCode).emit('game-state', room.gameState);

      // Handle AI turns if needed
      if (game.shouldProcessAITurn()) {
        setTimeout(async () => {
          game.processAITurn();
          room.gameState = game.getGameState();
          await room.save();
          io.to(roomCode).emit('game-state', room.gameState);
        }, 1000);
      }
    } catch (error) {
      console.error('Game action error:', error);
      socket.emit('error', { message: 'Action failed' });
    }
  });

  socket.on('disconnect', async () => {
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
