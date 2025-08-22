// server.jsv7qwen
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
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? 'https://mgt-tooza.onrender.com'
      : 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? 'https://mgt-tooza.onrender.com'
    : 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI, {
  retryWrites: true,
  w: 'majority'
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const gameEngines = {};

// AI Players
const AI_PLAYERS = {
  otu: { name: 'Otu', level: 'beginner', avatar: '🤖' },
  ase: { name: 'Ase', level: 'beginner', avatar: '🎭' },
  dede: { name: 'Dede', level: 'intermediate', avatar: '🎪' },
  ogbologbo: { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
  agba: { name: 'Agba', level: 'advanced', avatar: '👑' }
};

// Create room
app.post('/api/create-room', async (req, res) => {
  try {
    const { playerName } = req.body;
    if (!playerName || !playerName.trim()) {
      return res.status(400).json({ success: false, error: 'Player name is required' });
    }

    const roomCode = generateRoomCode().toUpperCase();
    const newRoom = new Room({ code: roomCode, maxPlayers: 6 });
    const player = new Player({ username: playerName.trim(), roomCode, isDealer: true, isAI: false });

    await player.save();
    newRoom.players.push(player._id);
    await newRoom.save();

    gameEngines[roomCode] = new GameEngine(roomCode);
    gameEngines[roomCode].updatePlayers([player]);

    res.status(200).json({ success: true, roomCode, playerId: player._id.toString() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Join room
app.post('/api/join-room', async (req, res) => {
  try {
    const { playerName, roomCode } = req.body;
    if (!playerName || !roomCode) {
      return res.status(400).json({ success: false, error: 'Player name and room code are required' });
    }

    const room = await Room.findOne({ code: roomCode.toUpperCase() }).populate('players');
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    if (room.players.length >= 6) return res.status(400).json({ success: false, error: 'Room is full' });

    const existing = room.players.find(p => p.username === playerName.trim());
    if (existing) return res.status(400).json({ success: false, error: 'Player name taken' });

    const player = new Player({ username: playerName.trim(), roomCode: roomCode.toUpperCase(), isAI: false });
    await player.save();
    room.players.push(player._id);
    await room.save();

    const gameEngine = gameEngines[roomCode.toUpperCase()] || new GameEngine(roomCode);
    if (!gameEngines[roomCode.toUpperCase()]) gameEngines[roomCode.toUpperCase()] = gameEngine;

    const updatedRoom = await Room.findOne({ code: roomCode.toUpperCase() }).populate('players');
    gameEngine.updatePlayers(updatedRoom.players);

    io.to(roomCode.toUpperCase()).emit('game-state', gameEngine.getGameState());

    res.status(200).json({ success: true, roomCode: roomCode.toUpperCase(), playerId: player._id.toString() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  socket.on('join-game', async ({ playerId, roomCode }) => {
    try {
      const player = await Player.findById(playerId);
      const room = await Room.findOne({ code: roomCode }).populate('players');
      if (!player || !room) return socket.emit('error', { message: 'Invalid player or room' });

      player.socketId = socket.id;
      await player.save();
      socket.join(roomCode);

      const gameEngine = gameEngines[roomCode];
      if (gameEngine) {
        const updatedRoom = await Room.findOne({ code: roomCode }).populate('players');
        gameEngine.updatePlayers(updatedRoom.players);
      }

      socket.emit('game-state', gameEngine?.getGameState());
    } catch (error) {
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  socket.on('manage-ai', async ({ action, aiKey }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (!player) return socket.emit('error', { message: 'Player not found' });

      const room = await Room.findOne({ code: player.roomCode }).populate('players');
      const gameEngine = gameEngines[room.code];

      if (!gameEngine || !room) return socket.emit('error', { message: 'Game not found' });

      const config = AI_PLAYERS[aiKey];
      if (!config) return socket.emit('error', { message: 'Invalid AI player' });

      const uniqueAIName = `${config.name}_${room.code}`;
      let result;

      if (action === 'add') {
        if (room.players.length >= 6) return socket.emit('error', { message: 'Room is full' });
        const exists = room.players.find(p => p.username === uniqueAIName && p.isAI);
        if (exists) return socket.emit('error', { message: 'AI already in room' });

        const aiPlayer = new Player({
          username: uniqueAIName,
          roomCode: room.code,
          isAI: true,
          aiLevel: config.level,
          avatar: config.avatar,
          socketId: 'AI_PLAYER'
        });
        await aiPlayer.save();
        room.players.push(aiPlayer._id);
        await room.save();

        result = gameEngine.addAIPlayer(aiKey);
        result.message = `${config.name} joined`;
      } else if (action === 'remove') {
        const aiPlayer = room.players.find(p => p.username === uniqueAIName && p.isAI);
        if (!aiPlayer) return socket.emit('error', { message: 'AI not found' });

        await Player.findByIdAndDelete(aiPlayer._id);
        room.players = room.players.filter(p => p._id.toString() !== aiPlayer._id.toString());
        await room.save();

        result = gameEngine.removeAIPlayer(aiKey);
        result.message = `${config.name} left`;
      } else {
        return socket.emit('error', { message: 'Invalid action' });
      }

      if (result.success) {
        const updatedRoom = await Room.findOne({ code: room.code }).populate('players');
        gameEngine.updatePlayers(updatedRoom.players);
        io.to(room.code).emit('game-state', gameEngine.getGameState());
        io.to(room.code).emit('game-message', { message: result.message });
      } else {
        socket.emit('error', { message: result.error });
      }
    } catch (error) {
      console.error('Error managing AI:', error);
      socket.emit('error', { message: 'Failed to manage AI' });
    }
  });

  socket.on('game-action', async ({ action, cardId, mode }) => {
    try {
      const player = await Player.findOne({ socketId: socket.id });
      if (!player) return socket.emit('error', { message: 'Player not found' });

      const gameEngine = gameEngines[player.roomCode];
      if (!gameEngine) return socket.emit('error', { message: 'Game not found' });

      let result;

      if (action === 'set-dealing-mode') {
        gameEngine.setDealingMode(mode);
        result = { success: true, message: `Dealing mode: ${mode}` };
      } else if (action === 'startGame') {
        result = gameEngine.startGame();
      } else if (action === 'deal-next-card') {
        result = gameEngine.dealNextCard();
      } else {
        result = gameEngine.handleAction(action, player._id.toString(), cardId);
      }

      if (result.success) {
        const room = await Room.findOneAndUpdate(
          { code: player.roomCode },
          { gameState: gameEngine.getGameState() },
          { new: true }
        );
        io.to(player.roomCode).emit('game-state', gameEngine.getGameState());
        if (result.message) {
          io.to(player.roomCode).emit('game-message', { message: result.message });
        }

        // Process AI turns
        setTimeout(() => processAITurnChain(player.roomCode), 500);
      } else {
        socket.emit('error', { message: result.error });
      }
    } catch (error) {
      socket.emit('error', { message: 'Game action failed' });
    }
  });

  socket.on('disconnect', async () => {
    const player = await Player.findOne({ socketId: socket.id });
    if (player) player.isActive = false;
  });
});

// Process AI turns
async function processAITurnChain(roomCode, maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) return;

  const gameEngine = gameEngines[roomCode];
  if (!gameEngine) return;

  const gameState = gameEngine.getGameState();
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];

  if (currentPlayer?.isAI) {
    const card = currentPlayer.cards[0];
    const result = gameEngine.handleAction('playCard', currentPlayer._id, card.id);
    if (result.success) {
      const updatedRoom = await Room.findOneAndUpdate(
        { code: roomCode },
        { gameState: gameEngine.getGameState() },
        { new: true }
      );
      io.to(roomCode).emit('game-state', gameEngine.getGameState());
      processAITurnChain(roomCode, maxDepth, currentDepth + 1);
    }
  }
}

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
