// game/GameEngine.js - Correct Trick-Taking Game Engine

class GameEngine {
    constructor(roomCode) {
        this.roomCode = roomCode;
        this.gameState = {
            status: 'waiting', // waiting, playing, gameOver
            players: [],
            currentTrick: [],
            trickHistory: [],
            gamePhase: 'waiting', // waiting, dealing, playing, roundEnd
            deck: [],
            round: 1,
            currentPlayerIndex: 0,
            dealerIndex: 0,
            callingSuit: null, // The suit that must be followed in current trick
            trickLeader: null, // Who started the current trick
            trickWinner: null,
            gameDirection: 1, // Always clockwise in this game
            finalTrickWinner: null
        };
    }

    // REQUIRED: Instance method for the server
    getGameState() {
        return this.gameState;
    }

    // REQUIRED: Instance method for the server
    handleAction(action, playerId, data) {
        console.log(`Action: ${action} from player: ${playerId}`, data);
        
        try {
            switch(action) {
                case 'startGame':
                    return this.startGame(playerId);
                case 'playCard':
                    return this.playCard(playerId, data.cardId);
                case 'dealCards':
                    return this.dealCards();
                case 'joinGame':
                    return this.joinGame(playerId);
                case 'addAI':
                    return this.addAIPlayer(data.aiKey);
                case 'removeAI':
                    return this.removeAIPlayer(data.aiKey);
                default:
                    return { success: false, error: 'Unknown action' };
            }
        } catch (error) {
            console.error(`Error handling action ${action}:`, error);
            return { success: false, error: error.message };
        }
    }

    // Utility to update player list from the database
    updatePlayers(dbPlayers) {
        this.gameState.players = dbPlayers.map(p => {
            const existingPlayer = this.gameState.players.find(gp => 
                (gp._id && gp._id.toString()) === (p._id && p._id.toString())
            );
            return {
                ...existingPlayer,
                ...p.toObject(),
                cards: existingPlayer?.cards || [],
                points: existingPlayer?.points || 0,
                isCurrent: existingPlayer?.isCurrent || false,
                isDealer: existingPlayer?.isDealer || false,
                isEliminated: existingPlayer?.isEliminated || false
            };
        });
        
        // Ensure proper current player assignment
        if (this.gameState.players.length > 0) {
            const hasCurrentPlayer = this.gameState.players.some(p => p.isCurrent);
            if (!hasCurrentPlayer && this.gameState.status === 'playing') {
                if (this.gameState.currentPlayerIndex < this.gameState.players.length) {
                    this.gameState.players[this.gameState.currentPlayerIndex].isCurrent = true;
                } else {
                    this.gameState.currentPlayerIndex = 0;
                    this.gameState.players[0].isCurrent = true;
                }
            }
        }
    }

    // =========================================================================
    // AI Management Methods
    // =========================================================================
    
