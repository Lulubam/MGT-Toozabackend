// models/Player.js
const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    username: { 
        type: String, 
        required: true,
        trim: true,
        maxlength: 50
    },
    roomCode: { 
        type: String, 
        required: true,
        uppercase: true
    },
    socketId: { 
        type: String, 
        default: null 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    },
    isAI: {
        type: Boolean,
        default: false
    },
    aiLevel: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced'],
        default: null
    },
    avatar: {
        type: String,
        default: '👤'
    },
    lastSeen: {
        type: Date,
        default: Date.now
    }
}, { 
    timestamps: true 
});

// Compound index for username and roomCode uniqueness
playerSchema.index({ username: 1, roomCode: 1 }, { unique: true });

// Index for cleanup operations
playerSchema.index({ socketId: 1, updatedAt: 1 });
playerSchema.index({ roomCode: 1 });

// Update lastSeen on save
playerSchema.pre('save', function(next) {
    this.lastSeen = new Date();
    next();
});

module.exports = mongoose.model('Player', playerSchema);
