// game/GameEngine.jsv8claude - Fixed Version
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
      dealerSelectionCards: [] // For dealer selection phase
    };
  }

  getGameState() {
    return JSON.parse(JSON.stringify(this.gameState));
  }

  updatePlayers(dbPlayers) {
    const playerIds = dbPlayers.map(p => p._id.toString());
    
    // Remove players not in DB (except AI that might not be in DB yet)
    this.gameState.players = this.gameState.players.filter(p =>
      playerIds.includes(p._id) || p.isAI
    );

    // Add new players from DB
    dbPlayers.forEach(dbPlayer => {
      const existing = this.gameState.players.find(p => p._id === dbPlayer._id.toString());
      if (!existing) {
        this.gameState.players.push({
          _id: dbPlayer._id.toString(),
          username: dbPlayer.username,
          isAI: dbPlayer.isAI || false,
          aiLevel: dbPlayer.aiLevel || null,
          avatar: dbPlayer.avatar || '👤',
          socketId: dbPlayer.socketId,
          isDealer: false,
          isCurrent: false,
          isActive: true,
          isEliminated: false,
          cards: [],
          points: 0
        });
      } else {
        // Update existing player info
        existing.username = dbPlayer.username;
        existing.isAI = dbPlayer.isAI || false;
        existing.avatar = dbPlayer.avatar || existing.avatar;
        existing.socketId = dbPlayer.socketId;
      }
    });
  }

  addAIPlayer(aiKey) {
    const AI_PLAYERS = {
      otu: { name: 'Otu', level: 'beginner', avatar: '🤖' },
      ase: { name: 'Ase', level: 'beginner', avatar: '🎭' },
      dede: { name: 'Dede', level: 'intermediate', avatar: '🎪' },
      ogbologbo: { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
      agba: { name: 'Agba', level: 'advanced', avatar: '🏆' }
    };

    const config = AI_PLAYERS[aiKey];
    if (!config) return { success: false, error: 'Invalid AI' };
    if (this.gameState.players.length >= 6) {
      return { success: false, error: 'Room is full (max 6 players)' };
    }

    // Check if AI already exists in game state (not just DB)
    const exists = this.gameState.players.some(p => p.username === config.name && p.isAI);
    if (exists) return { success: false, error: 'AI already in room' };

    // Add to game state
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
      agba: { name: 'Agba', level: 'advanced', avatar: '🏆' }
    };

    const config = AI_PLAYERS[aiKey];
    if (!config) return { success: false, error: 'Invalid AI' };

    const index = this.gameState.players.findIndex(p => p.username === config.name && p.isAI);
    if (index === -1) return { success: false, error: 'AI not found' };

    this.gameState.players.splice(index, 1);
    this.updateCurrentPlayer();
    return { success: true, message: `${config.name} left` };
  }

  // Dealer selection by drawing cards
  selectDealer() {
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (activePlayers.length < 2) return { success: false, error: 'Need at least 2 players' };

    // Create temporary deck for dealer selection
    const tempDeck = this.shuffleDeck(this.createStandardDeck());
    const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
    
    let maxRank = -1;
    let dealerIndex = 0;
    
    // Each player draws a card
    this.gameState.dealerSelectionCards = [];
    activePlayers.forEach((player, i) => {
      const card = tempDeck[i];
      const rank = cardRanks[card.rank];
      
      this.gameState.dealerSelectionCards.push({
        player: player.username,
        card: card,
        rank: rank
      });
      
      if (rank > maxRank) {
        maxRank = rank;
        dealerIndex = this.gameState.players.findIndex(p => p._id === player._id);
      }
    });

    // Set dealer
    this.gameState.players.forEach(p => p.isDealer = false);
    this.gameState.dealerIndex = dealerIndex;
    this.gameState.players[dealerIndex].isDealer = true;
    
    // Set first player (to the left of dealer)
    this.gameState.currentPlayerIndex = (dealerIndex + 1) % this.gameState.players.length;
    this.updateCurrentPlayer();

    return { 
      success: true, 
      message: `${this.gameState.players[dealerIndex].username} is the dealer`,
      dealerSelectionCards: this.gameState.dealerSelectionCards
    };
  }

  startGame() {
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (activePlayers.length < 2) return { success: false, error: 'Need at least 2 players' };

    // Select dealer first
    const dealerResult = this.selectDealer();
    if (!dealerResult.success) return dealerResult;

    // Deal 5 cards to each active player
    this.gameState.deck = this.shuffleDeck(this.createStandardDeck());
    const dealerIndex = this.gameState.dealerIndex;

    // Deal cards in proper order (starting from dealer's left)
    for (let cardNum = 0; cardNum < 5; cardNum++) {
      let playerIndex = (dealerIndex + 1) % this.gameState.players.length;
      
      for (let i = 0; i < activePlayers.length; i++) {
        // Skip eliminated players
        while (this.gameState.players[playerIndex].isEliminated) {
          playerIndex = (playerIndex + 1) % this.gameState.players.length;
        }
        
        if (this.gameState.deck.length > 0) {
          this.gameState.players[playerIndex].cards.push(this.gameState.deck.pop());
        }
        
        playerIndex = (playerIndex + 1) % this.gameState.players.length;
      }
    }

    this.gameState.status = 'playing';
    this.gameState.gamePhase = 'playing';

    return { 
      success: true, 
      message: 'Game started! Cards dealt.',
      dealerInfo: dealerResult
    };
  }

  createStandardDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '10', '9', '8', '7', '6', '5', '4', '3'];
    const deck = [];
    let id = 1;
    
    suits.forEach(suit => {
      ranks.forEach(rank => {
        deck.push({ suit, rank, id: id++ });
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

  handleAction(action, playerId, cardId) {
    if (action === 'startGame') {
      return this.startGame();
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
        // Foul: penalty applied
        currentPlayer.points += 2;
        currentPlayer.cards.splice(cardIndex, 1);
        this.nextPlayer();
        return { success: true, message: 'Foul play: 2 penalty points applied' };
      }

      // Play the card
      this.gameState.currentTrick.push({
        card,
        player: currentPlayer.username,
        playerId: currentPlayer._id,
        avatar: currentPlayer.avatar
      });

      // Set calling suit if first card of trick
      if (this.gameState.currentTrick.length === 1) {
        this.gameState.callingSuit = card.suit;
      }

      currentPlayer.cards.splice(cardIndex, 1);

      // Check if trick is complete
      const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
      if (this.gameState.currentTrick.length === activePlayers.length) {
        const winner = this.determineTrickWinner();
        const winnerPlayer = this.gameState.players.find(p => p.username === winner);
        if (winnerPlayer) {
          winnerPlayer.points += 1;
        }
        this.endTrick();
      } else {
        this.nextPlayer();
      }

      return { success: true, message: 'Card played' };
    }

    return { success: false, error: 'Unknown action' };
  }

  isValidPlay(card, player) {
    // First card of trick - always valid
    if (this.gameState.currentTrick.length === 0) return true;
    if (!this.gameState.callingSuit) return true;
    
    // Must follow suit if possible
    const hasCallingSuit = player.cards.some(c => c.suit === this.gameState.callingSuit);
    if (hasCallingSuit && card.suit !== this.gameState.callingSuit) {
      return false; // Foul - must follow suit
    }
    
    return true;
  }

  determineTrickWinner() {
    if (this.gameState.currentTrick.length === 0) return null;
    
    const leadSuit = this.gameState.currentTrick[0].card.suit;
    const trumpSuit = '♠'; // Spades are trump
    const ranks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };

    let winner = this.gameState.currentTrick[0];
    
    for (const play of this.gameState.currentTrick) {
      const current = play.card;
      const best = winner.card;
      
      // Trump beats non-trump
      if (current.suit === trumpSuit && best.suit !== trumpSuit) {
        winner = play;
      }
      // Same suit - higher rank wins
      else if (current.suit === best.suit && ranks[current.rank] > ranks[best.rank]) {
        winner = play;
      }
      // Following suit beats non-following suit (unless trump involved)
      else if (current.suit === leadSuit && best.suit !== leadSuit && best.suit !== trumpSuit) {
        winner = play;
      }
    }

    this.gameState.trickWinner = winner.player;
    return winner.player;
  }

  endTrick() {
    // Save completed trick to history
    this.gameState.trickHistory.push([...this.gameState.currentTrick]);
    
    // Clear current trick
    this.gameState.currentTrick = [];
    this.gameState.callingSuit = null;
    
    // Winner leads next trick
    const winnerIndex = this.gameState.players.findIndex(p => p.username === this.gameState.trickWinner);
    if (winnerIndex !== -1) {
      this.gameState.currentPlayerIndex = winnerIndex;
      this.updateCurrentPlayer();
    }
    
    // Check if round is complete (all cards played)
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    const allCardsPlayed = activePlayers.every(p => p.cards.length === 0);
    
    if (allCardsPlayed) {
      this.endRound();
    }
  }

  endRound() {
    // Apply final trick damage based on rules
    if (this.gameState.trickHistory.length > 0) {
      const finalTrick = this.gameState.trickHistory[this.gameState.trickHistory.length - 1];
      const finalWinner = finalTrick[finalTrick.length - 1]; // Last card played wins
      
      // Find player next to winner (clockwise)
      const winnerIndex = this.gameState.players.findIndex(p => p.username === finalWinner.player);
      const nextPlayerIndex = (winnerIndex + 1) % this.gameState.players.length;
      const damagePlayer = this.gameState.players[nextPlayerIndex];
      
      // Calculate damage based on final winning card
      const damage = this.calculateCardDamage(finalWinner.card);
      damagePlayer.points += damage;
      
      // Check for elimination
      if (damagePlayer.points >= 12) {
        damagePlayer.isEliminated = true;
      }
    }
    
    // Check game end condition
    const remainingPlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (remainingPlayers.length <= 1) {
      this.gameState.gamePhase = 'ended';
      this.gameState.status = 'ended';
    } else {
      // Start next round
      this.gameState.round++;
      this.nextDealer();
      // Could auto-start next round or wait for player action
    }
  }

  calculateCardDamage(card) {
    // Based on rules provided
    if (card.suit === '♠' && card.rank === '3') return 12; // Black 3
    if (card.rank === '3') return 6; // Other 3s
    if (card.rank === '4') return 4;
    if (card.rank === 'A') return 2;
    return 1; // All other cards
  }

  nextDealer() {
    this.gameState.dealerIndex = (this.gameState.dealerIndex + 1) % this.gameState.players.length;
    this.gameState.players.forEach((p, i) => {
      p.isDealer = i === this.gameState.dealerIndex;
    });
  }

  updateCurrentPlayer() {
    this.gameState.players.forEach((p, i) => {
      p.isCurrent = i === this.gameState.currentPlayerIndex && !p.isEliminated;
    });
  }

  nextPlayer() {
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (activePlayers.length === 0) return;
    
    do {
      this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.gameState.players.length;
    } while (this.gameState.players[this.gameState.currentPlayerIndex].isEliminated);
    
    this.updateCurrentPlayer();
  }
}

module.exports = GameEngine;
