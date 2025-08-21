// game/GameEngine.js
class GameEngine {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.gameState = {
      status: 'waiting',
      players: [],
      currentTrick: [],
      trickHistory: [],
      gamePhase: 'waiting',
      deck: [],
      round: 1,
      currentPlayerIndex: 0,
      dealerIndex: 0,
      callingSuit: null,
      trickWinner: null,
      finalTrickWinner: null,
      autoDeal: true,
      highCardDealer: true,
      dealingPhase: 'not-started',
      nextPlayerToDeal: null
    };
  }

  getGameState() {
    return JSON.parse(JSON.stringify(this.gameState));
  }

  updatePlayers(dbPlayers) {
    const playerIds = dbPlayers.map(p => p._id.toString());
    this.gameState.players = this.gameState.players.filter(p =>
      playerIds.includes(p._id) || p.isAI
    );

    dbPlayers.forEach(dbPlayer => {
      const existing = this.gameState.players.find(p => p._id === dbPlayer._id.toString());
      if (!existing && !dbPlayer.isAI) {
        this.gameState.players.push({
          _id: dbPlayer._id,
          username: dbPlayer.username,
          isAI: dbPlayer.isAI,
          aiLevel: dbPlayer.aiLevel,
          avatar: dbPlayer.avatar,
          socketId: dbPlayer.socketId,
          isDealer: false,
          isCurrent: false,
          isActive: true,
          isEliminated: false,
          cards: [],
          points: 0
        });
      }
    });
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
    if (this.gameState.players.length >= 6) {
      return { success: false, error: 'Room is full (max 6 players)' };
    }

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
      isEliminated: false,
      socketId: 'AI_PLAYER'
    });

    return { success: true, message: `${config.name} joined` };
  }

  removeAIPlayer(aiKey) {
    const AI_PLAYERS = { ... }; // same as above
    const config = AI_PLAYERS[aiKey];
    if (!config) return { success: false, error: 'Invalid AI' };

    const index = this.gameState.players.findIndex(p => p.username === config.name && p.isAI);
    if (index === -1) return { success: false, error: 'AI not found' };

    this.gameState.players.splice(index, 1);
    this.updateCurrentPlayer();
    return { success: true, message: `${config.name} left` };
  }

  setDealingMode(autoDeal, highCard) {
    this.gameState.autoDeal = autoDeal;
    this.gameState.highCardDealer = highCard;
    return { success: true };
  }

  startGame() {
    const active = this.gameState.players.filter(p => !p.isEliminated);
    if (active.length < 2) return { success: false, error: 'Need at least 2 players' };

    this.selectInitialDealer();
    this.gameState.status = 'waiting';
    this.gameState.gamePhase = this.gameState.autoDeal ? 'playing' : 'manual-dealing';
    
    if (this.gameState.autoDeal) {
      this.dealCards();
      this.gameState.status = 'playing';
    } else {
      this.gameState.nextPlayerToDeal = this.getNextPlayer(this.gameState.dealerIndex);
    }

    return { success: true, message: 'Game started!' };
  }

  selectInitialDealer() {
    const tempDeck = this.shuffleDeck(this.createStandardDeck());
    const draws = [];
    this.gameState.players.forEach((p, i) => {
      draws.push({ player: p, card: tempDeck[i], index: i });
    });

    const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
    
    const winner = this.gameState.highCardDealer
      ? draws.reduce((a, b) => cardRanks[b.card.rank] > cardRanks[a.card.rank] ? b : a)
      : draws.reduce((a, b) => cardRanks[b.card.rank] < cardRanks[a.card.rank] ? b : a);

    this.gameState.dealerIndex = winner.index;
    this.gameState.players[winner.index].isDealer = true;
  }

  createStandardDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '10', '9', '8', '7', '6', '5', '4', '3'];
    const deck = [];
    let id = 1;
    suits.forEach(suit => {
      ranks.forEach(rank => {
        deck.push({ suit, rank, id: id++, id: `${rank}${suit}` });
      });
    });
    return deck;
  }

  shuffleDeck(deck) {
    const d = [...deck];
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  dealCards() {
    this.gameState.deck = this.shuffleDeck(this.createStandardDeck());
    const dealer = this.gameState.dealerIndex;
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);

    for (let phase = 0; phase < 2; phase++) {
      const cardsToDeal = phase === 0 ? 3 : 2;
      for (let i = 0; i < cardsToDeal; i++) {
        let idx = (dealer + 1) % this.gameState.players.length;
        for (let j = 0; j < activePlayers.length; j++) {
          while (this.gameState.players[idx].isEliminated) {
            idx = (idx + 1) % this.gameState.players.length;
          }
          if (this.gameState.deck.length > 0) {
            this.gameState.players[idx].cards.push(this.gameState.deck.pop());
          }
          idx = (idx + 1) % this.gameState.players.length;
        }
      }
    }

    this.gameState.currentPlayerIndex = (dealer + 1) % this.gameState.players.length;
    this.updateCurrentPlayer();
  }

  dealNextCard() {
    const totalCards = this.gameState.players.filter(p => !p.isEliminated).length * 5;
    const dealt = this.gameState.players.reduce((sum, p) => sum + p.cards.length, 0);

    if (dealt >= totalCards) {
      this.gameState.gamePhase = 'playing';
      this.gameState.status = 'playing';
      return { success: true, message: 'All cards dealt!' };
    }

    const player = this.gameState.players[this.gameState.currentPlayerIndex];
    const card = this.gameState.deck.pop();
    player.cards.push(card);

    this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.gameState.players.length;
    while (this.gameState.players[this.gameState.currentPlayerIndex].isEliminated) {
      this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.gameState.players.length;
    }

    this.gameState.nextPlayerToDeal = this.gameState.players[this.gameState.currentPlayerIndex].username;
    return { success: true, message: `Dealt to ${player.username}` };
  }

  updateCurrentPlayer() {
    this.gameState.players.forEach((p, i) => {
      p.isCurrent = i === this.gameState.currentPlayerIndex;
    });
  }

  getNextPlayer(index) {
    do {
      index = (index + 1) % this.gameState.players.length;
    } while (this.gameState.players[index].isEliminated);
    return this.gameState.players[index].username;
  }

  // ... rest of GameEngine methods (playCard, handleAction, etc.)
}

module.exports = GameEngine;
