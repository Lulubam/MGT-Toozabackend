// game/GameEngine.jsvs4deepseek
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

  setDealingMode(autoDeal, highCard) {
    this.gameState.autoDeal = !!autoDeal;
    this.gameState.highCardDealer = !!highCard;
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
    
    // Only include non-eliminated players
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    
    activePlayers.forEach((p, i) => {
      draws.push({ player: p, card: tempDeck[i], index: this.gameState.players.indexOf(p) });
    });

    const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };

    const winner = this.gameState.highCardDealer
      ? draws.reduce((a, b) => cardRanks[b.card.rank] > cardRanks[a.card.rank] ? b : a)
      : draws.reduce((a, b) => cardRanks[b.card.rank] < cardRanks[a.card.rank] ? b : a);

    this.gameState.dealerIndex = winner.index;
    this.gameState.players[winner.index].isDealer = true;
    
    // Set the first player to the left of the dealer
    this.gameState.currentPlayerIndex = this.getNextPlayerIndex(winner.index);
    this.updateCurrentPlayer();
  }

  getNextPlayerIndex(startIndex) {
    let nextIndex = (startIndex + 1) % this.gameState.players.length;
    while (this.gameState.players[nextIndex].isEliminated) {
      nextIndex = (nextIndex + 1) % this.gameState.players.length;
    }
    return nextIndex;
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
    const dealerIndex = this.gameState.dealerIndex;
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    const playerCount = activePlayers.length;

    // Clear all players' hands first
    this.gameState.players.forEach(p => p.cards = []);

    // First phase: Deal 3 cards to each player
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < playerCount; j++) {
        const playerIndex = (dealerIndex + 1 + j) % this.gameState.players.length;
        const player = this.gameState.players[playerIndex];
        if (!player.isEliminated && this.gameState.deck.length > 0) {
          player.cards.push(this.gameState.deck.pop());
        }
      }
    }

    // Second phase: Deal 2 cards to each player
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < playerCount; j++) {
        const playerIndex = (dealerIndex + 1 + j) % this.gameState.players.length;
        const player = this.gameState.players[playerIndex];
        if (!player.isEliminated && this.gameState.deck.length > 0) {
          player.cards.push(this.gameState.deck.pop());
        }
      }
    }

    // Set the first player to the left of the dealer
    this.gameState.currentPlayerIndex = this.getNextPlayerIndex(dealerIndex);
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

  handleAction(action, playerId, cardId) {
    const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer._id !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    if (action === 'playCard') {
      const cardIndex = currentPlayer.cards.findIndex(c => c.id === cardId);
      if (cardIndex === -1) return { success: false, error: 'Card not in hand' };

      const card = currentPlayer.cards[cardIndex];
      const isValid = this.isValidPlay(card, currentPlayer);
      if (!isValid) {
        currentPlayer.points += 2;
        currentPlayer.cards.splice(cardIndex, 1);
        this.nextPlayer();
        return { success: true, message: 'Foul play: penalty applied' };
      }

      this.gameState.currentTrick.push({
        card,
        player: currentPlayer.username,
        avatar: currentPlayer.avatar
      });

      if (!this.gameState.callingSuit) {
        this.gameState.callingSuit = card.suit;
      }

      currentPlayer.cards.splice(cardIndex, 1);

      if (this.gameState.currentTrick.length === this.gameState.players.length) {
        const winner = this.determineTrickWinner();
        this.gameState.players.find(p => p.username === winner).points += 1;
        this.endTrick();
      } else {
        this.nextPlayer();
      }

      return { success: true, message: 'Card played' };
    }

    return { success: false, error: 'Unknown action' };
  }

  isValidPlay(card, player) {
    if (this.gameState.currentTrick.length === 0) return true;
    if (!this.gameState.callingSuit) return true;
    const hasCallingSuit = player.cards.some(c => c.suit === this.gameState.callingSuit);
    if (hasCallingSuit && card.suit !== this.gameState.callingSuit) {
      return false;
    }
    return true;
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

  getNextPlayer(index) {
    do {
      index = (index + 1) % this.gameState.players.length;
    } while (this.gameState.players[index].isEliminated);
    return this.gameState.players[index].username;
  }
}

module.exports = GameEngine;
