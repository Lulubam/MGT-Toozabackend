// server.js
// Corrected import paths
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
// Middleware
// =========================================================================
app.use(cors());
app.use(express.json());

// =========================================================================
// API Routes
// =========================================================================

// Create a new game room
app.post('/api/create-room', async (req, res) => {
    try {
        const { playerName, aiPlayers = [] } = req.body;
        if (!playerName) {
            return res.status(400).json({ success: false, error: 'Player name is required' });
        }

        const roomCode = generateRoomCode();
        
        const newRoom = new Room({
            code: roomCode,
            maxPlayers: 4,
            gameState: new GameEngine(roomCode).getGameState()
        });
        
        const player = new Player({
            username: playerName,
            roomCode: roomCode,
            isDealer: true,
            isAI: false
        });
        
        newRoom.players.push(player._id);
        
        const createdPlayers = [player];

        // Create AI players if requested
        for (const aiKey of aiPlayers) {
            const aiData = AI_PLAYERS[aiKey];
            if (aiData) {
                const newAIPlayer = new Player({
                    username: aiData.name,
                    roomCode: roomCode,
                    isAI: true,
                    isDealer: false,
                    aiLevel: aiData.level,
                    socketId: 'AI_PLAYER' // A special ID to identify AI
                });
                await newAIPlayer.save();
                newRoom.players.push(newAIPlayer._id);
                createdPlayers.push(newAIPlayer);
            }
        }

        await newRoom.save();
        await player.save();

        console.log(`Room created: ${roomCode} with player ${playerName}`);
        res.status(201).json({ 
            success: true, 
            message: 'Room created successfully', 
            roomCode, 
            playerId: player._id 
        });

    } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Join an existing game room
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
        
        if (room.players.length >= room.maxPlayers) {
            return res.status(400).json({ success: false, error: 'Room is full' });
        }

        const player = new Player({
            username: playerName,
            roomCode: roomCode,
            isDealer: false,
            isAI: false
        });
        
        room.players.push(player._id);
        
        await player.save();
        await room.save();

        console.log(`Player ${playerName} joined room ${roomCode}`);
        res.status(200).json({ 
            success: true, 
            message: 'Joined room successfully', 
            roomCode, 
            playerId: player._id 
        });

    } catch (error) {
        console.error('Error joining room:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// =========================================================================
// Socket.IO Logic
// =========================================================================
const io = socketIo(server, {
    cors: {
        origin: 'https://mgt-toozabackend.onrender.com', // Adjust this to your client's URL
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// In-memory map for game engine instances
const gameEngines = {};

io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

    // Join a game room with the socket
    socket.on('join-game', async ({ playerId, roomCode }) => {
        try {
            const player = await Player.findById(playerId);
            const room = await Room.findOne({ code: roomCode }).populate('players');
            
            if (!player || !room) {
                return socket.emit('error', { message: 'Player or room not found.' });
            }

            // Update player's socket ID and status
            player.socketId = socket.id;
            player.isActive = true;
            player.lastSeen = new Date();
            await player.save();

            // Join the socket room
            socket.join(roomCode);
            console.log(`Socket ${socket.id} joined room ${roomCode}`);

            // Instantiate or get the game engine for the room
            if (!gameEngines[roomCode]) {
                gameEngines[roomCode] = new GameEngine(roomCode);
                gameEngines[roomCode].gameState = room.gameState;
            }

            // Update game state with live players
            gameEngines[roomCode].updatePlayers(room.players);
            
            // Broadcast the updated game state to all players in the room
            const currentGameState = gameEngines[roomCode].getGameState();
            io.to(roomCode).emit('game-state', currentGameState);
            io.to(roomCode).emit('player-joined', { username: player.username });

            // Check if an AI needs to play after a player joins
            if (currentGameState.status === 'playing') {
                checkAndProcessAITurn(roomCode);
            }

        } catch (error) {
            console.error('Error in join-game:', error);
            socket.emit('error', { message: 'Failed to join game.' });
        }
    });

    // Handle game actions
    socket.on('game-action', async ({ action, data }) => {
        try {
            const player = await Player.findOne({ socketId: socket.id });
            if (!player) {
                return socket.emit('error', { message: 'Player not found.' });
            }

            const roomCode = player.roomCode;
            const gameEngine = gameEngines[roomCode];
            if (!gameEngine) {
                return socket.emit('error', { message: 'Game not found.' });
            }

            // Handle the action
            const result = gameEngine.handleAction(action, player._id, data);
            
            if (result.success) {
                // Update the database with the new game state
                const room = await Room.findOneAndUpdate(
                    { code: roomCode },
                    { gameState: gameEngine.getGameState() },
                    { new: true, populate: 'players' }
                );
                
                // Emit the new game state to all players in the room
                io.to(roomCode).emit('game-state', room.gameState);

                // If the game is still playing, check and process AI turn
                if (room.gameState.status === 'playing') {
                    checkAndProcessAITurn(roomCode);
                }

            } else {
                socket.emit('error', { message: result.error });
            }

        } catch (error) {
            console.error('Error in game-action:', error);
            socket.emit('error', { message: 'An unexpected error occurred during the game action.' });
        }
    });

    // Player leaves room
    socket.on('leave-room', async ({ playerId, roomCode }) => {
        try {
            const room = await Room.findOne({ code: roomCode });
            if (!room) return;

            // Remove player from the room
            await Player.findByIdAndDelete(playerId);

            // Reload players to get the updated list
            const updatedRoom = await Room.findOne({ code: roomCode }).populate('players');

            // Update the game engine and broadcast
            if (gameEngines[roomCode]) {
                gameEngines[roomCode].updatePlayers(updatedRoom.players);
                io.to(roomCode).emit('game-state', gameEngines[roomCode].getGameState());
            }

            // If the room is now empty, clean it up
            if (updatedRoom.players.length === 0) {
                delete gameEngines[roomCode];
                await Room.findByIdAndDelete(updatedRoom._id);
                console.log(`Room ${roomCode} is empty and has been deleted.`);
            }

        } catch (error) {
            console.error('Error leaving room:', error);
        }
    });

    socket.on('disconnect', async () => {
        console.log(`Client disconnected: ${socket.id}`);
        // Find player by socketId
        const player = await Player.findOneAndUpdate(
            { socketId: socket.id },
            { isActive: false, socketId: null, lastSeen: new Date() }
        );

        if (player) {
            // Find the room and update its game state
            const room = await Room.findOne({ code: player.roomCode }).populate('players');
            if (room && gameEngines[room.code]) {
                gameEngines[room.code].updatePlayers(room.players);
                // Broadcast to remaining players
                io.to(room.code).emit('game-state', gameEngines[room.code].getGameState());
            }
        }
    });
});

// =========================================================================
// Utility Functions
// =========================================================================
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

async function checkAndProcessAITurn(roomCode) {
    const gameEngine = gameEngines[roomCode];
    if (!gameEngine || !gameEngine.shouldProcessAITurn()) {
        return;
    }

    // Delay the AI's turn to make it feel more natural
    const delay = Math.floor(Math.random() * 2000) + 1000; // 1 to 3 seconds
    setTimeout(async () => {
        const result = gameEngine.processAITurn();
        if (result.success) {
            // Update the database and broadcast the new state
            const room = await Room.findOneAndUpdate(
                { code: roomCode },
                { gameState: gameEngine.getGameState() },
                { new: true, populate: 'players' }
            );
            
            io.to(roomCode).emit('game-state', room.gameState);

            // After the AI plays, check if the next player is also an AI
            checkAndProcessAITurn(roomCode);
        } else {
            console.error('AI turn failed:', result.error);
        }
    }, delay);
}

// =========================================================================
// Cleanup Routine (for stale players and rooms)
// =========================================================================
setInterval(async () => {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
        
        // Delete inactive human players (not AI players)
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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
