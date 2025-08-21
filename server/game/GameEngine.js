// game/GameEngine.js
class GameEngine {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.gameState = {
      players: [],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      status: 'waiting',
      gamePhase: 'waiting',
      round: 1,
      trickHistory: [],
      currentTrick: [],
      callingSuit: null,
      trickWinner: null,
      finalTrickWinner: null,
      deck: []
    };
  }

  updatePlayers(dbPlayers) {
    this.gameState.players = this.gameState.players.map(p => {
      const dbPlayer = dbPlayers.find(dp => dp.username === p.username);
      if (dbPlayer && !p.isAI) {
        return { ...p, _id: dbPlayer._id };
      }
      return p;
    }).filter(p => dbPlayers.some(dp => dp.username === p.username || p.isAI));
  }

  addAIPlayer(aiKey) {
    const AI_PLAYERS = {
      otu: { name: 'Otu', level: 'beginner', avatar: '🤖' },
      ase: { name: 'Ase', level: 'beginner', avatar: '🎭' },
      dede: { name: 'Dede', level: 'intermediate', avatar: '🎪' },
      ogbologbo: { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
      agba: { name: 'Agba', level: 'advanced', avatar: '👑' }
    };

    const config = AI_PLAYERS[aiKey];
    if (!config) return { success: false, error: 'Invalid AI' };
    if (this.gameState.players.length >= 4) return { success: false, error: 'Room full' };

    const exists = this.gameState.players.some(p => p.username === config.name && p.isAI);
    if (exists) return { success: false, error: 'AI already in room' };

    this.gameState.players.push({
      _id: `ai_${aiKey}_${Date.now()}`,
      username: config.name,
      isAI: true,
      aiLevel: config.level,
      avatar: config.avatar,
      cards: [],
      points: 0,
      isDealer: false,
      isCurrent: false,
      isActive: true,
      isEliminated: false
    });

    return { success: true };
  }

  removeAIPlayer(aiKey) {
    const AI_PLAYERS = { ... }; // same as above
    const config = AI_PLAYERS[aiKey];
    const index = this.gameState.players.findIndex(p => p.username === config.name && p.isAI);
    if (index === -1) return { success: false, error: 'AI not found' };
    this.gameState.players.splice(index, 1);
    return { success: true };
  }

  // Add your other methods: startGame, dealCards, etc.
  // (Kept for brevity — same as previous versions)
}

module.exports = GameEngine;
