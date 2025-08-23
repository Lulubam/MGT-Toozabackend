// game/GameEngine.jsv8claude - Enhanced Version with AI and Proper Rules
class GameEngine {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.gameState = {
      status: 'waiting',
      players: [],
      currentTrick: [],
      trickHistory: [],
      gamePhase: 'waiting', // waiting, dealerSelection, dealing, playing, roundEnd, gameEnd
      deck: [],
      round: 1,
      currentPlayerIndex: 0,
      dealerIndex: 0,
      callingSuit: null,
      trickWinner: null,
      finalTrickWinner: null,
      dealerSelectionCards: [],
      dealingPhase: 1, // 1 or 2 (3 cards then 2 cards)
      isManualDealing: false,
      tricksInRound: 0,
      lastTrickOptOuts: [], // Players who opted out of last trick
      roundWinner: null
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

  selectDealer() {
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (activePlayers.length < 2) return { success: false, error: 'Need at least 2 players' };

    const tempDeck = this.shuffleDeck(this.createStandardDeck());
    const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
    
    let maxRank = -1;
    let dealerIndex = 0;
    
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

    this.gameState.players.forEach(p => p.isDealer = false);
    this.gameState.dealerIndex = dealerIndex;
    this.gameState.players[dealerIndex].isDealer = true;
    
    this.gameState.currentPlayerIndex = (dealerIndex + 1) % this.gameState.players.length;
    this.updateCurrentPlayer();

    return { 
      success: true, 
      message: `${this.gameState.players[dealerIndex].username} is the dealer`,
      dealerSelectionCards: this.gameState.dealerSelectionCards
    };
  }

  startGame(isManual = false) {
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (activePlayers.length < 2) return { success: false, error: 'Need at least 2 players' };

    const dealerResult = this.selectDealer();
    if (!dealerResult.success) return dealerResult;

    this.gameState.isManualDealing = isManual;
    this.gameState.gamePhase = isManual ? 'dealing' : 'playing';
    this.gameState.status = 'playing';
    this.gameState.dealingPhase = 1;

    if (!isManual) {
      return this.dealCards();
    }

    return { 
      success: true, 
      message: 'Game started! Ready for manual dealing.',
      dealerInfo: dealerResult,
      phase: 'dealing'
    };
  }

  dealCards() {
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    this.gameState.deck = this.shuffleDeck(this.createStandardDeck());
    const dealerIndex = this.gameState.dealerIndex;

    // Phase 1: Deal 3 cards to each player
    for (let cardNum = 0; cardNum < 3; cardNum++) {
      let playerIndex = (dealerIndex + 1) % this.gameState.players.length;
      
      for (let i = 0; i < activePlayers.length; i++) {
        while (this.gameState.players[playerIndex].isEliminated) {
          playerIndex = (playerIndex + 1) % this.gameState.players.length;
        }
        
        if (this.gameState.deck.length > 0) {
          this.gameState.players[playerIndex].cards.push(this.gameState.deck.pop());
        }
        
        playerIndex = (playerIndex + 1) % this.gameState.players.length;
      }
    }

    // Phase 2: Deal 2 more cards to each player
    for (let cardNum = 0; cardNum < 2; cardNum++) {
      let playerIndex = (dealerIndex + 1) % this.gameState.players.length;
      
      for (let i = 0; i < activePlayers.length; i++) {
        while (this.gameState.players[playerIndex].isEliminated) {
          playerIndex = (playerIndex + 1) % this.gameState.players.length;
        }
        
        if (this.gameState.deck.length > 0) {
          this.gameState.players[playerIndex].cards.push(this.gameState.deck.pop());
        }
        
        playerIndex = (playerIndex + 1) % this.gameState.players.length;
      }
    }

    this.gameState.gamePhase = 'playing';
    this.gameState.tricksInRound = 0;
    this.gameState.lastTrickOptOuts = [];

    return { 
      success: true, 
      message: 'Cards dealt! Game begins.',
      phase: 'playing'
    };
  }

