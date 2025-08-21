// models/Room.js
const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    code: { 
        type: String, 
        required: true, 
        unique: true,
        uppercase: true
    },
    players: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Player' 
    }],
    gameState: { 
        type: mongoose.Schema.Types.Mixed, 
        default: {} 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    },
    maxPlayers: { 
        type: Number, 
        default: 6,  // Updated from 4 to 6
        min: 2,
        max: 6
    },
    status: {
        type: String,
        enum: ['waiting', 'playing', 'finished'],
        default: 'waiting'
    }
}, { 
    timestamps: true 
});

// Index for efficient queries
roomSchema.index({ code: 1 });

// Auto-delete inactive rooms after 24 hours
roomSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Room', roomSchema);
