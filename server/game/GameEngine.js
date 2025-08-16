// game/GameEngine.js

class GameEngine {
    constructor(roomCode) {
        this.roomCode = roomCode;
        this.gameState = {
            status: 'waiting',
            players: [],
            currentTrick: [],
            trickHistory: [],
            gamePhase: 'dealerSelection',
            flushVisibility: 'closed',
            deck: [],
            round: 1,
            currentPlayerIndex: 0,
            lastPlayedCard: null,
            gameDirection: 1 // 1 for clockwise, -1 for counter-clockwise
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
                    return this.startGame();
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
                default:
                    return { success: false, error: 'Unknown action' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // REQUIRED: Instance method for the server
    shouldProcessAITurn() {
        if (this.gameState.status !== 'playing') return false;
        
        const currentPlayer = this.getCurrentPlayer();
        return currentPlayer && currentPlayer.isAI;
    }

    // REQUIRED: Instance method for the server
    processAITurn() {
        console.log('Processing AI turn...');
        
        const currentPlayer = this.getCurrentPlayer();
        if (!currentPlayer || !currentPlayer.isAI) {
            return { success: false, error: 'Not AI turn' };
        }

        // AI decision making based on difficulty level
        const validCards = this.getValidCards(currentPlayer.id);
        
        if (validCards.length === 0) {
            // AI must draw a card
            const drawResult = this.drawCard(currentPlayer.id);
            if (!drawResult.success) {
                return this.passTurn(currentPlayer.id);
            }
            
            // Check if the drawn card can be played
            const newValidCards = this.getValidCards(currentPlayer.id);
            const drawnCard = currentPlayer.cards[currentPlayer.cards.length - 1];
            
            if (newValidCards.find(card => card.id === drawnCard.id)) {
                // AI might play the drawn card based on difficulty
                if (this.shouldAIPlayCard(currentPlayer, drawnCard)) {
                    return this.playCard(currentPlayer.id, drawnCard.id);
                }
            }
            
            return this.passTurn(currentPlayer.id);
        }

        // Choose the best card to play based on AI level
        const chosenCard = this.chooseAICard(currentPlayer, validCards);
        return this.playCard(currentPlayer.id, chosenCard.id);
    }

    shouldAIPlayCard(player, card) {
        // Beginner AI: 50% chance to play
        if (player.level === 'beginner') return Math.random() < 0.5;
        
        // Intermediate AI: 75% chance to play
        if (player.level === 'intermediate') return Math.random() < 0.75;
        
        // Advanced AI: Always plays if possible
        return true;
    }

    chooseAICard(player, validCards) {
        if (player.level === 'beginner') {
            // Random selection
            return validCards[Math.floor(Math.random() * validCards.length)];
        }
        
        if (player.level === 'intermediate') {
            // Prefer higher value cards
            return validCards.reduce((best, card) => 
                (card.attackValue || 1) > (best.attackValue || 1) ? card : best
            );
        }
        
        // Advanced AI: Strategic play
        // Prefer special cards, then high value cards
        const specialCards = validCards.filter(card => ['3', '4', 'A'].includes(card.rank));
        if (specialCards.length > 0) {
            return specialCards.reduce((best, card) => 
                (card.attackValue || 1) > (best.attackValue || 1) ? card : best
            );
        }
        
        return validCards.reduce((best, card) => 
            (card.attackValue || 1) > (best.attackValue || 1) ? card : best
        );
    }

    getCurrentPlayer() {
        return this.gameState.players[this.gameState.currentPlayerIndex];
    }

    // Game-specific instance methods
    startGame() {
        if (this.gameState.players.length < 2) {
            return { success: false, error: 'Need at least 2 players to start' };
        }
        
        // Initialize the game
        this.gameState.status = 'playing';
        this.gameState.gamePhase = 'playing';
        this.gameState.deck = GameEngine.shuffleDeck(GameEngine.createDeck());
        
        // Deal cards to players
        this.dealCards();
        
        // Set first player (dealer starts)
        const dealerIndex = this.gameState.players.findIndex(p => p.isDealer);
        this.gameState.currentPlayerIndex = dealerIndex >= 0 ? dealerIndex : 0;
        this.updateCurrentPlayer();
        
        return { success: true };
    }

    addPlayer(player) {
        // Check if game already started
        if (this.gameState.status !== 'waiting') {
            return { success: false, error: 'Game already started' };
        }
        
        // Check if player already exists
        const existingPlayer = this.gameState.players.find(p => p.id === player.id);
        if (existingPlayer) {
            return { success: false, error: 'Player already in game' };
        }
        
        // Add player to game state
        const newPlayer = {
            id: player.id,
            username: player.username,
            socketId: player.socketId,
            cards: [],
            points: 0,
            isDealer: this.gameState.players.length === 0, // First player is dealer
            isCurrent: false,
            isAI: player.isAI || false,
            level: player.level || null
        };
        
        this.gameState.players.push(newPlayer);
        
        console.log(`Player ${player.username} added to game. Total players: ${this.gameState.players.length}`);
        return { success: true };
    }

    joinGame(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (player) {
            return { success: true, message: 'Player already in game' };
        }
        return { success: false, error: 'Player not found in game' };
    }

    playCard(playerId, cardId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }

        // Check if it's player's turn
        if (!player.isCurrent) {
            return { success: false, error: 'Not your turn' };
        }

        const cardIndex = player.cards.findIndex(c => c.id === cardId);
        if (cardIndex === -1) {
            return { success: false, error: 'Card not found in hand' };
        }

        const card = player.cards[cardIndex];

        // Validate card play
        if (!this.isValidCardPlay(card)) {
            return { success: false, error: 'Invalid card play' };
        }

        // Remove card from player's hand
        player.cards.splice(cardIndex, 1);
        
        // Add to current trick
        this.gameState.currentTrick.push({
            playerId: playerId,
            playerName: player.username,
            card: card
        });

        // Update last played card
        this.gameState.lastPlayedCard = card;

        // Apply card effects
        this.applyCardEffects(card, player);

        // Check for win condition
        if (player.cards.length === 0) {
            this.endGame(player);
            return { success: true, gameEnded: true, winner: player.username };
        }

        // Move to next player
        this.nextPlayer();
        
        return { success: true };
    }

    isValidCardPlay(card) {
        // First card of the game
        if (!this.gameState.lastPlayedCard) {
            return true;
        }

        const lastCard = this.gameState.lastPlayedCard;
        
        // Same suit or same rank
        return card.suit === lastCard.suit || card.rank === lastCard.rank;
    }

    applyCardEffects(card, player) {
        switch (card.rank) {
            case '3': // Spade 3 is special, others make next player draw
                if (card.suit === '♠') {
                    // Ultimate card - next player draws 3 and loses turn
                    this.makeNextPlayerDraw(3);
                    this.skipNextPlayer();
                } else {
                    // Regular 3 - next player draws 1
                    this.makeNextPlayerDraw(1);
                }
                break;
            case '4': // Skip next player
                this.skipNextPlayer();
                break;
            case 'A': // Reverse direction
                this.gameState.gameDirection *= -1;
                break;
        }
    }

    makeNextPlayerDraw(numCards) {
        const nextPlayerIndex = this.getNextPlayerIndex();
        const nextPlayer = this.gameState.players[nextPlayerIndex];
        
        if (nextPlayer) {
            for (let i = 0; i < numCards; i++) {
                if (this.gameState.deck.length > 0) {
                    const drawnCard = this.gameState.deck.pop();
                    nextPlayer.cards.push(drawnCard);
                }
            }
        }
    }

    skipNextPlayer() {
        // Move current player index forward by one additional step
        this.nextPlayer();
    }

    nextPlayer() {
        // Update current player
        this.gameState.currentPlayerIndex = this.getNextPlayerIndex();
        this.updateCurrentPlayer();
    }

    getNextPlayerIndex() {
        const currentIndex = this.gameState.currentPlayerIndex;
        const playerCount = this.gameState.players.length;
        
        if (this.gameState.gameDirection === 1) {
            return (currentIndex + 1) % playerCount;
        } else {
            return (currentIndex - 1 + playerCount) % playerCount;
        }
    }

    updateCurrentPlayer() {
        // Reset all players' current status
        this.gameState.players.forEach(p => p.isCurrent = false);
        
        // Set current player
        if (this.gameState.players[this.gameState.currentPlayerIndex]) {
            this.gameState.players[this.gameState.currentPlayerIndex].isCurrent = true;
        }
    }

    drawCard(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }

        if (!player.isCurrent) {
            return { success: false, error: 'Not your turn' };
        }

        if (this.gameState.deck.length === 0) {
            return { success: false, error: 'No cards left in deck' };
        }

        const drawnCard = this.gameState.deck.pop();
        player.cards.push(drawnCard);

        return { success: true, drawnCard };
    }

    passTurn(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }

        if (!player.isCurrent) {
            return { success: false, error: 'Not your turn' };
        }

        this.nextPlayer();
        return { success: true };
    }

