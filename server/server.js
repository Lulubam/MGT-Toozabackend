// server.js - Fixed Server with Proper AI Management
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
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trickster', {
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

// In-memory store for game engines
const gameEngines = {};

// =========================================================================
// Real-time communication via Socket.IO
// =========================================================================
const io = socketIo(server, {
    cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST']
    }
});

// A utility function to broadcast game state
const updateGameStateAndBroadcast = async (roomCode) => {
    try {
        const room = await Room.findOne({ code: roomCode }).populate('players');
        if (!room) {
            console.warn(`Room not found for broadcast: ${roomCode}`);
            return;
        }

        const gameEngine = gameEngines[roomCode];
        if (!gameEngine) {
            console.warn(`Game engine not found for room: ${roomCode}`);
            return;
        }

        // Update game engine with current players
        gameEngine.updatePlayers(room.players);
        
        // Process AI turns if needed
        if (gameEngine.shouldProcessAITurn()) {
            setTimeout(() => {
                gameEngine.processAITurn();
                updateGameStateAndBroadcast(roomCode);
            }, 1000);
        }
        
        io.to(roomCode).emit('game-state', gameEngine.getGameState());

    } catch (error) {
        console.error('Error broadcasting game state:', error);
    }
};

io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

    socket.on('join-game', async ({ playerId, roomCode }) => {
        try {
            await socket.join(roomCode);
            const room = await Room.findOne({ code: roomCode }).populate('players');
            const player = await Player.findById(playerId);

            if (!room || !player) {
                return console.error('Join failed: Room or player not found');
            }

            console.log(`Player ${player.username} (${player.socketId}) joining room ${roomCode}`);

            // Update player's socketId in the database
            player.socketId = socket.id;
            player.isActive = true;
            player.lastSeen = new Date();
            await player.save();

            // Initialize game engine if it doesn't exist
            if (!gameEngines[roomCode]) {
                gameEngines[roomCode] = new GameEngine(roomCode);
            }
            
            // Update game engine with current players
            gameEngines[roomCode].updatePlayers(room.players);

            // Send initial game state to the player
            socket.emit('game-state', gameEngines[roomCode].getGameState());
            
            // Broadcast to all players in the room
            updateGameStateAndBroadcast(roomCode);
        } catch (error) {
            console.error('Error in join-game handler:', error);
        }
    });

    socket.on('manage-ai', async ({ playerId, roomCode, action, aiKey }) => {
        try {
            const gameEngine = gameEngines[roomCode];
            if (!gameEngine) {
                return console.error('Manage AI failed: Game engine not found');
            }
    
            let result;
            if (action === 'add') {
                result = gameEngine.addAIPlayer(aiKey);
            } else if (action === 'remove') {
                result = gameEngine.removeAIPlayer(aiKey);
            } else {
                return console.error('Invalid AI action');
            }
    
            if (result.success) {
                // Create or remove AI player in database
                if (action === 'add') {
                    const aiConfig = AI_PLAYERS[aiKey];
                    const aiPlayer = new Player({
                        username: aiConfig.name,
                        roomCode: roomCode,
                        isAI: true,
                        avatar: aiConfig.avatar,
                        socketId: 'AI_' + aiKey
                    });
                    await aiPlayer.save();
                    
                    const room = await Room.findOne({ code: roomCode });
                    room.players.push(aiPlayer._id);
                    await room.save();
                } else if (action === 'remove') {
                    const aiConfig = AI_PLAYERS[aiKey];
                    const aiPlayer = await Player.findOne({ 
                        username: aiConfig.name, 
                        roomCode: roomCode,
                        isAI: true 
                    });
                    if (aiPlayer) {
                        const room = await Room.findOne({ code: roomCode });
                        room.players = room.players.filter(pId => pId.toString() !== aiPlayer._id.toString());
                        await room.save();
                        await Player.findByIdAndDelete(aiPlayer._id);
                    }
                }
                
                // Update and broadcast the new game state
                await updateGameStateAndBroadcast(roomCode);
            }
        } catch (error) {
            console.error('Error in manage-ai handler:', error);
        }
    });

    socket.on('game-action', async (data) => {
        const { playerId, roomCode, action, gameData } = data;
        
        try {
            const gameEngine = gameEngines[roomCode];
            if (!gameEngine) return;
            
            // Handle the game action
            gameEngine.handleAction(action, playerId, gameData);

            // After any game action, broadcast the new state to all players in the room
            await updateGameStateAndBroadcast(roomCode);

        } catch (error) {
            console.error('Error handling game action:', error);
        }
    });

    socket.on('disconnect', async () => {
        console.log(`Client disconnected: ${socket.id}`);
        try {
            // Find and update the player to be inactive
            const player = await Player.findOne({ socketId: socket.id });
            if (player) {
                player.isActive = false;
                player.socketId = null;
                await player.save();

                const room = await Room.findOne({ code: player.roomCode }).populate('players');
                if (room && gameEngines[room.code]) {
                    // Update the game engine state
                    const gameEngine = gameEngines[room.code];
                    gameEngine.updatePlayers(room.players);

                    if (room.players.filter(p => !p.isAI && p.isActive).length === 0) {
                        // Clean up empty rooms
                        await Player.deleteMany({ roomCode: player.roomCode, isAI: true });
                        await Room.findByIdAndDelete(room._id);
                        delete gameEngines[player.roomCode];
                        console.log(`Cleaned up empty room: ${player.roomCode}`);
                    } else {
                        await updateGameStateAndBroadcast(room.code);
                    }
                }
            }
        } catch (err) {
            console.error('Error on disconnect:', err);
        }
    });
});

