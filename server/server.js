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
// MongoDB Connection - ADD THIS BACK!
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

// Models are now imported from separate files

// GameEngine is now imported from ./game/GameEngine.js

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

// Make io available to routes
app.set('io', io);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// API Routes
// =========================================================================

app.post('/api/create-room', async (req, res) => {
    console.log('=== CREATE ROOM REQUEST ===');
    console.log('Request body:', req.body);
    
    try {
        const { playerName } = req.body;
        if (!playerName) {
            console.log('❌ No player name provided');
            return res.status(400).json({ success: false, error: 'Player name is required' });
        }

        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        console.log('✅ Generated room code:', roomCode);
        
        // Use the GameEngine
        console.log('Creating GameEngine instance...');
        const game = new GameEngine(roomCode);
        console.log('✅ GameEngine created');
        
        // Create the player document
        console.log('Creating player document...');
        const playerDoc = new Player({ username: playerName, roomCode });
        await playerDoc.save();
        console.log('✅ Player saved:', playerDoc._id);

        // Add player to the game state
        console.log('Adding player to game state...');
        const addPlayerResult = game.addPlayer({
            id: playerDoc._id.toString(),
            username: playerName,
            socketId: null
        });
        console.log('✅ Player added to game:', addPlayerResult);

        // Create the room document
        console.log('Creating room document...');
        const roomDoc = new Room({ code: roomCode, gameState: game.getGameState() });
        roomDoc.players.push(playerDoc._id);
        await roomDoc.save();
        console.log('✅ Room saved:', roomDoc._id);

        const response = {
            success: true,
            roomCode,
            playerId: playerDoc._id,
            gameState: game.getGameState()
        };
        
        console.log('✅ Sending response:', response);
        res.json(response);
    } catch (err) {
        console.error('❌ Create room error:', err);
        if (err.code === 11000) {
            // Handle duplicate key error
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

        const room = await Room.findOne({ code: roomCode });
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
        // Load existing game state from room
        Object.assign(game.gameState, room.gameState);
        
        // Add the new player to the game
        const addPlayerResult = game.addPlayer({
            id: playerDoc._id.toString(),
            username: playerName,
            socketId: null
        });
        
        if (!addPlayerResult.success) {
            await Player.findByIdAndDelete(playerDoc._id); // Clean up
            return res.status(400).json(addPlayerResult);
        }

        // Update room with new game state and add to players array
        room.gameState = game.getGameState();
        room.players.push(playerDoc._id);
        await room.save();

        // Notify all players in the room about the new player
        const io = req.app.get('io'); // We'll need to set this up
        if (io) {
            io.to(roomCode).emit('game-state', room.gameState);
        }

        res.json({
            success: true,
            playerId: playerDoc._id,
            roomCode,
            gameState: room.gameState
        });
    } catch (err) {
        console.error('Join room error:', err);
        if (err.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                error: 'Player name already exists in this room' 
            });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Add endpoint to start the game
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

        // Check if player is the dealer (only dealer can start)
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

        // Save updated game state
        room.gameState = game.getGameState();
        await room.save();

        // Notify all players
        const io = req.app.get('io');
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
    console.log('New connection:', socket.id, 'from origin:', socket.handshake.headers.origin);

    socket.on('join-game', async ({ playerId, roomCode }) => {
        const start = Date.now();
        console.log('=== JOIN GAME REQUEST ===');
        console.log('Player ID:', playerId);
        console.log('Room Code:', roomCode);
        
        try {
            console.log('Looking up player and room...');
            const player = await Player.findById(playerId);
            const room = await Room.findOne({ code: roomCode });

            if (!player) {
                console.log('❌ Player not found:', playerId);
                return socket.emit('error', { message: 'Invalid player' });
            }
            
            if (!room) {
                console.log('❌ Room not found:', roomCode);
                return socket.emit('error', { message: 'Invalid room' });
            }

            console.log('✅ Player found:', player.username);
            console.log('✅ Room found:', room.code);

            // Update player's socket ID
            player.socketId = socket.id;
            await player.save();
            console.log('✅ Player socket updated');
            
            // Update the game state with the player's socket ID
            const game = new GameEngine(roomCode);
            Object.assign(game.gameState, room.gameState);
            
            // Update the player's socket ID in the game state
            const gamePlayer = game.gameState.players.find(p => p.id === playerId);
            if (gamePlayer) {
                gamePlayer.socketId = socket.id;
                room.gameState = game.getGameState();
                await room.save();
                console.log('✅ Game state updated with socket ID');
            }
            
            socket.join(roomCode);
            socket.playerId = playerId;
            socket.roomCode = roomCode;
            
            console.log('✅ Sending game state to client');
            socket.emit('game-state', room.gameState);
            
            // Notify other players that someone joined
            socket.to(roomCode).emit('player-joined', { 
                username: player.username,
                playerId: playerId 
            });
            
            console.log('Join game processed in', Date.now() - start, 'ms');
        } catch (err) {
            console.error('❌ Join game error:', err);
            socket.emit('error', { message: 'Failed to join game' });
        }
    });

    socket.on('game-action', async ({ action, data }) => {
        const start = Date.now();
        try {
            const { playerId, roomCode } = socket;
            if (!playerId || !roomCode) return;

            const room = await Room.findOne({ code: roomCode });
            if (!room) return;

            const game = new GameEngine(roomCode);
            Object.assign(game, room.gameState);
            
            const result = game.handleAction(action, playerId, data);
            if (!result.success) {
                return socket.emit('error', { message: result.error });
            }

            room.gameState = game.getGameState();
            await room.save();
            io.to(roomCode).emit('game-state', room.gameState);

            if (game.shouldProcessAITurn()) {
                setTimeout(async () => {
                    game.processAITurn();
                    room.gameState = game.getGameState();
                    await room.save();
                    io.to(roomCode).emit('game-state', room.gameState);
                    console.log('AI turn processed in', Date.now() - start, 'ms');
                }, 1000);
            }
            console.log('Game action processed in', Date.now() - start, 'ms');
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
            console.log('Client disconnected:', socket.id);
        } catch (err) {
            console.error('Disconnect update error:', err);
        }
    });
});

// Clean up stale players hourly
setInterval(async () => {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await Player.deleteMany({ 
            socketId: null, 
            updatedAt: { $lt: oneDayAgo } 
        });
        console.log('Cleaned up stale players');
    } catch (err) {
        console.error('Cleanup error:', err);
    }
}, 60 * 60 * 1000);

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
    res.json({ message: 'Game Server is running' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