    dealCards() {
        if (this.gameState.deck.length === 0) {
            this.gameState.deck = GameEngine.shuffleDeck(GameEngine.createDeck());
        }
        
        // Deal 6 cards to each player (standard Whot rules)
        const cardsPerPlayer = 6;
        
        this.gameState.players.forEach((player, playerIndex) => {
            player.cards = [];
            for (let i = 0; i < cardsPerPlayer; i++) {
                if (this.gameState.deck.length > 0) {
                    player.cards.push(this.gameState.deck.pop());
                }
            }
        });
        
        return { success: true };
    }

    getValidCards(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) return [];
        
        if (!this.gameState.lastPlayedCard) {
            return player.cards; // First play, any card is valid
        }

        return player.cards.filter(card => this.isValidCardPlay(card));
    }

    endGame(winner) {
        this.gameState.status = 'finished';
        this.gameState.winner = {
            id: winner.id,
            username: winner.username
        };
        
        // Calculate scores for all players
        this.gameState.players.forEach(player => {
            const cardValues = player.cards.reduce((total, card) => {
                return total + (card.attackValue || 1);
            }, 0);
            player.finalScore = cardValues;
        });
    }

    // STATIC METHODS (your existing methods)
    static createDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const ranks = ['A', '3', '4', '5', '6', '7', '8', '9', '10'];
        
        return suits.flatMap(suit => 
            ranks.map(rank => ({
                rank,
                suit,
                id: `${rank}${suit}`,
                playOrder: this.getPlayOrder(rank),
                attackValue: this.getAttackValue(rank, suit)
            }))
        );
    }

    static getAttackValue(rank, suit) {
        if (rank === '3' && suit === '♠') return 12; // Spade 3 is ultimate
        if (rank === '3') return 6; // Other 3s
        if (rank === '4') return 4; // Skip cards
        if (rank === 'A') return 2; // Reverse cards
        return 1; // Regular cards
    }

    static getPlayOrder(rank) {
        const order = ['3', '4', '5', '6', '7', '8', '9', '10', 'A'];
        return order.indexOf(rank);
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
            deck: this.shuffleDeck(this.createDeck()),
            trickHistory: [],
            currentTrick: [],
            gamePhase: 'playing',
            flushVisibility: 'closed',
            status: 'playing',
            currentPlayerIndex: 0,
            lastPlayedCard: null,
            gameDirection: 1
        };
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
