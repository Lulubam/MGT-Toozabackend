// models/Room.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const roomSchema = new Schema({
    // A unique, human-readable code for the room (e.g., "G2D1F7")
    code: {
        type: String,
        required: true,
        unique: true
    },
    // The current state of the game, which will be updated in your game-action handler
    gameState: {
        type: Object,
        required: true
    },
    // An array of player IDs or objects that are currently in the room
    players: [{
        type: Schema.Types.ObjectId, // Reference the Player model
        ref: 'Player'
    }],
    // Timestamp for when the room was created
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Create and export the Mongoose model
const Room = mongoose.model('Room', roomSchema);
module.exports = Room;
