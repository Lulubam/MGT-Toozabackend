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

  // Utility to update player list from the database
  updatePlayers(dbPlayers) {
    this.gameState.players = dbPlayers.map(p => {
      const existingPlayer = this.gameState.players.find(gp =>
        (gp._id && gp._id.toString()) === (p._id && p._id.toString())
      );
      return {
        ...existingPlayer,
        _id: p._id,
        username: p.username,
        isAI: p.isAI,
        aiLevel: p.aiLevel,
        avatar: p.avatar,
        socketId: p.socketId,
        isDealer: existingPlayer?.isDealer || false,
        isCurrent: existingPlayer?.isCurrent || false,
        isActive: p.isActive !== false,
        isEliminated: existingPlayer?.isEliminated || false,
        cards: existingPlayer?.cards || [],
        points: existingPlayer?.points || 0
      };
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
    if (!config) return { success: false, error: 'Invalid AI player' };
    if (this.gameState.players.length >= 4) {
      return { success: false, error: 'Room is full' };
    }

    const exists = this.gameState.players.some(p => p.username === config.name && p.isAI);
    if (exists) {
      return { success: false, error: 'AI player already in room' };
    }

    const aiPlayer = {
      _id: `ai_${aiKey}_${Date.now()}`,
      username: config.name,
      isAI: true,
      aiLevel: config.level,
      avatar: config.avatar,
      socketId: 'AI_PLAYER',
      cards: [],
      points: 0,
      isDealer: false,
      isCurrent: false,
      isActive: true,
      isEliminated: false
    };

    this.gameState.players.push(aiPlayer);
    return { success: true, message: `${config.name} joined the game` };
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
    if (!config) return { success: false, error: 'Invalid AI player' };

    const index = this.gameState.players.findIndex(p => p.username === config.name && p.isAI);
    if (index === -1) {
      return { success: false, error: 'AI player not found' };
    }

    this.gameState.players.splice(index, 1);
    this.updateCurrentPlayer();
    return { success: true, message: `${config.name} left the game` };
  }

  updateCurrentPlayer() {
    if (this.gameState.players.length === 0) return;
    this.gameState.currentPlayerIndex = this.gameState.currentPlayerIndex % this.gameState.players.length;
    this.gameState.players.forEach((p, i) => {
      p.isCurrent = i === this.gameState.currentPlayerIndex;
    });
  }

  selectInitialDealer() {
    const suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const deck = suits.flatMap(suit => ranks.map(rank => ({ suit, rank, id: `${rank}_of_${suit}` })));
    const shuffled = [...deck].sort(() => Math.random() - 0.5);

    const drawnCards = [];
    this.gameState.players.forEach((player, index) => {
      const card = shuffled[index];
      drawnCards.push({ player: player.username, card });
    });

    const highestCard = drawnCards.reduce((a, b) => {
      const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
      const suitOrder = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];
      const aRank = rankOrder.indexOf(a.card.rank);
      const bRank = rankOrder.indexOf(b.card.rank);
      if (aRank !== bRank) return aRank > bRank ? a : b;
      return suitOrder.indexOf(a.card.suit) > suitOrder.indexOf(b.card.suit) ? a : b;
    });

    const dealerIndex = this.gameState.players.findIndex(p => p.username === highestCard.player);
    this.gameState.dealerIndex = dealerIndex;
    this.gameState.players.forEach(p => p.isDealer = false);
    this.gameState.players[dealerIndex].isDealer = true;
    this.gameState.currentPlayerIndex = (dealerIndex + 1) % this.gameState.players.length;
    this.updateCurrentPlayer();
  }

  dealCards() {
    const suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let deck = suits.flatMap(suit => ranks.map(rank => ({ suit, rank, id: `${rank}_of_${suit}` })));
    deck = deck.sort(() => Math.random() - 0.5);

    this.gameState.players.forEach(player => {
      player.cards = deck.splice(0, 5);
    });
    this.gameState.deck = deck;
    this.gameState.gamePhase = 'playing';
  }

  startGame(playerId) {
    const player = this.gameState.players.find(p => p._id && p._id.toString() === playerId.toString());
    if (!player) return { success: false, error: 'Player not found.' };

    const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
    if (activePlayers.length < 2) {
      return { success: false, error: 'Need at least 2 players to start.' };
    }

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
    return { success: true, message: 'Game started!' };
  }

  getGameState() {
    return JSON.parse(JSON.stringify(this.gameState));
  }

  async handleAction(action, playerId, cardId) {
    try {
      const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
      if (!currentPlayer || currentPlayer._id !== playerId) {
        return { success: false, error: 'It is not your turn to play.' };
      }

      if (action === 'play-card') {
        const cardToPlayIndex = currentPlayer.cards.findIndex(card => card.id === cardId);
        if (cardToPlayIndex === -1) {
          return { success: false, error: 'Card not found in your hand.' };
        }
        const cardToPlay = currentPlayer.cards[cardToPlayIndex];

        const validationResult = this.isValidPlay(cardToPlay, currentPlayer);
        if (!validationResult.valid) {
          if (currentPlayer.cards.some(c => c.suit === this.gameState.callingSuit)) {
            currentPlayer.points += 2;
          }
          currentPlayer.cards.splice(cardToPlayIndex, 1);
          this.nextPlayer();
          return { success: true, message: 'Foul play: penalty applied.', foul: true };
        }

        this.gameState.currentTrick.push({
          card: cardToPlay,
          player: currentPlayer.username,
          avatar: currentPlayer.avatar
        });

        if (this.gameState.callingSuit === null) {
          this.gameState.callingSuit = cardToPlay.suit;
        }

        currentPlayer.cards.splice(cardToPlayIndex, 1);

        if (this.gameState.currentTrick.length === this.gameState.players.length) {
          const winner = this.determineTrickWinner();
          this.gameState.trickWinner = winner;
          this.gameState.players.find(p => p.username === winner).points += 1;
          this.endTrick();
        } else {
          this.nextPlayer();
        }

        return { success: true, message: 'Card played successfully.' };
      }

      return { success: false, error: 'Unknown action' };
    } catch (error) {
      console.error(`Error handling action ${action}:`, error);
      return { success: false, error: error.message };
    }
  }

  nextPlayer() {
    this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.gameState.players.length;
    this.updateCurrentPlayer();
  }

  isValidPlay(card, player) {
    if (this.gameState.currentTrick.length === 0) return { valid: true };
    if (this.gameState.callingSuit === null) return { valid: true };
    const hasCallingSuit = player.cards.some(c => c.suit === this.gameState.callingSuit);
    if (hasCallingSuit && card.suit !== this.gameState.callingSuit) {
      return { valid: false, reason: 'Must follow suit' };
    }
    return { valid: true };
  }

  determineTrickWinner() {
    const leadSuit = this.gameState.currentTrick[0].card.suit;
    const trumpSuit = 'Spades';
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let winner = this.gameState.currentTrick[0];

    this.gameState.currentTrick.forEach(play => {
      const current = play.card;
      const best = winner.card;
      if (current.suit === trumpSuit && best.suit !== trumpSuit) {
        winner = play;
      } else if (current.suit === best.suit && ranks.indexOf(current.rank) > ranks.indexOf(best.rank)) {
        winner = play;
      }
    });

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
}

module.exports = GameEngine;