    addAIPlayer(aiKey) {
        const AI_PLAYERS = {
            'otu': { name: 'Otu', level: 'beginner', avatar: '🤖' },
            'ase': { name: 'Ase', level: 'beginner', avatar: '🎭' },
            'dede': { name: 'Dede', level: 'intermediate', avatar: '🎪' },
            'ogbologbo': { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
            'agba': { name: 'Agba', level: 'advanced', avatar: '👑' }
        };

        if (!AI_PLAYERS[aiKey]) {
            return { success: false, error: 'Invalid AI player' };
        }

        if (this.gameState.players.length >= 4) {
            return { success: false, error: 'Room is full' };
        }

        // Check if AI already exists
        const aiExists = this.gameState.players.some(p => 
            p.username === AI_PLAYERS[aiKey].name && p.isAI
        );
        if (aiExists) {
            return { success: false, error: 'AI player already in room' };
        }

        // Add AI player to game state
        const aiPlayer = {
            _id: `ai_${aiKey}_${Date.now()}`,
            username: AI_PLAYERS[aiKey].name,
            isAI: true,
            aiLevel: AI_PLAYERS[aiKey].level,
            avatar: AI_PLAYERS[aiKey].avatar,
            cards: [],
            points: 0,
            isDealer: false,
            isCurrent: false,
            isActive: true,
            isEliminated: false,
            socketId: 'AI_PLAYER'
        };

        this.gameState.players.push(aiPlayer);
        return { success: true, message: `${aiPlayer.username} joined the game` };
    }

    removeAIPlayer(aiKey) {
        const AI_PLAYERS = {
            'otu': { name: 'Otu', level: 'beginner', avatar: '🤖' },
            'ase': { name: 'Ase', level: 'beginner', avatar: '🎭' },
            'dede': { name: 'Dede', level: 'intermediate', avatar: '🎪' },
            'ogbologbo': { name: 'Ogbologbo', level: 'advanced', avatar: '🎯' },
            'agba': { name: 'Agba', level: 'advanced', avatar: '👑' }
        };

        if (!AI_PLAYERS[aiKey]) {
            return { success: false, error: 'Invalid AI player' };
        }

        const aiName = AI_PLAYERS[aiKey].name;
        const aiIndex = this.gameState.players.findIndex(p => 
            p.username === aiName && p.isAI
        );

        if (aiIndex === -1) {
            return { success: false, error: 'AI player not found' };
        }

        // Remove AI player
        this.gameState.players.splice(aiIndex, 1);
        
        // Adjust current player index if necessary
        if (this.gameState.currentPlayerIndex >= aiIndex && this.gameState.currentPlayerIndex > 0) {
            this.gameState.currentPlayerIndex--;
        }
        if (this.gameState.dealerIndex >= aiIndex && this.gameState.dealerIndex > 0) {
            this.gameState.dealerIndex--;
        }
        this.updateCurrentPlayer();

        return { success: true, message: `${aiName} left the game` };
    }

    // =========================================================================
    // Game Flow Methods - Correct Trick-Taking Rules
    // =========================================================================

    startGame(playerId) {
        const player = this.gameState.players.find(p => 
            (p._id && p._id.toString()) === (playerId && playerId.toString())
        );
        
        if (!player) {
            return { success: false, error: 'Player not found.' };
        }

        if (this.gameState.players.length < 2) {
            return { success: false, error: 'Need at least 2 players to start.' };
        }
        
        // Initialize all players
        this.gameState.players.forEach((p, index) => {
            p.points = 0;
            p.cards = [];
            p.isEliminated = false;
            p.isDealer = false;
            p.isCurrent = false;
        });

        // Select initial dealer by highest card draw
        this.selectInitialDealer();
        
        this.gameState.status = 'playing';
        this.gameState.gamePhase = 'dealing';
        this.dealCards();
        
        return { success: true, message: 'Game started! Dealer selected by highest card draw.' };
    }

    selectInitialDealer() {
        // Each player draws one card to determine dealer
        const tempDeck = GameEngine.shuffleDeck(GameEngine.createStandardDeck());
        const draws = [];
        
        this.gameState.players.forEach((player, index) => {
            const drawnCard = tempDeck.pop();
            draws.push({ player, card: drawnCard, index });
        });
        
        // Find highest card (Ace > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3)
        const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
        const highestDraw = draws.reduce((max, current) => {
            const maxRank = cardRanks[max.card.rank] || 0;
            const currentRank = cardRanks[current.card.rank] || 0;
            return currentRank > maxRank ? current : max;
        });
        
        this.gameState.dealerIndex = highestDraw.index;
        this.gameState.players[this.gameState.dealerIndex].isDealer = true;
        
        console.log(`${highestDraw.player.username} is the dealer with ${highestDraw.card.rank} of ${highestDraw.card.suit}`);
    }

    dealCards() {
        this.gameState.deck = GameEngine.shuffleDeck(GameEngine.createStandardDeck());
        
        // First phase: Deal 3 cards to each player
        for (let i = 0; i < 3; i++) {
            let currentIndex = (this.gameState.dealerIndex + 1) % this.gameState.players.length;
            for (let j = 0; j < this.gameState.players.length; j++) {
                if (this.gameState.deck.length > 0) {
                    this.gameState.players[currentIndex].cards.push(this.gameState.deck.pop());
                }
                currentIndex = (currentIndex + 1) % this.gameState.players.length;
            }
        }
        
        // Second phase: Deal 2 more cards to each player
        for (let i = 0; i < 2; i++) {
            let currentIndex = (this.gameState.dealerIndex + 1) % this.gameState.players.length;
            for (let j = 0; j < this.gameState.players.length; j++) {
                if (this.gameState.deck.length > 0) {
                    this.gameState.players[currentIndex].cards.push(this.gameState.deck.pop());
                }
                currentIndex = (currentIndex + 1) % this.gameState.players.length;
            }
        }

        // Start first trick - player left of dealer leads
        this.gameState.currentPlayerIndex = (this.gameState.dealerIndex + 1) % this.gameState.players.length;
        this.gameState.trickLeader = this.gameState.currentPlayerIndex;
        this.updateCurrentPlayer();
        this.gameState.gamePhase = 'playing';
        this.gameState.currentTrick = [];
        this.gameState.callingSuit = null;
        
        return { success: true, message: 'Cards dealt. First player leads!' };
    }

    playCard(playerId, cardId) {
        const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];

        if (!currentPlayer || (currentPlayer._id && currentPlayer._id.toString()) !== (playerId && playerId.toString())) {
            return { success: false, error: 'It is not your turn to play.' };
        }

        const cardToPlayIndex = currentPlayer.cards.findIndex(card => card.id === cardId);
        if (cardToPlayIndex === -1) {
            return { success: false, error: 'Card not found in your hand.' };
        }

        const cardToPlay = currentPlayer.cards[cardToPlayIndex];

        // Check if play is valid
        const validationResult = this.isValidPlay(cardToPlay, currentPlayer);
        if (!validationResult.valid) {
            // If invalid and player has cards of calling suit, it's a foul
            if (this.gameState.callingSuit && this.hasCardOfSuit(currentPlayer, this.gameState.callingSuit)) {
                currentPlayer.points += 2;
                return { success: false, error: `${validationResult.error} - 2 point foul for failing to follow suit!` };
            }
            return { success: false, error: validationResult.error };
        }

        // Remove card from player's hand
        currentPlayer.cards.splice(cardToPlayIndex, 1);
        
        // Add to current trick
        this.gameState.currentTrick.push({
            player: currentPlayer,
            card: cardToPlay,
            playerId: currentPlayer._id
        });

        // If this is the first card of the trick, set calling suit
        if (this.gameState.currentTrick.length === 1) {
            this.gameState.callingSuit = cardToPlay.suit;
        }

        // Check if trick is complete
        const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
        if (this.gameState.currentTrick.length === activePlayers.length) {
            return this.completeTrick();
        } else {
            // Move to next player
            this.nextPlayer();
            return { success: true, message: `${currentPlayer.username} played ${cardToPlay.rank} of ${cardToPlay.suit}` };
        }
    }

