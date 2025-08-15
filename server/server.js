// server.js
const GameEngine = require('./game/GameEngine');
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const path = require('path');

// NOTE: I've included the model code for Room.js and Player.js below
// For production, you should put these in their own files and import them like this:
// const GameEngine = require('./game/gameEngine');
// const Room = require('./models/Room');
// const Player = require('./models/Player');

const app = express();
const server = http.createServer(app);

// Improved CORS configuration with dynamic origin
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = [
            process.env.FRONTEND_URL,
            'https://mgt-tooza.onrender.com',
            'http://localhost:3000' // Add local dev URL
        ].filter(Boolean);

        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error('CORS rejected origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json()); // <--- CRUCIAL: This line parses JSON request bodies

// Configure Socket.IO with proper CORS and timeouts
const io = socketIo(server, {
    cors: corsOptions,
    transports: ['websocket', 'polling'],
    pingTimeout: 10000,
    pingInterval: 5000
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    retryWrites: true,
    w: 'majority'
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));


// =========================================================================
// API Routes
// =========================================================================

app.post('/api/create-room', async (req, res) => {
    try {
        const { playerName } = req.body;
        if (!playerName) {
            return res.status(400).json({ success: false, error: 'Player name is required' });
        }

        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // Use the placeholder GameEngine
        const game = new GameEngine(roomCode);
        
        // Create the player and room documents
        const playerDoc = new Player({ username: playerName, roomCode });
        await playerDoc.save();

        const roomDoc = new Room({ code: roomCode, gameState: game.getGameState() });
        roomDoc.players.push(playerDoc._id);
        await roomDoc.save();

        res.json({
            success: true,
            roomCode,
            playerId: playerDoc._id,
            gameState: game.getGameState()
        });
    } catch (err) {
        console.error('Create room error:', err);
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

        const playerDoc = new Player({ username: playerName, roomCode });
        await playerDoc.save();

        // Add the new player to the room's players array
        room.players.push(playerDoc._id);
        await room.save();

        res.json({
            success: true,
            playerId: playerDoc._id,
            roomCode
        });
    } catch (err) {
        console.error('Join room error:', err);
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
        try {
            const player = await Player.findById(playerId);
            const room = await Room.findOne({ code: roomCode });

            if (!player || !room) {
                return socket.emit('error', { message: 'Invalid room or player' });
            }

            player.socketId = socket.id;
            await player.save();
            
            socket.join(roomCode);
            socket.playerId = playerId;
            socket.roomCode = roomCode;
            
            socket.emit('game-state', room.gameState);
            console.log('Join game processed in', Date.now() - start, 'ms');
        } catch (err) {
            console.error('Join game error:', err);
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
        await Player.deleteMany({ socketId: null, updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
        console.log('Cleaned up stale players');
    } catch (err) {
        console.error('Cleanup error:', err);
    }
}, 60 * 60 * 1000);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
