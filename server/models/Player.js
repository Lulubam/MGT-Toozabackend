const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    username: { 
        type: String, 
        required: true 
    },
    roomCode: { 
        type: String, 
        required: true 
    },
    socketId: { 
        type: String, 
        default: null 
    },
    isActive: { 
        type: Boolean, 
        default: true 
    }
}, { 
    timestamps: true 
});

playerSchema.index({ username: 1, roomCode: 1 }, { unique: true });

module.exports = mongoose.model('Player', playerSchema);
