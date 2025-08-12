const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const RoomManager = require('./game/roomManager');
const GameEngine = require('./game/gameEngine');
const Player = require('./models/Player');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/cardgame', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('register', async ({ username, avatar }, callback) => {
    try {
      const player = new Player({ username, avatar });
      await player.save();
      callback({ success: true, player });
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  socket.on('createRoom', (playerData) => {
    const roomCode = RoomManager.createRoom(playerData);
    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
  });

  socket.on('joinRoom', ({ roomCode, player }) => {
    if (RoomManager.joinRoom(roomCode, player)) {
      socket.join(roomCode);
      const room = RoomManager.getRoom(roomCode);
      io.to(roomCode).emit('roomUpdated', room);
    } else {
      socket.emit('joinError', 'Could not join room');
    }
  });

  // Add other game event handlers here
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
