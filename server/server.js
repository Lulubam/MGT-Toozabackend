// server.js - Trick-Taking Game Server
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
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

mongoose.connect(process.env.MONGODB_URI, {
  retryWrites: true, w: 'majority'
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB error:', err));

app.use(cors());
app.use(express.json());

const gameEngines = {};

// =================================================================
// REST: Create room / Join room
// =================================================================
app.post('/api/create-room', async (req, res) => {
  try {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ success: false, error: 'Name required' });

    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const newRoom = new Room({
      code: roomCode,
      maxPlayers: 4,
      gameState: {}
    });

    const player = new Player({ username: playerName, roomCode, isDealer: true, isAI: false });
    newRoom.players.push(player._id);
    await player.save();
    await newRoom.save();

    res.status(201).json({ success: true, roomCode, playerId: player._id });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/join-room', async (req, res) => {
  try {
    const { playerName, roomCode } = req.body;
    if (!playerName || !roomCode) return res.status(400).json({ success: false, error: 'Name and room required' });

    const room = await Room.findOne({ code: roomCode }).populate('players');
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

    const player = new Player({ username: playerName, roomCode, isDealer: false, isAI: false });
    room.players.push(player._id);
    await player.save();
    await room.save();

    res.json({ success: true, roomCode, playerId: player._id });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// =================================================================
// Socket.IO
// =================================================================
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on('join-game', async ({ playerId, roomCode }) => {
    const room = await Room.findOne({ code: roomCode }).populate('players');
    const player = await Player.findById(playerId);
    if (!room || !player) return;

    socket.join(roomCode);
    socket.playerInfo = { playerId, roomCode };

    if (!gameEngines[roomCode]) {
      gameEngines[roomCode] = new GameEngine(roomCode);
    }
    gameEngines[roomCode].updatePlayers(room.players);

    io.to(roomCode).emit('game-state', gameEngines[roomCode].getGameState());
  });

  // Game actions
  socket.on('game-action', async ({ action, data }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id }) || await Player.findById(socket.playerInfo.playerId);
      if (!player) return;

      const roomCode = player.roomCode;
      const engine = gameEngines[roomCode];
      if (!engine) return;

      let result;
      switch (action) {
        case 'startGame':
          result = engine.startGame();
          break;
        case 'drawDealerCard':
          result = engine.drawDealerCard(player._id);
          break;
        case 'confirmDealer':
          result = engine.confirmDealer(player._id);
          break;
        default:
          result = engine.handleAction(action, player._id, data);
      }

      if (result?.success) {
        const room = await Room.findOneAndUpdate(
          { code: roomCode },
          { gameState: engine.getGameState() },
          { new: true }
        ).populate('players');

        io.to(roomCode).emit('game-state', engine.getGameState());
        if (result.message) io.to(roomCode).emit('game-message', { message: result.message });
      } else {
        socket.emit('error', { message: result?.error || 'Invalid action' });
      }
    } catch (err) {
      console.error('game-action error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

server.listen(3001, () => console.log('🎮 Server running on port 3001'));