    isValidPlay(card, player) {
        // If no calling suit set, any card is valid (first card of trick)
        if (!this.gameState.callingSuit) {
            return { valid: true };
        }

        // Must follow suit if possible
        if (card.suit === this.gameState.callingSuit) {
            return { valid: true };
        }

        // Can play any card if no cards of calling suit
        if (!this.hasCardOfSuit(player, this.gameState.callingSuit)) {
            return { valid: true };
        }

        return { valid: false, error: 'Must follow suit when possible' };
    }

    hasCardOfSuit(player, suit) {
        return player.cards.some(card => card.suit === suit);
    }

    completeTrick() {
        // Determine trick winner
        const trickWinner = this.determineTrickWinner();
        this.gameState.trickWinner = trickWinner.player;
        
        // Add trick to history
        this.gameState.trickHistory.push([...this.gameState.currentTrick]);
        
        // Clear current trick
        this.gameState.currentTrick = [];
        this.gameState.callingSuit = null;

        // Check if round is over (5 tricks played)
        if (this.gameState.trickHistory.length === 5) {
            return this.endRound();
        } else {
            // Winner leads next trick
            this.gameState.currentPlayerIndex = this.gameState.players.findIndex(p => p._id === trickWinner.player._id);
            this.gameState.trickLeader = this.gameState.currentPlayerIndex;
            this.updateCurrentPlayer();
            
            return { 
                success: true, 
                message: `${trickWinner.player.username} wins trick with ${trickWinner.card.rank} of ${trickWinner.card.suit}! Leading next trick.` 
            };
        }
    }

    determineTrickWinner() {
        const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
        
        // Only cards of calling suit can win
        const validCards = this.gameState.currentTrick.filter(play => 
            play.card.suit === this.gameState.callingSuit
        );
        
        if (validCards.length === 0) {
            // No one followed suit? First card wins
            return this.gameState.currentTrick[0];
        }
        
        // Find highest rank among valid cards
        return validCards.reduce((highest, current) => {
            const highestRank = cardRanks[highest.card.rank] || 0;
            const currentRank = cardRanks[current.card.rank] || 0;
            return currentRank > highestRank ? current : highest;
        });
    }

