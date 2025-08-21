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
      tricksPlayed: 0
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
      if (!existing) {
        this.gameState.players.push({
          _id: dbPlayer._id.toString(),
          username: dbPlayer.username,
          isAI: dbPlayer.isAI || false,
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
      agba: { name: 'Agba', level: 'advanced', avatar: '🏆' }
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

    // Auto-start if we have enough players
    if (this.gameState.players.length >= 2 && this.gameState.status === 'waiting') {
      this.startGame();
    }

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

  startGame() {
    const active = this.gameState.players.filter(p => !p.isEliminated);
    if (active.length < 2) return { success: false, error: 'Need at least 2 players' };

    this.gameState.players.forEach(p => {
      p.points = 0;
      p.cards = [];
      p.isEliminated = false;
      p.isDealer = false;
      p.isCurrent = false;
    });

    this.selectInitialDealer();
    this.dealCards();
    this.gameState.status = 'playing';
    this.gameState.gamePhase = 'playing';
    this.gameState.tricksPlayed = 0;
    this.gameState.currentTrick = [];

    return { success: true, message: 'Game started!' };
  }

  handleAction(action, playerId, cardId) {
    try {
      switch (action) {
        case 'playCard':
          return this.playCard(playerId, cardId);
        case 'startGame':
          return this.startGame();
        default:
          return { success: false, error: 'Invalid action' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  playCard(playerId, cardId) {
    const player = this.gameState.players.find(p => p._id === playerId);
    if (!player) return { success: false, error: 'Player not found' };
    if (!player.isCurrent) return { success: false, error: 'Not your turn' };
    if (player.isEliminated) return { success: false, error: 'You are eliminated' };

    const cardIndex = player.cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { success: false, error: 'Card not found' };

    const card = player.cards[cardIndex];
    
    // Validate card play
    if (this.gameState.currentTrick.length > 0) {
      const leadSuit = this.gameState.currentTrick[0].card.suit;
      const hasLeadSuit = player.cards.some(c => c.suit === leadSuit);
      if (hasLeadSuit && card.suit !== leadSuit) {
        return { success: false, error: 'Must follow suit' };
      }
    } else {
      // First card sets the calling suit
      this.gameState.callingSuit = card.suit;
    }

    // Play the card
    player.cards.splice(cardIndex, 1);
    this.gameState.currentTrick.push({
      player: player.username,
      playerId: playerId,
      card: card
    });

    // Check if trick is complete
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (this.gameState.currentTrick.length === activePlayers.length) {
      this.completeTrick();
    } else {
      this.nextPlayer();
      this.handleAITurn();
    }

    return { success: true, message: `${player.username} played ${card.rank} of ${card.suit}` };
  }

  completeTrick() {
    const trickWinner = this.determineTrickWinner();
    this.gameState.trickWinner = trickWinner;
    this.gameState.tricksPlayed++;
    
    // Move trick to history
    this.gameState.trickHistory.push([...this.gameState.currentTrick]);
    
    // Check if this is the final trick
    if (this.gameState.tricksPlayed === 5) {
      this.gameState.finalTrickWinner = trickWinner;
      this.endRound();
    } else {
      // Winner leads next trick
      const winnerIndex = this.gameState.players.findIndex(p => p.username === trickWinner);
      this.gameState.currentPlayerIndex = winnerIndex;
      this.gameState.currentTrick = [];
      this.gameState.callingSuit = null;
      this.updateCurrentPlayer();
      this.handleAITurn();
    }
  }

  determineTrickWinner() {
    const leadSuit = this.gameState.currentTrick[0].card.suit;
    const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
    
    let winner = this.gameState.currentTrick[0];
    let highestRank = -1;

    for (const play of this.gameState.currentTrick) {
      if (play.card.suit === leadSuit) {
        const rank = cardRanks[play.card.rank];
        if (rank > highestRank) {
          highestRank = rank;
          winner = play;
        }
      }
    }

    return winner.player;
  }

  endRound() {
    // Find player next to final trick winner
    const winnerIndex = this.gameState.players.findIndex(p => p.username === this.gameState.finalTrickWinner);
    const nextPlayerIndex = (winnerIndex + 1) % this.gameState.players.length;
    const damagedPlayer = this.gameState.players[nextPlayerIndex];
    
    // Get the winning card's point value
    const finalTrick = this.gameState.trickHistory[this.gameState.trickHistory.length - 1];
    const winningPlay = finalTrick.find(p => p.player === this.gameState.finalTrickWinner);
    const damage = this.getCardPoints(winningPlay.card);
    
    damagedPlayer.points += damage;
    
    // Check for elimination
    if (damagedPlayer.points >= 12) {
      damagedPlayer.isEliminated = true;
    }
    
    // Check game end
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (activePlayers.length <= 1) {
      this.gameState.status = 'finished';
      this.gameState.gamePhase = 'finished';
      return;
    }
    
    // Start new round
    this.startNewRound();
  }

  startNewRound() {
    this.gameState.round++;
    this.gameState.tricksPlayed = 0;
    this.gameState.currentTrick = [];
    this.gameState.trickHistory = [];
    this.gameState.callingSuit = null;
    this.gameState.trickWinner = null;
    this.gameState.finalTrickWinner = null;
    
    // Next dealer
    do {
      this.gameState.dealerIndex = (this.gameState.dealerIndex + 1) % this.gameState.players.length;
    } while (this.gameState.players[this.gameState.dealerIndex].isEliminated);
    
    this.gameState.players.forEach(p => {
      p.isDealer = false;
      p.isCurrent = false;
      p.cards = [];
    });
    
    this.gameState.players[this.gameState.dealerIndex].isDealer = true;
    this.dealCards();
  }

  selectInitialDealer() {
    const tempDeck = this.shuffleDeck(this.createStandardDeck());
    const draws = [];
    this.gameState.players.forEach((p, i) => {
      draws.push({ player: p, card: tempDeck[i], index: i });
    });

    const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
    const highest = draws.reduce((a, b) => {
      return cardRanks[b.card.rank] > cardRanks[a.card.rank] ? b : a;
    });

    this.gameState.dealerIndex = highest.index;
    this.gameState.players[highest.index].isDealer = true;
    this.gameState.currentPlayerIndex = (highest.index + 1) % this.gameState.players.length;
    this.updateCurrentPlayer();
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

  dealCards() {
    this.gameState.deck = this.shuffleDeck(this.createStandardDeck());
    const dealer = this.gameState.dealerIndex;
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);

    // Deal 3 cards first, then 2 cards
    for (let phase = 0; phase < 2; phase++) {
      const cardsToDeal = phase === 0 ? 3 : 2;
      for (let i = 0; i < cardsToDeal; i++) {
        let idx = (dealer + 1) % this.gameState.players.length;
        for (let j = 0; j < activePlayers.length; j++) {
          // Skip eliminated players
          while (this.gameState.players[idx].isEliminated) {
            idx = (idx + 1) % this.gameState.players.length;
          }
          
          if (this.gameState.deck.length > 0) {
            this.gameState.players[idx].cards.push(this.gameState.deck.pop());
          }
          
          // Move to next non-eliminated player
          do {
            idx = (idx + 1) % this.gameState.players.length;
          } while (this.gameState.players[idx].isEliminated && idx !== (dealer + 1) % this.gameState.players.length);
        }
      }
    }

    this.updateCurrentPlayer();
    this.handleAITurn();
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

  handleAITurn() {
    const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    if (!currentPlayer || !currentPlayer.isAI || currentPlayer.isEliminated) return;

    // Simple AI: play first valid card
    let cardToPlay = null;
    
    if (this.gameState.currentTrick.length === 0) {
      // Lead with any card
      cardToPlay = currentPlayer.cards[0];
    } else {
      // Follow suit if possible
      const leadSuit = this.gameState.currentTrick[0].card.suit;
      cardToPlay = currentPlayer.cards.find(c => c.suit === leadSuit) || currentPlayer.cards[0];
    }

    if (cardToPlay) {
      setTimeout(() => {
        this.playCard(currentPlayer._id, cardToPlay.id);
      }, 1500); // Add delay for realism
    }
  }

  getCardPoints(card) {
    if (card.rank === '3' && card.suit === '♠') return 12;
    if (card.rank === '3') return 6;
    if (card.rank === '4') return 4;
    if (card.rank === 'A') return 2;
    return 1;
  }
}

module.exports = GameEngine;
