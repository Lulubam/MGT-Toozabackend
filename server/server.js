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
const path = require('path');

const app = express();
const server = http.createServer(app);

// =========================================================================
// AI Players Configuration
// =========================================================================
const AI_PLAYERS = {
  'otu': { name: 'Otu', level: 'beginner', avatar: '🤖' },
  'ase': { name: 'Ase', level: 'beginner', avatar: '🎭' },
  'dede': { name: 'Dede', level: 'intermediate', avatar: '🎪' },
  'ogbologbo': { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
  'agba': { name: 'Agba', level: 'advanced', avatar: '👑' }
};

// =========================================================================
// MongoDB Connection
// =========================================================================
mongoose.connect(process.env.MONGODB_URI, {
    retryWrites: true,
    w: 'majority',
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// =========================================================================
// CORS Configuration
// =========================================================================
const createOriginValidator = () => {
    const allowedOrigins = [
        process.env.FRONTEND_URL,
        'https://mgt-tooza.onrender.com',
        'http://localhost:3000'
    ].filter(Boolean);

    return (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error('CORS rejected origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    };
};

const corsOptions = {
    origin: createOriginValidator(),
    credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Configure Socket.IO
const io = socketIo(server, {
    cors: {
        origin: createOriginValidator(),
        credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 10000,
    pingInterval: 5000
});

app.set('io', io);
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// API Routes
// =========================================================================

app.post('/api/create-room', async (req, res) => {
    console.log('=== CREATE ROOM REQUEST ===');
    console.log('Request body:', req.body);
    
    try {
        const { playerName, aiPlayers = [] } = req.body;
        if (!playerName) {
            console.log('❌ No player name provided');
            return res.status(400).json({ success: false, error: 'Player name is required' });
        }

        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        console.log('✅ Generated room code:', roomCode);
        
        // Create the GameEngine
        const game = new GameEngine(roomCode);
        
        // Create the human player document
        const playerDoc = new Player({ username: playerName, roomCode });
        await playerDoc.save();
        console.log('✅ Player saved:', playerDoc._id);

        // Add human player to the game state
        const addPlayerResult = game.addPlayer({
            id: playerDoc._id.toString(),
            username: playerName,
            socketId: null,
            isAI: false
        });
        console.log('✅ Human player added to game:', addPlayerResult);

        // Add AI players
        for (const aiKey of aiPlayers) {
            if (AI_PLAYERS[aiKey]) {
                const aiPlayerDoc = new Player({ 
                    username: AI_PLAYERS[aiKey].name, 
                    roomCode,
                    isActive: true,
                    socketId: 'AI_PLAYER'
                });
                await aiPlayerDoc.save();
                
                const aiAddResult = game.addPlayer({
                    id: aiPlayerDoc._id.toString(),
                    username: AI_PLAYERS[aiKey].name,
                    socketId: 'AI_PLAYER',
                    isAI: true,
                    level: AI_PLAYERS[aiKey].level
                });
                console.log(`✅ AI player ${AI_PLAYERS[aiKey].name} added:`, aiAddResult);
            }
        }

        // Create the room document with all players
        const roomDoc = new Room({ 
            code: roomCode, 
            gameState: game.getGameState(),
            players: await Player.find({ roomCode }).select('_id')
        });
        await roomDoc.save();
        console.log('✅ Room saved with', roomDoc.players.length, 'players');

        res.json({
            success: true,
            roomCode,
            playerId: playerDoc._id,
            gameState: game.getGameState()
        });
    } catch (err) {
        console.error('❌ Create room error:', err);
        if (err.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                error: 'Player name already exists in this room' 
            });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/api/join-room', async (req, res) => {
    try {
        const { playerName, roomCode } = req.body;
        if (!playerName || !roomCode) {
            return res.status(400).json({ success: false, error: 'Player name and room code are required' });
        }

        const room = await Room.findOne({ code: roomCode }).populate('players');
        if (!room) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        // Check if room is full
        if (room.players.length >= room.maxPlayers) {
            return res.status(400).json({ success: false, error: 'Room is full' });
        }

        // Check if username already exists in this room
        const existingPlayer = await Player.findOne({ username: playerName, roomCode });
        if (existingPlayer) {
            return res.status(400).json({ 
                success: false, 
                error: 'Player name already exists in this room' 
            });
        }

        const playerDoc = new Player({ username: playerName, roomCode });
        await playerDoc.save();

        // Add player to the game state using GameEngine
        const game = new GameEngine(roomCode);
        Object.assign(game.gameState, room.gameState);
        
        const addPlayerResult = game.addPlayer({
            id: playerDoc._id.toString(),
            username: playerName,
            socketId: null,
            isAI: false
        });
        
        if (!addPlayerResult.success) {
            await Player.findByIdAndDelete(playerDoc._id);
            return res.status(400).json(addPlayerResult);
        }

        // Update room with new game state and add to players array
        room.gameState = game.getGameState();
        room.players.push(playerDoc._id);
        await room.save();

        // Notify all players in the room about the new player
        io.to(roomCode).emit('game-state', room.gameState);
        io.to(roomCode).emit('player-joined', { 
            username: playerName,
            playerId: playerDoc._id 
        });

        res.json({
            success: true,
            playerId: playerDoc._id,
            roomCode,
            gameState: room.gameState
        });
    } catch (err) {
        console.error('Join room error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/api/start-game', async (req, res) => {
    try {
        const { roomCode, playerId } = req.body;
        if (!roomCode || !playerId) {
            return res.status(400).json({ success: false, error: 'Room code and player ID required' });
        }

        const room = await Room.findOne({ code: roomCode });
        if (!room) {
            return res.status(404).json({ success: false, error: 'Room not found' });
        }

        const game = new GameEngine(roomCode);
        Object.assign(game.gameState, room.gameState);
        
        const player = game.gameState.players.find(p => p.id === playerId);
        if (!player || !player.isDealer) {
            return res.status(403).json({ success: false, error: 'Only the dealer can start the game' });
        }

        const startResult = game.startGame();
        if (!startResult.success) {
            return res.status(400).json(startResult);
        }

        room.gameState = game.getGameState();
        await room.save();

        io.to(roomCode).emit('game-state', room.gameState);
        io.to(roomCode).emit('game-started', { message: 'Game has started!' });

        res.json({ success: true, gameState: room.gameState });
    } catch (err) {
        console.error('Start game error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// =========================================================================
// WebSocket handling
// =========================================================================

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    socket.on('join-game', async ({ playerId, roomCode }) => {
        try {
            const player = await Player.findById(playerId);
            const room = await Room.findOne({ code: roomCode }).populate('players');

            if (!player || !room) {
                return socket.emit('error', { message: 'Invalid player or room' });
            }

            // Update player's socket ID (only for human players)
            if (player.socketId !== 'AI_PLAYER') {
                player.socketId = socket.id;
                await player.save();
            }
            
            // Update the game state with the player's socket ID
            const game = new GameEngine(roomCode);
            Object.assign(game.gameState, room.gameState);
            
            const gamePlayer = game.gameState.players.find(p => p.id === playerId);
            if (gamePlayer && !gamePlayer.isAI) {
                gamePlayer.socketId = socket.id;
                room.gameState = game.getGameState();
                await room.save();
            }
            
            socket.join(roomCode);
            socket.playerId = playerId;
            socket.roomCode = roomCode;
            
            // Send complete game state with populated player data
            const gameStateWithPlayers = {
                ...room.gameState,
                players: room.gameState.players.map(gamePlayer => {
                    const dbPlayer = room.players.find(p => p._id.toString() === gamePlayer.id);
                    return {
                        ...gamePlayer,
                        username: gamePlayer.username || (dbPlayer ? dbPlayer.username : 'Unknown'),
                        _id: gamePlayer.id
                    };
                })
            };
            
            socket.emit('game-state', gameStateWithPlayers);
            
            // Notify other players that someone joined (only if human player)
            if (!gamePlayer || !gamePlayer.isAI) {
                socket.to(roomCode).emit('player-joined', { 
                    username: player.username,
                    playerId: playerId 
                });
            }
            
        } catch (err) {
            console.error('❌ Join game error:', err);
            socket.emit('error', { message: 'Failed to join game' });
        }
    });

    socket.on('leave-room', async ({ playerId, roomCode }) => {
        try {
            const player = await Player.findById(playerId);
            const room = await Room.findOne({ code: roomCode });

            if (!player || !room) {
                return socket.emit('error', { message: 'Invalid player or room' });
            }

            // Remove player from database
            await Player.findByIdAndDelete(playerId);
            
            // Remove player from room's players array
            room.players = room.players.filter(p => p.toString() !== playerId);
            
            // Remove player from game state
            const game = new GameEngine(roomCode);
            Object.assign(game.gameState, room.gameState);
            game.gameState.players = game.gameState.players.filter(p => p.id !== playerId);
            
            // If no human players left, clean up the room
            const remainingHumanPlayers = game.gameState.players.filter(p => !p.isAI);
            if (remainingHumanPlayers.length === 0) {
                // Delete all AI players and the room
                await Player.deleteMany({ roomCode });
                await Room.findByIdAndDelete(room._id);
                console.log(`Room ${roomCode} cleaned up - no human players remaining`);
            } else {
                // Update room with new game state
                room.gameState = game.getGameState();
                await room.save();
                
                // Notify remaining players
                io.to(roomCode).emit('game-state', room.gameState);
                io.to(roomCode).emit('player-left', { 
                    username: player.username,
                    playerId: playerId 
                });
            }

            socket.leave(roomCode);
            socket.emit('left-room', { success: true });
            
        } catch (err) {
            console.error('❌ Leave room error:', err);
            socket.emit('error', { message: 'Failed to leave room' });
        }
    });

    socket.on('game-action', async ({ action, data }) => {
        try {
            const { playerId, roomCode } = socket;
            if (!playerId || !roomCode) return;

            const room = await Room.findOne({ code: roomCode });
            if (!room) return;

            const game = new GameEngine(roomCode);
            Object.assign(game.gameState, room.gameState);
            
            const result = game.handleAction(action, playerId, data);
            if (!result.success) {
                return socket.emit('error', { message: result.error });
            }

            room.gameState = game.getGameState();
            await room.save();
            
            // Send updated game state to all players
            const gameStateWithPlayers = {
                ...room.gameState,
                players: room.gameState.players.map(gamePlayer => ({
                    ...gamePlayer,
                    _id: gamePlayer.id
                }))
            };
            
            io.to(roomCode).emit('game-state', gameStateWithPlayers);

            // Process AI turns if needed
            if (game.shouldProcessAITurn()) {
                setTimeout(async () => {
                    try {
                        const aiResult = game.processAITurn();
                        if (aiResult.success) {
                            room.gameState = game.getGameState();
                            await room.save();
                            
                            const updatedGameState = {
                                ...room.gameState,
                                players: room.gameState.players.map(gamePlayer => ({
                                    ...gamePlayer,
                                    _id: gamePlayer.id
                                }))
                            };
                            
                            io.to(roomCode).emit('game-state', updatedGameState);
                        }
                    } catch (aiError) {
                        console.error('AI turn error:', aiError);
                    }
                }, 1000 + Math.random() * 2000); // Random delay between 1-3 seconds
            }
        } catch (error) {
            console.error('Game action error:', error);
            socket.emit('error', { message: 'Action failed' });
        }
    });

    socket.on('disconnect', async () => {
        try {
            if (socket.playerId) {
                await Player.findOneAndUpdate(
                    { _id: socket.playerId, socketId: socket.id },
                    { $set: { socketId: null } }
                );
            }
            console.log('Client disconnected:', socket.id);
        } catch (err) {
            console.error('Disconnect update error:', err);
        }
    });
});

// =========================================================================
// Cleanup and Health Check
// =========================================================================

// Clean up stale players and empty rooms
setInterval(async () => {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        // Delete stale human players (not AI players)
        await Player.deleteMany({ 
            socketId: { $ne: 'AI_PLAYER' },
            socketId: null,
            updatedAt: { $lt: oneDayAgo } 
        });
        
        // Delete empty rooms
        const emptyRooms = await Room.find({ players: { $size: 0 } });
        for (const room of emptyRooms) {
            // Also clean up any remaining AI players in empty rooms
            await Player.deleteMany({ roomCode: room.code });
            await Room.findByIdAndDelete(room._id);
        }
        
        console.log('Cleaned up stale data');
    } catch (err) {
        console.error('Cleanup error:', err);
    }
}, 60 * 60 * 1000); // Run every hour

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'Whot! Game Server is running',
        features: [
            'Create/Join rooms',
            'AI players (Otu, Ase, Dede, Ogbologbo, Agba)',
            'Real-time multiplayer',
            'Leave room functionality'
        ]
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🎮 Whot! Game Server running on port ${PORT}`);
    console.log('🤖 AI Players available:', Object.keys(AI_PLAYERS).join(', '));
});