    endRound() {
        this.gameState.gamePhase = 'roundEnd';
        
        // Final trick winner
        this.gameState.finalTrickWinner = this.gameState.trickWinner;
        
        // Player next to final trick winner takes points
        const finalWinnerIndex = this.gameState.players.findIndex(p => p._id === this.gameState.finalTrickWinner._id);
        const penalizedPlayerIndex = (finalWinnerIndex + 1) % this.gameState.players.length;
        const penalizedPlayer = this.gameState.players[penalizedPlayerIndex];
        
        // Points = card value of winning card from final trick
        const finalTrick = this.gameState.trickHistory[this.gameState.trickHistory.length - 1];
        const winningCard = finalTrick.find(play => play.player._id === this.gameState.finalTrickWinner._id).card;
        const pointsToAdd = this.getCardPoints(winningCard);
        
        penalizedPlayer.points += pointsToAdd;
        
        // Check for elimination (12+ points)
        const eliminatedPlayers = this.gameState.players.filter(p => p.points >= 12 && !p.isEliminated);
        eliminatedPlayers.forEach(p => p.isEliminated = true);
        
        const activePlayers = this.gameState.players.filter(p => !p.isEliminated);
        
        if (activePlayers.length <= 1) {
            // Game over
            this.gameState.status = 'gameOver';
            const winner = activePlayers[0] || this.gameState.players.reduce((min, p) => p.points < min.points ? p : min);
            return {
                success: true,
                message: `Game Over! ${winner.username} wins! ${penalizedPlayer.username} took ${pointsToAdd} points from final trick.`,
                gameOver: true,
                gameWinner: winner
            };
        } else {
            // Continue to next round
            this.prepareNextRound();
            return {
                success: true,
                message: `Round ${this.gameState.round} complete! ${penalizedPlayer.username} took ${pointsToAdd} points. ${eliminatedPlayers.length ? `${eliminatedPlayers.map(p => p.username).join(', ')} eliminated!` : ''}`
            };
        }
    }

    prepareNextRound() {
        this.gameState.round++;
        this.gameState.gamePhase = 'dealing';
        this.gameState.trickHistory = [];
        this.gameState.currentTrick = [];
        this.gameState.callingSuit = null;
        this.gameState.trickWinner = null;
        this.gameState.finalTrickWinner = null;
        
        // Rotate dealer to next active player
        do {
            this.gameState.dealerIndex = (this.gameState.dealerIndex + 1) % this.gameState.players.length;
        } while (this.gameState.players[this.gameState.dealerIndex].isEliminated);
        
        // Update dealer status
        this.gameState.players.forEach((p, i) => {
            p.isDealer = (i === this.gameState.dealerIndex);
            p.cards = [];
        });
        
        this.dealCards();
    }

    getCardPoints(card) {
        // Card values for scoring
        if (card.rank === '3' && card.suit === '♠') {
            return 12; // Black 3
        }
        if (card.rank === '3') {
            return 6; // Other 3s
        }
        if (card.rank === '4') {
            return 4;
        }
        if (card.rank === 'A') {
            return 2;
        }
        return 1; // All other cards
    }

    nextPlayer() {
        do {
            this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + 1) % this.gameState.players.length;
        } while (this.gameState.players[this.gameState.currentPlayerIndex].isEliminated);
        