  handleAction(action, playerId, cardId, data = {}) {
    if (action === 'startGame') {
      return this.startGame(data.isManual);
    }

    if (action === 'adjustPoints') {
      return this.adjustPlayerPoints(playerId, data.targetPlayerId, data.adjustment);
    }

    if (action === 'optOutLastTrick') {
      return this.handleOptOut(playerId);
    }

    const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    
    if (action === 'playCard') {
      // Check if it's AI turn and handle AI move
      if (currentPlayer && currentPlayer.isAI) {
        return this.handleAIMove();
      }

      if (!currentPlayer || currentPlayer._id !== playerId) {
        return { success: false, error: 'Not your turn' };
      }

      const cardIndex = currentPlayer.cards.findIndex(c => c.id === cardId);
      if (cardIndex === -1) return { success: false, error: 'Card not in hand' };

      const card = currentPlayer.cards[cardIndex];
      const validation = this.validatePlay(card, currentPlayer);
      
      if (!validation.isValid) {
        currentPlayer.points += 2;
        currentPlayer.cards.splice(cardIndex, 1);
        this.nextPlayer();
        return { success: true, message: validation.message, foul: true };
      }

      return this.playCard(currentPlayer, card, cardIndex);
    }

    return { success: false, error: 'Unknown action' };
  }

  validatePlay(card, player) {
    // First card of trick - always valid
    if (this.gameState.currentTrick.length === 0) {
      return { isValid: true };
    }

    if (!this.gameState.callingSuit) {
      return { isValid: true };
    }
    
    // Check if player has calling suit
    const hasCallingSuit = player.cards.some(c => c.suit === this.gameState.callingSuit);
    
    if (hasCallingSuit && card.suit !== this.gameState.callingSuit) {
      return { 
        isValid: false, 
        message: 'Foul: Must follow suit when possible (2 penalty points)' 
      };
    }
    
    return { isValid: true };
  }

  playCard(player, card, cardIndex) {
    this.gameState.currentTrick.push({
      card,
      player: player.username,
      playerId: player._id,
      avatar: player.avatar
    });

    if (this.gameState.currentTrick.length === 1) {
      this.gameState.callingSuit = card.suit;
    }

    player.cards.splice(cardIndex, 1);

    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    
    if (this.gameState.currentTrick.length === activePlayers.length) {
      const winner = this.determineTrickWinner();
      const winnerPlayer = this.gameState.players.find(p => p.username === winner);
      if (winnerPlayer) {
        winnerPlayer.points += 1;
      }
      return this.endTrick();
    } else {
      this.nextPlayer();
      return { success: true, message: 'Card played', needsAIMove: this.isCurrentPlayerAI() };
    }
  }

  isCurrentPlayerAI() {
    const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    return currentPlayer && currentPlayer.isAI && !currentPlayer.isEliminated;
  }

  handleAIMove() {
    const aiPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    if (!aiPlayer || !aiPlayer.isAI || aiPlayer.cards.length === 0) {
      return { success: false, error: 'Invalid AI state' };
    }

    // AI logic based on level
    const card = this.selectAICard(aiPlayer);
    const cardIndex = aiPlayer.cards.findIndex(c => c.id === card.id);
    
    const validation = this.validatePlay(card, aiPlayer);
    if (!validation.isValid) {
      aiPlayer.points += 2;
      aiPlayer.cards.splice(cardIndex, 1);
      this.nextPlayer();
      return { 
        success: true, 
        message: `${aiPlayer.username} committed a foul (2 points)`,
        foul: true,
        needsAIMove: this.isCurrentPlayerAI()
      };
    }

    return this.playCard(aiPlayer, card, cardIndex);
  }

  selectAICard(aiPlayer) {
    const availableCards = [...aiPlayer.cards];
    const callingSuit = this.gameState.callingSuit;
    
    // If must follow suit
    if (callingSuit && this.gameState.currentTrick.length > 0) {
      const suitCards = availableCards.filter(c => c.suit === callingSuit);
      if (suitCards.length > 0) {
        return this.chooseCardByLevel(suitCards, aiPlayer.aiLevel);
      }
    }
    
    // If leading or can't follow suit
    return this.chooseCardByLevel(availableCards, aiPlayer.aiLevel);
  }

