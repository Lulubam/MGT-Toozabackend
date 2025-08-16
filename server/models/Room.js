const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    code: { 
        type: String, 
        required: true, 
        unique: true 
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
        default: 4 
    }
}, { 
    timestamps: true 
});

module.exports = mongoose.model('Room', roomSchema);