// =========================================================================
// API Routes - Fixed for Better Player Management
// =========================================================================
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Create a new game room
app.post('/api/create-room', async (req, res) => {
    try {
        const { playerName } = req.body;
        if (!playerName) {
            return res.status(400).json({ success: false, error: 'Player name is required' });
        }

        const roomCode = generateRoomCode();
        
        // Create player first
        const player = new Player({
            username: playerName,
            roomCode: roomCode,
            isDealer: false,
            isAI: false,
            isActive: true
        });
        await player.save();
        
        // Create room with the player
        const newRoom = new Room({
            code: roomCode,
            maxPlayers: 4,
            players: [player._id]
        });
        await newRoom.save();

        // Initialize game engine
        gameEngines[roomCode] = new GameEngine(roomCode);

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

        // Check if player name already exists in room
        const existingPlayer = room.players.find(p => p.username === playerName && !p.isAI);
        if (existingPlayer) {
            return res.status(400).json({ success: false, error: 'Player name already taken in this room' });
        }

        const player = new Player({
            username: playerName,
            roomCode: roomCode,
            isAI: false,
            isActive: true
        });
        await player.save();
        
        room.players.push(player._id);
        await room.save();

        // Update game engine with new player
        if (gameEngines[roomCode]) {
            gameEngines[roomCode].updatePlayers(room.players);
        }

        console.log(`Player ${playerName} joined room: ${roomCode}`);
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

// Utility to clean up old, inactive players and rooms
setInterval(async () => {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        // Find and remove inactive human players
        const inactiveHumanPlayers = await Player.find({ 
            isAI: false,
            lastSeen: { $lt: oneDayAgo } 
        });
        
        for (const player of inactiveHumanPlayers) {
            const room = await Room.findOne({ code: player.roomCode }).populate('players');
            if (room) {
                const gameEngine = gameEngines[room.code];
                if (gameEngine) {
                    gameEngine.updatePlayers(room.players.filter(p => p._id.toString() !== player._id.toString()));
                }
                
                room.players = room.players.filter(pId => pId.toString() !== player._id.toString());
                await room.save();
                
                if (room.players.length === 0) {
                    await Player.deleteMany({ roomCode: player.roomCode, isAI: true });
                    await Room.findByIdAndDelete(room._id);
                    delete gameEngines[player.roomCode];
                    console.log(`Cleaned up empty room: ${player.roomCode}`);
                }
            }
            await Player.findByIdAndDelete(player._id);
        }
        
        console.log(`Cleanup completed - removed ${inactiveHumanPlayers.length} inactive players`);
    } catch (err) {
        console.error('Cleanup error:', err);
    }
}, 60 * 60 * 1000); // Run every hour

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        activeRooms: Object.keys(gameEngines).length
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'Trick-Taking Card Game Server is running!',
        features: [
            'Create/Join rooms',
            'Add/Remove AI players in-game',
            'Real-time multiplayer with proper synchronization', 
            'Trick-taking game rules implementation',
            'Advanced AI with different difficulty levels',
            'Elimination-based scoring system'
        ]
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Trick-Taking Game Server running on port ${PORT}`));
