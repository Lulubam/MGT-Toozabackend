// game/GameEngine.js - Tooza Card Game Engine with Proper Rules

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
            discardPile: [],
            round: 1,
            currentPlayerIndex: 0,
            lastPlayedCard: null,
            gameDirection: 1, // 1 for clockwise, -1 for counter-clockwise
            trickWinner: null,
            roundWinner: null
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
                case 'drawCard':
                    return this.drawCard(playerId);
                case 'pass':
                    return this.passTurn(playerId);
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
                isDealer: existingPlayer?.isDealer || false
            };
        });
        
        // Ensure proper current player assignment
        if (this.gameState.players.length > 0) {
            const hasCurrentPlayer = this.gameState.players.some(p => p.isCurrent);
            if (!hasCurrentPlayer) {
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
        this.updateCurrentPlayer();

        return { success: true, message: `${aiName} left the game` };
    }

    // =========================================================================
    // Game Flow Methods - Updated for Tooza Rules
    // =========================================================================

    startGame(playerId) {
        // Find the player who wants to start the game
        const player = this.gameState.players.find(p => 
            (p._id && p._id.toString()) === (playerId && playerId.toString())
        );
        
        if (!player) {
            return { success: false, error: 'Player not found.' };
        }

        if (this.gameState.players.length < 2) {
            return { success: false, error: 'Need at least 2 players to start.' };
        }
        
        // Set first player as dealer
        this.gameState.players.forEach((p, index) => {
            p.isDealer = index === 0;
            p.points = 0;
            p.cards = [];
        });

        this.gameState.status = 'playing';
        this.gameState.gamePhase = 'dealing';
        this.gameState.deck = GameEngine.shuffleDeck(GameEngine.createToozaDeck());
        this.gameState.discardPile = [];
        this.dealCards();
        
        return { success: true, message: 'Game started!' };
    }

    dealCards() {
        // Deal 5 cards to each player (standard Tooza)
        for (let i = 0; i < 5; i++) {
            this.gameState.players.forEach(player => {
                if (this.gameState.deck.length > 0) {
                    player.cards.push(this.gameState.deck.pop());
                }
            });
        }

        // Place first card on discard pile
        if (this.gameState.deck.length > 0) {
            this.gameState.discardPile.push(this.gameState.deck.pop());
            this.gameState.lastPlayedCard = this.gameState.discardPile[this.gameState.discardPile.length - 1];
        }

        // Set first player (left of dealer)
        const dealerIndex = this.gameState.players.findIndex(p => p.isDealer);
        this.gameState.currentPlayerIndex = (dealerIndex + 1) % this.gameState.players.length;
        this.updateCurrentPlayer();
        this.gameState.gamePhase = 'playing';
        
        return { success: true, message: 'Cards dealt. Game begins!' };
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

        if (!this.isValidToozaPlay(cardToPlay)) {
            return { success: false, error: 'Invalid card play. Must match suit or rank.' };
        }

        // Remove card from player's hand and add to discard pile
        currentPlayer.cards.splice(cardToPlayIndex, 1);
        this.gameState.discardPile.push(cardToPlay);
        this.gameState.lastPlayedCard = cardToPlay;

        // Handle special cards
        this.handleSpecialCard(cardToPlay, currentPlayer);

        // Check if player won the round
        if (currentPlayer.cards.length === 0) {
            return this.endRound(currentPlayer);
        }

        // Move to next player (unless direction was changed by special card)
        this.nextPlayer();
        return { success: true, message: `${currentPlayer.username} played ${cardToPlay.rank} of ${cardToPlay.suit}` };
    }

    isValidToozaPlay(card) {
        if (!this.gameState.lastPlayedCard) {
            return true; // First card can be anything
        }

        const lastCard = this.gameState.lastPlayedCard;
        
        // Must match either suit or rank
        return card.suit === lastCard.suit || card.rank === lastCard.rank;
    }

    handleSpecialCard(card, player) {
        switch(card.rank) {
            case 'A': // Ace - Reverse direction
                this.gameState.gameDirection *= -1;
                break;
            case '2': // Two - Next player draws 2 cards
                const nextIndex = this.getNextPlayerIndex();
                const nextPlayer = this.gameState.players[nextIndex];
                this.drawCards(nextPlayer, 2);
                // Skip the next player's turn
                this.gameState.currentPlayerIndex = this.getNextPlayerIndex(nextIndex);
                break;
            case '8': // Eight - Skip next player
                this.gameState.currentPlayerIndex = this.getNextPlayerIndex();
                break;
            case 'J': // Jack - Player can play again
                // Don't advance turn - same player plays again
                return;
            case 'K': // King - All other players draw 1 card
                this.gameState.players.forEach(p => {
                    if (p._id !== player._id) {
                        this.drawCards(p, 1);
                    }
                });
                break;
        }
    }

    drawCards(player, count) {
        for (let i = 0; i < count && this.gameState.deck.length > 0; i++) {
            player.cards.push(this.gameState.deck.pop());
        }
        
        // If deck is empty, reshuffle discard pile (except top card)
        if (this.gameState.deck.length === 0 && this.gameState.discardPile.length > 1) {
            const topCard = this.gameState.discardPile.pop();
            this.gameState.deck = GameEngine.shuffleDeck(this.gameState.discardPile);
            this.gameState.discardPile = [topCard];
        }
    }

    drawCard(playerId) {
        const player = this.gameState.players.find(p => 
            (p._id && p._id.toString()) === (playerId && playerId.toString())
        );
        
        if (!player) {
            return { success: false, error: 'Player not found' };
        }

        if (this.gameState.deck.length === 0) {
            return { success: false, error: 'No more cards to draw' };
        }

        this.drawCards(player, 1);
        return { success: true, message: 'Card drawn' };
    }

    getNextPlayerIndex(fromIndex = this.gameState.currentPlayerIndex) {
        const playerCount = this.gameState.players.length;
        return (fromIndex + this.gameState.gameDirection + playerCount) % playerCount;
    }

    nextPlayer() {
        this.gameState.currentPlayerIndex = this.getNextPlayerIndex();
        this.updateCurrentPlayer();
    }

    updateCurrentPlayer() {
        this.gameState.players.forEach((p, index) => {
            p.isCurrent = (index === this.gameState.currentPlayerIndex);
        });
    }

    endRound(winner) {
        this.gameState.gamePhase = 'roundEnd';
        this.gameState.roundWinner = winner;
        
        // Calculate points for remaining players
        this.gameState.players.forEach(player => {
            if (player._id !== winner._id) {
                const cardPoints = player.cards.reduce((sum, card) => {
                    return sum + this.getCardPoints(card);
                }, 0);
                player.points += cardPoints;
            }
        });

        // Check for game over (someone reaches 100 points or more)
        const eliminatedPlayers = this.gameState.players.filter(p => p.points >= 100);
        if (eliminatedPlayers.length > 0) {
            this.gameState.status = 'gameOver';
            // Winner is player with lowest points
            const gameWinner = this.gameState.players.reduce((min, player) => 
                player.points < min.points ? player : min
            );
            return { 
                success: true, 
                message: `Round won by ${winner.username}! Game won by ${gameWinner.username}!`,
                gameOver: true,
                gameWinner: gameWinner
            };
        } else {
            // Start new round
            this.gameState.round++;
            this.prepareNewRound();
            return { 
                success: true, 
                message: `Round ${this.gameState.round - 1} won by ${winner.username}! Starting new round.`
            };
        }
    }

    prepareNewRound() {
        // Reset for new round
        this.gameState.gamePhase = 'dealing';
        this.gameState.deck = GameEngine.shuffleDeck(GameEngine.createToozaDeck());
        this.gameState.discardPile = [];
        this.gameState.lastPlayedCard = null;
        this.gameState.gameDirection = 1;
        
        // Clear all cards
        this.gameState.players.forEach(player => {
            player.cards = [];
        });
        
        // Rotate dealer
        const currentDealerIndex = this.gameState.players.findIndex(p => p.isDealer);
        this.gameState.players[currentDealerIndex].isDealer = false;
        const newDealerIndex = (currentDealerIndex + 1) % this.gameState.players.length;
        this.gameState.players[newDealerIndex].isDealer = true;
        
        this.dealCards();
    }

    getCardPoints(card) {
        // Point values for Tooza
        switch(card.rank) {
            case 'A': return 15;
            case 'K': return 10;
            case 'Q': return 10;
            case 'J': return 10;
            case '2': return 20; // Draw 2 card
            case '8': return 50; // Skip card
            default: return parseInt(card.rank) || 0;
        }
    }

    // =========================================================================
    // AI Logic - Enhanced
    // =========================================================================

    shouldProcessAITurn() {
        if (this.gameState.status !== 'playing' || this.gameState.gamePhase !== 'playing') {
            return false;
        }
        const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
        return currentPlayer?.isAI && currentPlayer?.isActive;
    }

    processAITurn() {
        const aiPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
        if (!aiPlayer || !aiPlayer.isAI) {
            return { success: false, error: 'Current player is not AI' };
        }

        console.log(`Processing AI turn for ${aiPlayer.username} (${aiPlayer.aiLevel})...`);

        const validCards = aiPlayer.cards.filter(card => this.isValidToozaPlay(card));

        if (validCards.length > 0) {
            let cardToPlay = this.selectAICard(aiPlayer, validCards);
            return this.playCard(aiPlayer._id, cardToPlay.id);
        } else {
            // Must draw a card
            const drawResult = this.drawCard(aiPlayer._id);
            if (drawResult.success) {
                // Check if drawn card can be played
                const drawnCard = aiPlayer.cards[aiPlayer.cards.length - 1];
                if (this.isValidToozaPlay(drawnCard)) {
                    // AI can choose to play it or pass
                    if (aiPlayer.aiLevel === 'advanced' && Math.random() > 0.3) {
                        return this.playCard(aiPlayer._id, drawnCard.id);
                    }
                }
            }
            // Pass turn
            this.nextPlayer();
            return { success: true, message: `${aiPlayer.username} drew a card and passed` };
        }
    }

    selectAICard(aiPlayer, validCards) {
        const lastCard = this.gameState.lastPlayedCard;
        
        switch(aiPlayer.aiLevel) {
            case 'beginner':
                // Play first valid card
                return validCards[0];
                
            case 'intermediate':
                // Prefer special cards, then matching rank over suit
                const specialCards = validCards.filter(card => 
                    ['A', '2', '8', 'J', 'K'].includes(card.rank)
                );
                if (specialCards.length > 0) {
                    return specialCards[0];
                }
                
                const rankMatches = validCards.filter(card => card.rank === lastCard.rank);
                if (rankMatches.length > 0) {
                    return rankMatches[0];
                }
                return validCards[0];
                
            case 'advanced':
                // Strategic play - consider hand size, special cards, and opponent disruption
                const handSize = aiPlayer.cards.length;
                
                // If close to winning, play high-value cards first
                if (handSize <= 3) {
                    const highValueCards = validCards.filter(card => 
                        ['A', 'K', 'Q', 'J', '2', '8'].includes(card.rank)
                    );
                    if (highValueCards.length > 0) {
                        return highValueCards[0];
                    }
                }
                
                // Strategic special card usage
                const strategicSpecials = validCards.filter(card => {
                    if (card.rank === '2') return true; // Always good
                    if (card.rank === 'K' && this.gameState.players.length > 2) return true;
                    if (card.rank === 'A' && this.gameState.players.length > 2) return true;
                    return false;
                });
                
                if (strategicSpecials.length > 0) {
                    return strategicSpecials[0];
                }
                
                // Prefer rank matches to maintain control
                const rankMatches = validCards.filter(card => card.rank === lastCard.rank);
                if (rankMatches.length > 0) {
                    return rankMatches[0];
                }
                
                return validCards[0];
                
            default:
                return validCards[0];
        }
    }

    // =========================================================================
    // Static Deck & Card Methods - Updated for Tooza
    // =========================================================================

    static createToozaDeck() {
        const suits = ['♠', '♣', '♥', '♦'];
        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const deck = [];
        let idCounter = 1;
        
        suits.forEach(suit => {
            ranks.forEach(rank => {
                deck.push({
                    id: idCounter++,
                    suit,
                    rank,
                    isSpecial: ['A', '2', '8', 'J', 'K'].includes(rank)
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

    static initializeGame(players) {
        return {
            players: players.map((player, index) => ({
                ...player,
                cards: [],
                points: 0,
                isDealer: index === 0,
                isCurrent: index === 0
            })),
            deck: this.shuffleDeck(this.createToozaDeck()),
            discardPile: [],
            gamePhase: 'playing',
            status: 'playing',
            currentPlayerIndex: 0,
            lastPlayedCard: null,
            gameDirection: 1,
            round: 1
        };
    }
}

module.exports = GameEngine;