  chooseCardByLevel(cards, level) {
    const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
    
    switch (level) {
      case 'beginner':
        // Random choice
        return cards[Math.floor(Math.random() * cards.length)];
      
      case 'intermediate':
        // Avoid high-value penalty cards, prefer middle ranks
        const safeCards = cards.filter(c => !(c.rank === '3' || c.rank === '4' || c.rank === 'A'));
        return safeCards.length > 0 ? safeCards[Math.floor(Math.random() * safeCards.length)] : cards[0];
      
      case 'advanced':
        // Strategic play: avoid penalty cards, play low when safe
        const sortedCards = cards.sort((a, b) => cardRanks[a.rank] - cardRanks[b.rank]);
        const dangerousCards = cards.filter(c => c.rank === '3' && c.suit === '♠');
        
        if (dangerousCards.length === cards.length) {
          // Only dangerous cards left
          return dangerousCards[0];
        }
        
        // Play lowest safe card
        return sortedCards.find(c => !(c.rank === '3' && c.suit === '♠')) || sortedCards[0];
      
      default:
        return cards[0];
    }
  }

  determineTrickWinner() {
    if (this.gameState.currentTrick.length === 0) return null;
    
    const callingSuit = this.gameState.callingSuit;
    const ranks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };

    let winner = null;
    let highestRank = -1;

    // Only cards of calling suit can win
    for (const play of this.gameState.currentTrick) {
      if (play.card.suit === callingSuit) {
        const rank = ranks[play.card.rank];
        if (rank > highestRank) {
          highestRank = rank;
          winner = play;
        }
      }
    }

    // If no one played calling suit (shouldn't happen), first player wins
    if (!winner) {
      winner = this.gameState.currentTrick[0];
    }

    this.gameState.trickWinner = winner.player;
    return winner.player;
  }

  endTrick() {
    this.gameState.trickHistory.push([...this.gameState.currentTrick]);
    this.gameState.currentTrick = [];
    this.gameState.callingSuit = null;
    this.gameState.tricksInRound++;
    
    const winnerIndex = this.gameState.players.findIndex(p => p.username === this.gameState.trickWinner);
    if (winnerIndex !== -1) {
      this.gameState.currentPlayerIndex = winnerIndex;
      this.updateCurrentPlayer();
    }
    
    // Check if round is complete (5 tricks played)
    if (this.gameState.tricksInRound >= 5) {
      return this.endRound();
    }
    
    // Check if this is the 5th trick (last trick) - offer opt-out
    if (this.gameState.tricksInRound === 4) {
      this.gameState.gamePhase = 'lastTrickChoice';
      return { 
        success: true, 
        message: 'Last trick coming up! Players can opt out.',
        phase: 'lastTrickChoice',
        needsAIMove: false
      };
    }

    return { 
      success: true, 
      message: `Trick won by ${this.gameState.trickWinner}`,
      needsAIMove: this.isCurrentPlayerAI()
    };
  }

  handleOptOut(playerId) {
    const player = this.gameState.players.find(p => p._id === playerId);
    if (!player) return { success: false, error: 'Player not found' };
    
    if (this.gameState.gamePhase !== 'lastTrickChoice') {
      return { success: false, error: 'Not time for opt-out decisions' };
    }

    if (!this.gameState.lastTrickOptOuts.includes(playerId)) {
      this.gameState.lastTrickOptOuts.push(playerId);
    }

    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (this.gameState.lastTrickOptOuts.length === activePlayers.length - 1) {
      // Only one player left, start last trick
      this.gameState.gamePhase = 'playing';
      return { success: true, message: 'Last trick decisions complete. Starting final trick.' };
    }

    return { success: true, message: `${player.username} opted out of the last trick.` };
  }

