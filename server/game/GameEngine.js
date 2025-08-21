// game/GameEngine.jsvs3claude
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
      nextPlayerToDeal: null,
      dealingCards: [], // Cards dealt during manual dealing phase
      dealingPhase: 1, // 1 = first phase (3 cards), 2 = second phase (2 cards)
      dealingRound: 0 // Current round within phase
    };
  }

  getGameState() {
    return JSON.parse(JSON.stringify(this.gameState));
  }

  updatePlayers(dbPlayers) {
    const playerIds = dbPlayers.map(p => p._id.toString());
    
    // Remove players no longer in room (except AI players that were added locally)
    this.gameState.players = this.gameState.players.filter(p => {
      if (p.isAI && p._id.startsWith('ai_')) {
        // Keep AI players that were added through the game engine
        return true;
      }
      return playerIds.includes(p._id);
    });

    // Add new players from database
    dbPlayers.forEach(dbPlayer => {
      const existing = this.gameState.players.find(p => p._id === dbPlayer._id.toString());
      if (!existing) {
        this.gameState.players.push({
          _id: dbPlayer._id.toString(),
          username: dbPlayer.username,
          isAI: dbPlayer.isAI,
          aiLevel: dbPlayer.aiLevel,
          avatar: dbPlayer.avatar,
          socketId: dbPlayer.socketId,
          isDealer: dbPlayer.isDealer || false,
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

    // Reset all players to non-dealer status
    this.gameState.players.forEach(p => p.isDealer = false);

    this.selectInitialDealer();
    this.gameState.status = 'dealing';
    this.gameState.gamePhase = 'dealer-selection';

    if (this.gameState.autoDeal) {
      this.dealCards();
      this.gameState.status = 'playing';
      this.gameState.gamePhase = 'playing';
    } else {
      this.gameState.gamePhase = 'manual-dealing';
      this.gameState.dealingPhase = 1;
      this.gameState.dealingRound = 0;
      this.initializeManualDealing();
    }

    return { success: true, message: 'Game started! Dealer selected.' };
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
    
    // Player to the left of dealer goes first
    this.gameState.currentPlayerIndex = this.getNextActivePlayerIndex(this.gameState.dealerIndex);
    this.updateCurrentPlayer();

    // Store dealer selection cards for display
    this.gameState.dealerSelection = draws.map(d => ({
      player: d.player.username,
      card: d.card,
      isWinner: d.index === winner.index
    }));
  }

  initializeManualDealing() {
    this.gameState.deck = this.shuffleDeck(this.createStandardDeck());
    
    // Start dealing from player to dealer's left
    this.gameState.currentPlayerIndex = this.getNextActivePlayerIndex(this.gameState.dealerIndex);
    this.gameState.nextPlayerToDeal = this.gameState.players[this.gameState.currentPlayerIndex].username;
    this.updateCurrentPlayer();
  }

  createStandardDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '10', '9', '8', '7', '6', '5', '4', '3'];
    const deck = [];
    
    suits.forEach(suit => {
      ranks.forEach(rank => {
        deck.push({ 
          suit, 
          rank, 
          id: `${rank}${suit}`,
          color: (suit === '♥' || suit === '♦') ? 'red' : 'black'
        });
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

    // Clear all player cards
    this.gameState.players.forEach(p => p.cards = []);

    // First phase: 3 cards each
    for (let round = 0; round < 3; round++) {
      let currentIndex = this.getNextActivePlayerIndex(dealerIndex);
      for (let i = 0; i < activePlayers.length; i++) {
        if (this.gameState.deck.length > 0) {
          this.gameState.players[currentIndex].cards.push(this.gameState.deck.pop());
        }
        currentIndex = this.getNextActivePlayerIndex(currentIndex);
      }
    }

    // Second phase: 2 cards each
    for (let round = 0; round < 2; round++) {
      let currentIndex = this.getNextActivePlayerIndex(dealerIndex);
      for (let i = 0; i < activePlayers.length; i++) {
        if (this.gameState.deck.length > 0) {
          this.gameState.players[currentIndex].cards.push(this.gameState.deck.pop());
        }
        currentIndex = this.getNextActivePlayerIndex(currentIndex);
      }
    }

    // Set first player (to dealer's left)
    this.gameState.currentPlayerIndex = this.getNextActivePlayerIndex(dealerIndex);
    this.updateCurrentPlayer();
  }

  dealNextCard() {
    if (!this.gameState.deck || this.gameState.deck.length === 0) {
      this.gameState.deck = this.shuffleDeck(this.createStandardDeck());
    }

    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    const cardsPerPlayer = this.gameState.dealingPhase === 1 ? 3 : 2;
    const totalCardsNeeded = activePlayers.length * 5;
    const currentlyDealt = this.gameState.players.reduce((sum, p) => sum + p.cards.length, 0);

    if (currentlyDealt >= totalCardsNeeded) {
      this.gameState.gamePhase = 'playing';
      this.gameState.status = 'playing';
      // Set first player to dealer's left
      this.gameState.currentPlayerIndex = this.getNextActivePlayerIndex(this.gameState.dealerIndex);
      this.updateCurrentPlayer();
      return { success: true, message: 'All cards dealt! Game starting...' };
    }

    // Deal card to current player
    const currentPlayerIndex = this.gameState.currentPlayerIndex;
    const player = this.gameState.players[currentPlayerIndex];
    
    if (this.gameState.deck.length > 0) {
      const card = this.gameState.deck.pop();
      player.cards.push(card);
    }

    this.gameState.dealingRound++;

    // Check if we need to move to next phase or next round
    if (this.gameState.dealingRound >= cardsPerPlayer * activePlayers.length) {
      if (this.gameState.dealingPhase === 1) {
        this.gameState.dealingPhase = 2;
        this.gameState.dealingRound = 0;
      }
    }

    // Move to next player (clockwise from dealer)
    this.gameState.currentPlayerIndex = this.getNextActivePlayerIndex(currentPlayerIndex);
    this.gameState.nextPlayerToDeal = this.gameState.players[this.gameState.currentPlayerIndex].username;
    this.updateCurrentPlayer();

    return { success: true, message: `Dealt card to ${player.username}` };
  }

  getNextActivePlayerIndex(currentIndex) {
    let nextIndex = (currentIndex + 1) % this.gameState.players.length;
    while (this.gameState.players[nextIndex].isEliminated) {
      nextIndex = (nextIndex + 1) % this.gameState.players.length;
    }
    return nextIndex;
  }

  handleAction(action, playerId, cardId) {
    if (this.gameState.gamePhase !== 'playing') {
      return { success: false, error: 'Game not in playing phase' };
    }

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
        return { success: true, message: `${currentPlayer.username} committed a foul! +2 penalty points` };
      }

      // Add card to current trick
      this.gameState.currentTrick.push({
        card,
        player: currentPlayer.username,
        avatar: currentPlayer.avatar,
        playerId: currentPlayer._id
      });

      // Set calling suit if first card
      if (!this.gameState.callingSuit && this.gameState.currentTrick.length === 1) {
        this.gameState.callingSuit = card.suit;
      }

      // Remove card from player's hand
      currentPlayer.cards.splice(cardIndex, 1);

      // Check if trick is complete
      const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
      if (this.gameState.currentTrick.length >= activePlayers.length) {
        const winner = this.determineTrickWinner();
        this.gameState.trickWinner = winner;
        
        // Award point to trick winner
        const winnerPlayer = this.gameState.players.find(p => p.username === winner);
        if (winnerPlayer) {
          winnerPlayer.points += 1;
        }
        
        this.endTrick();
        
        // Check if this was the final trick
        if (this.gameState.players.every(p => p.isEliminated || p.cards.length === 0)) {
          this.endRound();
        }
      } else {
        this.nextPlayer();
      }

      return { success: true, message: `${currentPlayer.username} played ${card.rank}${card.suit}` };
    }

    return { success: false, error: 'Unknown action' };
  }

  isValidPlay(card, player) {
    // First card of trick is always valid
    if (this.gameState.currentTrick.length === 0) return true;
    if (!this.gameState.callingSuit) return true;
    
    // Check if player has cards of the calling suit
    const hasCallingSuit = player.cards.some(c => c.suit === this.gameState.callingSuit);
    
    // If player has calling suit cards, they must play one
    if (hasCallingSuit && card.suit !== this.gameState.callingSuit) {
      return false;
    }
    
    return true;
  }

  determineTrickWinner() {
    if (this.gameState.currentTrick.length === 0) return null;

    const leadSuit = this.gameState.currentTrick[0].card.suit;
    const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };

    let winner = this.gameState.currentTrick[0];
    
    for (const play of this.gameState.currentTrick) {
      const current = play.card;
      const best = winner.card;
      
      // Only cards of the lead suit can win
      if (current.suit === leadSuit && best.suit === leadSuit) {
        if (cardRanks[current.rank] > cardRanks[best.rank]) {
          winner = play;
        }
      } else if (current.suit === leadSuit && best.suit !== leadSuit) {
        winner = play;
      }
    }

    return winner.player;
  }

  endTrick() {
    // Store completed trick in history
    this.gameState.trickHistory.push([...this.gameState.currentTrick]);
    
    // Clear current trick
    this.gameState.currentTrick = [];
    this.gameState.callingSuit = null;
    
    // Winner of trick leads next trick
    const winnerIndex = this.gameState.players.findIndex(p => p.username === this.gameState.trickWinner);
    if (winnerIndex !== -1) {
      this.gameState.currentPlayerIndex = winnerIndex;
      this.updateCurrentPlayer();
    }
  }

  endRound() {
    // Determine final trick winner and apply damage
    if (this.gameState.trickHistory.length > 0) {
      const finalTrick = this.gameState.trickHistory[this.gameState.trickHistory.length - 1];
      const finalWinner = this.determineTrickWinner();
      
      // Player next to final trick winner takes damage
      const winnerIndex = this.gameState.players.findIndex(p => p.username === finalWinner);
      const nextPlayerIndex = this.getNextActivePlayerIndex(winnerIndex);
      const damagedPlayer = this.gameState.players[nextPlayerIndex];
      
      // Calculate damage based on final trick winning card
      const winningCard = finalTrick.find(play => play.player === finalWinner)?.card;
      const damage = this.calculateCardValue(winningCard);
      
      damagedPlayer.points += damage;
      
      // Check for elimination
      if (damagedPlayer.points >= 12) {
        damagedPlayer.isEliminated = true;
      }
    }
    
    // Check for game end
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (activePlayers.length <= 1) {
      this.gameState.status = 'finished';
      this.gameState.gamePhase = 'finished';
    } else {
      // Prepare for next round
      this.gameState.round++;
      this.gameState.trickHistory = [];
      this.gameState.currentTrick = [];
      // Next dealer is the player to the left of current dealer
      this.gameState.dealerIndex = this.getNextActivePlayerIndex(this.gameState.dealerIndex);
      this.gameState.players.forEach(p => p.isDealer = false);
      this.gameState.players[this.gameState.dealerIndex].isDealer = true;
    }
  }

  calculateCardValue(card) {
    if (!card) return 1;
    
    if (card.rank === '3' && card.suit === '♠') return 12; // Black 3
    if (card.rank === '3') return 6; // Other 3s
    if (card.rank === '4') return 4;
    if (card.rank === 'A') return 2;
    return 1; // All other cards
  }

  updateCurrentPlayer() {
    this.gameState.players.forEach((p, i) => {
      p.isCurrent = i === this.gameState.currentPlayerIndex && !p.isEliminated;
    });
  }

  nextPlayer() {
    this.gameState.currentPlayerIndex = this.getNextActivePlayerIndex(this.gameState.currentPlayerIndex);
    this.updateCurrentPlayer();
  }
}

module.exports = GameEngine;
