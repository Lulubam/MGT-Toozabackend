const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  avatar: { type: String, default: '👤' },
  rings: {
    gold: { type: Number, default: 0 },
    platinum: { type: Number, default: 0 },
    diamond: { type: Number, default: 0 }
  },
  stats: {
    gamesPlayed: { type: Number, default: 0 },
    roundsWon: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Player', playerSchema);