  endRound() {
    // Apply final trick damage
    if (this.gameState.trickHistory.length > 0) {
      const finalTrick = this.gameState.trickHistory[this.gameState.trickHistory.length - 1];
      const finalWinnerPlay = finalTrick.find(play => play.player === this.gameState.trickWinner);
      
      if (finalWinnerPlay) {
        const winnerIndex = this.gameState.players.findIndex(p => p.username === finalWinnerPlay.player);
        let damagePlayerIndex = (winnerIndex + 1) % this.gameState.players.length;
        
        // Skip eliminated players
        while (this.gameState.players[damagePlayerIndex].isEliminated) {
          damagePlayerIndex = (damagePlayerIndex + 1) % this.gameState.players.length;
        }
        
        const damagePlayer = this.gameState.players[damagePlayerIndex];
        const damage = this.calculateCardDamage(finalWinnerPlay.card);
        
        // Check if player opted out
        if (this.gameState.lastTrickOptOuts.includes(damagePlayer._id)) {
          // Find previous player who didn't opt out
          let prevIndex = (winnerIndex - 1 + this.gameState.players.length) % this.gameState.players.length;
          while (this.gameState.players[prevIndex].isEliminated || 
                 this.gameState.lastTrickOptOuts.includes(this.gameState.players[prevIndex]._id)) {
            prevIndex = (prevIndex - 1 + this.gameState.players.length) % this.gameState.players.length;
          }
          this.gameState.players[prevIndex].points += damage;
        } else {
          damagePlayer.points += damage;
        }
      }
    }
    
    // Check for eliminations
    this.gameState.players.forEach(player => {
      if (player.points >= 12) {
        player.isEliminated = true;
      }
    });
    
    const remainingPlayers = this.gameState.players.filter(p => !p.isEliminated);
    
    if (remainingPlayers.length <= 1) {
      this.gameState.gamePhase = 'gameEnd';
      this.gameState.status = 'ended';
      this.gameState.roundWinner = remainingPlayers[0] || null;
      return { 
        success: true, 
        message: `Game Over! Winner: ${this.gameState.roundWinner?.username || 'None'}`,
        phase: 'gameEnd' 
      };
    } else {
      // Start next round
      this.gameState.round++;
      this.gameState.tricksInRound = 0;
      this.gameState.lastTrickOptOuts = [];
      this.gameState.trickHistory = [];
      this.nextDealer();
      
      // Clear all cards
      this.gameState.players.forEach(p => p.cards = []);
      
      this.gameState.gamePhase = 'roundEnd';
      
      return { 
        success: true, 
        message: `Round ${this.gameState.round - 1} complete. Starting Round ${this.gameState.round}`,
        phase: 'roundEnd',
        eliminatedPlayers: this.gameState.players.filter(p => p.isEliminated)
      };
    }
  }

  calculateCardDamage(card) {
    if (card.suit === '♠' && card.rank === '3') return 12; // Black 3
    if (card.rank === '3') return 6; // Other 3s
    if (card.rank === '4') return 4;
    if (card.rank === 'A') return 2;
    return 1; // All other cards
  }

  adjustPlayerPoints(requesterId, targetPlayerId, adjustment) {
    const requester = this.gameState.players.find(p => p._id === requesterId);
    const target = this.gameState.players.find(p => p._id === targetPlayerId);
    
    if (!requester || !target) {
      return { success: false, error: 'Player not found' };
    }
    
    target.points = Math.max(0, target.points + adjustment);
    
    // Check for elimination
    if (target.points >= 12) {
      target.isEliminated = true;
    } else if (target.isEliminated && target.points < 12) {
      target.isEliminated = false;
    }
    
    return { 
      success: true, 
      message: `${target.username} points adjusted by ${adjustment} to ${target.points}` 
    };
  }

  nextDealer() {
    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    let nextDealerIndex = (this.gameState.dealerIndex + 1) % this.gameState.players.length;
    
    // Skip eliminated players
    while (this.gameState.players[nextDealerIndex].isEliminated && activePlayers.length > 0) {
      nextDealerIndex = (nextDealerIndex + 1) % this.gameState.players.length;
    }
    
    this.gameState.dealerIndex = nextDealerIndex;
    this.gameState.players.forEach((p, i) => {
      p.isDealer = i === nextDealerIndex;
    });
    
    this.gameState.currentPlayerIndex = (nextDealerIndex + 1) % this.gameState.players.length;
    while (this.gameState.players[this.gameState.currentPlayerIndex].isEliminated && activePlayers.length > 0) {
      this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.gameState.players.length;
    }
    
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