        this.updateCurrentPlayer();
    }

    updateCurrentPlayer() {
        this.gameState.players.forEach((p, index) => {
            p.isCurrent = (index === this.gameState.currentPlayerIndex);
        });
    }

    // =========================================================================
    // AI Logic - For Trick-Taking Game
    // =========================================================================

    shouldProcessAITurn() {
        if (this.gameState.status !== 'playing' || this.gameState.gamePhase !== 'playing') {
            return false;
        }
        const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
        return currentPlayer?.isAI && currentPlayer?.isActive && !currentPlayer?.isEliminated;
    }

    processAITurn() {
        const aiPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
        if (!aiPlayer || !aiPlayer.isAI) {
            return { success: false, error: 'Current player is not AI' };
        }

        console.log(`Processing AI turn for ${aiPlayer.username} (${aiPlayer.aiLevel})...`);

        const cardToPlay = this.selectAICard(aiPlayer);
        return this.playCard(aiPlayer._id, cardToPlay.id);
    }

    selectAICard(aiPlayer) {
        const callingSuit = this.gameState.callingSuit;
        
        if (callingSuit) {
            // Must follow suit if possible
            const suitCards = aiPlayer.cards.filter(card => card.suit === callingSuit);
            if (suitCards.length > 0) {
                return this.chooseFromSuitCards(suitCards, aiPlayer.aiLevel);
            }
        }
        
        // Can play any card
        return this.chooseFromAnyCards(aiPlayer.cards, aiPlayer.aiLevel);
    }

    chooseFromSuitCards(suitCards, aiLevel) {
        const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
        
        switch(aiLevel) {
            case 'beginner':
                // Play random card of suit
                return suitCards[Math.floor(Math.random() * suitCards.length)];
                
            case 'intermediate':
                // Try to win trick if first player, otherwise play low
                if (this.gameState.currentTrick.length === 0) {
                    return suitCards.reduce((max, card) => {
                        return (cardRanks[card.rank] || 0) > (cardRanks[max.rank] || 0) ? card : max;
                    });
                } else {
                    return suitCards.reduce((min, card) => {
                        return (cardRanks[card.rank] || 0) < (cardRanks[min.rank] || 0) ? card : min;
                    });
                }
                
            case 'advanced':
                // Strategic play based on trick position and card tracking
                if (this.gameState.currentTrick.length === 0) {
                    // Leading - play mid-range card
                    suitCards.sort((a, b) => (cardRanks[a.rank] || 0) - (cardRanks[b.rank] || 0));
                    return suitCards[Math.floor(suitCards.length / 2)];
                } else {
                    // Following - try to win if can with low card, else play lowest
                    const currentWinning = this.getCurrentTrickWinner();
                    const winningRank = cardRanks[currentWinning.card.rank] || 0;
                    const winnable = suitCards.filter(card => (cardRanks[card.rank] || 0) > winningRank);
                    
                    if (winnable.length > 0) {
                        return winnable.reduce((min, card) => {
                            return (cardRanks[card.rank] || 0) < (cardRanks[min.rank] || 0) ? card : min;
                        });
                    } else {
                        return suitCards.reduce((min, card) => {
                            return (cardRanks[card.rank] || 0) < (cardRanks[min.rank] || 0) ? card : min;
                        });
                    }
                }
                
            default:
                return suitCards[0];
        }
    }

    chooseFromAnyCards(cards, aiLevel) {
        // When can't follow suit, generally play low point cards
        const cardPoints = cards.map(card => ({ card, points: this.getCardPoints(card) }));
        cardPoints.sort((a, b) => a.points - b.points);
        
        switch(aiLevel) {
            case 'beginner':
                return cards[Math.floor(Math.random() * cards.length)];
            case 'intermediate':
            case 'advanced':
                // Play lowest point card
                return cardPoints[0].card;
            default:
                return cards[0];
        }
    }

    getCurrentTrickWinner() {
        if (this.gameState.currentTrick.length === 0) return null;
        
        const cardRanks = { 'A': 14, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3 };
        const validPlays = this.gameState.currentTrick.filter(play => 
            play.card.suit === this.gameState.callingSuit
        );
        
        if (validPlays.length === 0) return this.gameState.currentTrick[0];
        
        return validPlays.reduce((highest, current) => {
            const highestRank = cardRanks[highest.card.rank] || 0;
            const currentRank = cardRanks[current.card.rank] || 0;
            return currentRank > highestRank ? current : highest;
        });
    }

    // =========================================================================
    // Static Deck & Card Methods - Standard 52 Card Deck
    // =========================================================================

    static createStandardDeck() {
        const suits = ['♠', '♣', '♥', '♦'];
        const ranks = ['A', '3', '4', '5', '6', '7', '8', '9', '10'];
        const deck = [];
        let idCounter = 1;
        
        suits.forEach(suit => {
            ranks.forEach(rank => {
                deck.push({
                    id: idCounter++,
                    suit,
                    rank,
                    isSpecial: rank === '3' && suit === '♠' // Black 3 is special
                });
            });
        });
        return deck;
    }

    static shuffleDeck(deck) {
        const shuffled = [...deck];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
}

module.exports = GameEngine;
