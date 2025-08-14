// server.js
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
    useNewUrlParser: true,
    useUnifiedTopology: true,
    retryWrites: true,
    w: 'majority'
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
