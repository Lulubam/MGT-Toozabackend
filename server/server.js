// server.js
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

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trickgame', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const AI_PLAYERS = {
  otu: { name: 'Otu', level: 'beginner', avatar: '🤖' },
  ase: { name: 'Ase', level: 'beginner', avatar: '🎭' },
  dede: { name: 'Dede', level: 'intermediate', avatar: '🎪' },
  ogbologbo: { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
  agba: { name: 'Agba', level: 'advanced', avatar: '👑' }
};

// Create room
app.post('/api/create-room', async (req, res) => {
  const { playerName } = req.body;
  if (!playerName) return res.status(400).json({ error: 'Name required' });

  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const room = new Room({
    code: roomCode,
    maxPlayers: 6,
    gameState: new GameEngine(roomCode).getGameState()
  });

  const player = new Player({ username: playerName, roomCode, isDealer: true, isAI: false });
  room.players.push(player._id);
  await room.save();
  await player.save();

  res.json({ success: true, roomCode, playerId: player._id });
});

// Join room
app.post('/api/join-room', async (req, res) => {
  const { playerName, roomCode } = req.body;
  if (!playerName || !roomCode) return res.status(400).json({ error: 'Name and code required' });

  const room = await Room.findOne({ code: roomCode }).populate('players');
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.players.length >= 6) return res.status(400).json({ error: 'Room full' });
  if (room.players.some(p => p.username === playerName)) return res.status(400).json({ error: 'Name taken' });

  const player = new Player({ username: playerName, roomCode, isDealer: false, isAI: false });
  room.players.push(player._id);
  await player.save();
  await room.save();

  res.json({ success: true, playerId: player._id });
});

const io = socketIo(server, { cors: { origin: '*' } });
const gameEngines = {};

io.on('connection', (socket) => {
  socket.on('join-game', async ({ playerId, roomCode }) => {
    const player = await Player.findById(playerId);
    const room = await Room.findOne({ code: roomCode }).populate('players');
    if (!player || !room) return socket.emit('error', { message: 'Invalid' });

    socket.join(roomCode);
    socket.playerId = playerId;
    socket.roomCode = roomCode;

    if (!gameEngines[roomCode]) {
      gameEngines[roomCode] = new GameEngine(roomCode);
    }
    gameEngines[roomCode].updatePlayers(room.players);

    io.to(roomCode).emit('game-state', gameEngines[roomCode].getGameState());
  });

  socket.on('manage-ai', async ({ action, aiKey, roomCode }) => {
    const room = await Room.findOne({ code: roomCode }).populate('players');
    const gameEngine = gameEngines[roomCode];
    if (!room || !gameEngine) return socket.emit('error', { message: 'Not found' });

    let result;
    if (action === 'add') {
      if (room.players.length >= 6) return socket.emit('error', { message: 'Room full' });
      const config = AI_PLAYERS[aiKey];
      if (!config) return socket.emit('error', { message: 'Invalid AI' });

      const existing = room.players.find(p => p.username === config.name && p.isAI);
      if (existing) return socket.emit('error', { message: 'AI already in room' });

      const aiPlayer = new Player({
        username: config.name,
        roomCode,
        isAI: true,
        aiLevel: config.level,
        avatar: config.avatar
      });
      await aiPlayer.save();
      room.players.push(aiPlayer._id);
      await room.save();

      result = gameEngine.addAIPlayer(aiKey);
    } else if (action === 'remove') {
      const config = AI_PLAYERS[aiKey];
      if (!config) return socket.emit('error', { message: 'Invalid AI' });

      const aiPlayer = room.players.find(p => p.username === config.name && p.isAI);
      if (!aiPlayer) return socket.emit('error', { message: 'AI not found' });

      await Player.findByIdAndDelete(aiPlayer._id);
      room.players = room.players.filter(p => p._id.toString() !== aiPlayer._id.toString());
      await room.save();

      result = gameEngine.removeAIPlayer(aiKey);
    } else {
      return socket.emit('error', { message: 'Invalid action' });
    }

    if (result.success) {
      const updatedRoom = await Room.findOne({ code: roomCode }).populate('players');
      gameEngine.updatePlayers(updatedRoom.players);
      await Room.findOneAndUpdate({ code: roomCode }, { gameState: gameEngine.getGameState() });
      io.to(roomCode).emit('game-state', gameEngine.getGameState());
      io.to(roomCode).emit('game-message', { message: result.message });
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('game-action', async ({ action, data }) => {
    const player = await Player.findOne({ socketId: socket.id });
    if (!player) return socket.emit('error', { message: 'Player not found' });

    const gameEngine = gameEngines[player.roomCode];
    if (!gameEngine) return socket.emit('error', { message: 'Game not found' });

    let result;
    if (action === 'startGame') {
      result = gameEngine.startGame(player._id);
    } else if (action === 'playCard') {
      result = gameEngine.handleAction('play-card', player._id, data.cardId);
    } else {
      return socket.emit('error', { message: 'Unknown action' });
    }

    if (result.success) {
      await Room.findOneAndUpdate({ code: player.roomCode }, { gameState: gameEngine.getGameState() });
      io.to(player.roomCode).emit('game-state', gameEngine.getGameState());
      if (result.message) io.to(player.roomCode).emit('game-message', { message: result.message });
    } else {
      socket.emit('error', { message: result.error });
    }
  });
});

server.listen(process.env.PORT || 3001, () => console.log('Server running on port 3001'));
