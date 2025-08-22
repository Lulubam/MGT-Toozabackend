// game/GameEngine.jsv7qwen
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
      dealingMode: 'auto',
      gameOver: false,
      lastTrickOptOut: false,
      nextPlayerToDeal: null,
      cardsDealt: 0,
      totalCardsToDeal: 0
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
    const AI_PLAYERS = {
      otu: { name: 'Otu', level: 'beginner', avatar: '🤖' },
      ase: { name: 'Ase', level: 'beginner', avatar: '🎭' },
      dede: { name: 'Dede', level: 'intermediate', avatar: '🎪' },
      ogbologbo: { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
      agba: { name: 'Agba', level: 'advanced', avatar: '👑' }
    };

    const config = AI_PLAYERS[aiKey];
    if (!config) return { success: false, error: 'Invalid AI' };

    const index = this.gameState.players.findIndex(p => p.username === config.name && p.isAI);
    if (index === -1) return { success: false, error: 'AI not found' };

    this.gameState.players.splice(index, 1);
    this.updateCurrentPlayer();
    return { success: true, message: `${config.name} left` };
  }

  setDealingMode(mode) {
    this.gameState.dealingMode = mode;
    return { success: true };
  }

  selectInitialDealer() {
    const tempDeck = this.shuffleDeck(this.createStandardDeck());
    let maxRank = -1;
    let dealerIndex = 0;
    const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };

    this.gameState.players.forEach((p, i) => {
      const rank = cardRanks[tempDeck[i]?.rank] || 0;
      if (rank > maxRank) {
        maxRank = rank;
        dealerIndex = i;
      }
    });

    this.gameState.dealerIndex = dealerIndex;
    this.gameState.players[dealerIndex].isDealer = true;
    this.gameState.currentPlayerIndex = (dealerIndex + 1) % this.gameState.players.length;
    this.updateCurrentPlayer();

    return { success: true, message: `${this.gameState.players[dealerIndex].username} is dealer` };
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

  startGame() {
    const active = this.gameState.players.filter(p => !p.isEliminated);
    if (active.length < 1) return { success: false, error: 'Need at least 1 player' };

    this.selectInitialDealer();

    if (this.gameState.dealingMode === 'auto') {
      this.dealCards();
      this.gameState.status = 'playing';
      this.gameState.gamePhase = 'playing';
    } else {
      this.gameState.status = 'waiting';
      this.gameState.gamePhase = 'manual-dealing';
      this.gameState.nextPlayerToDeal = this.getNextPlayer(this.gameState.dealerIndex);
      this.gameState.cardsDealt = 0;
      this.gameState.totalCardsToDeal = active.length * 5;
    }

    return { success: true, message: 'Game started!' };
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
    if (this.gameState.cardsDealt >= this.gameState.totalCardsToDeal) {
      this.gameState.gamePhase = 'playing';
      this.gameState.status = 'playing';
      return { success: true, message: 'All cards dealt!' };
    }

    const player = this.gameState.players[this.gameState.currentPlayerIndex];
    const card = this.gameState.deck.pop();
    player.cards.push(card);

    this.gameState.cardsDealt++;
    this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.gameState.players.length;
    while (this.gameState.players[this.gameState.currentPlayerIndex].isEliminated) {
      this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.gameState.players.length;
    }

    this.gameState.nextPlayerToDeal = this.gameState.players[this.gameState.currentPlayerIndex].username;
    return { success: true, message: `Dealt to ${player.username}` };
  }

  handleAction(action, playerId, cardId) {
    const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer._id !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    if (action === 'playCard') {
      const cardIndex = currentPlayer.cards.findIndex(c => c.id === cardId);
      if (cardIndex === -1) return { success: false, error: 'Card not in hand' };

      const card = currentPlayer.cards[cardIndex];

      // ✅ Rule: Must follow suit if possible
      if (this.gameState.currentTrick.length > 0 && this.gameState.callingSuit) {
        const hasCallingSuit = currentPlayer.cards.some(c => c.suit === this.gameState.callingSuit);
        if (hasCallingSuit && card.suit !== this.gameState.callingSuit) {
          return { success: false, error: 'Must follow suit when possible' };
        }
      }

      if (this.gameState.currentTrick.length === 0) {
        this.gameState.callingSuit = card.suit;
      }

      this.gameState.currentTrick.push({
        card,
        player: currentPlayer.username,
        avatar: currentPlayer.avatar
      });

      currentPlayer.cards.splice(cardIndex, 1);

      const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
      if (this.gameState.currentTrick.length === activePlayers.length) {
        const winner = this.determineTrickWinner();
        this.gameState.trickWinner = winner;
        const winnerPlayer = this.gameState.players.find(p => p.username === winner);
        if (winnerPlayer) winnerPlayer.points += 1;

        // ✅ Last trick: fire points to next player
        if (this.gameState.trickHistory.length === 4) {
          const nextPlayer = this.getNextPlayer(this.getPlayerIndex(winner));
          const points = this.getCardPoints(card);
          nextPlayer.points += points;
        }

        this.endTrick();
      } else {
        this.nextPlayer();
      }

      return { success: true, message: 'Card played' };
    }

    return { success: false, error: 'Unknown action' };
  }

  determineTrickWinner() {
    const leadSuit = this.gameState.currentTrick[0].card.suit;
    const trumpSuit = '♠';
    const ranks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };

    let winner = this.gameState.currentTrick[0];
    for (const play of this.gameState.currentTrick) {
      const current = play.card;
      const best = winner.card;
      if (current.suit === trumpSuit && best.suit !== trumpSuit) {
        winner = play;
      } else if (current.suit === best.suit && ranks[current.rank] > ranks[best.rank]) {
        winner = play;
      }
    }

    return winner.player;
  }

  endTrick() {
    this.gameState.trickHistory.push([...this.gameState.currentTrick]);
    this.gameState.currentTrick = [];
    this.gameState.callingSuit = null;

    const winnerIndex = this.gameState.players.findIndex(p => p.username === this.gameState.trickWinner);
    this.gameState.currentPlayerIndex = winnerIndex;
    this.updateCurrentPlayer();

    if (this.gameState.trickHistory.length === 5) {
      this.prepareNextRound();
    }
  }

  prepareNextRound() {
    this.gameState.round++;
    this.gameState.trickHistory = [];
    this.gameState.callingSuit = null;
    this.selectInitialDealer();
    this.dealCards();
  }

  getCardPoints(card) {
    if (card.suit === '♠' && card.rank === '3') return 12;
    if (card.rank === '3') return 6;
    if (card.rank === '4') return 4;
    if (card.rank === 'A') return 2;
    return 1;
  }

  updateCurrentPlayer() {
    this.gameState.players.forEach((p, i) => {
      p.isCurrent = i === this.gameState.currentPlayerIndex;
    });
  }

  nextPlayer() {
    this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.gameState.players.length;
    this.updateCurrentPlayer();
  }

  getPlayerIndex(username) {
    return this.gameState.players.findIndex(p => p.username === username);
  }

  getNextPlayer(index) {
    do {
      index = (index + 1) % this.gameState.players.length;
    } while (this.gameState.players[index].isEliminated);
    return this.gameState.players[index].username;
  }
}

module.exports = GameEngine;
