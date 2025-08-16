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
            round: 1
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
                // Add your other actions
                default:
                    return { success: false, error: 'Unknown action' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // REQUIRED: Instance method for the server
    shouldProcessAITurn() {
        // Return true if it's AI's turn and AI should act
        return false; // Adjust based on your game logic
    }

    // REQUIRED: Instance method for the server
    processAITurn() {
        console.log('Processing AI turn...');
        // Your AI logic here
    }

    // Game-specific instance methods
    startGame() {
        if (this.gameState.players.length < 2) {
            return { success: false, error: 'Need at least 2 players to start' };
        }
        
        // Initialize the game with current players
        const initializedState = GameEngine.initializeGame(this.gameState.players);
        // Keep the existing players but update other properties
        this.gameState = {
            ...initializedState,
            status: 'playing',
            players: this.gameState.players.map((player, index) => ({
                ...player,
                cards: [],
                points: 0,
                isDealer: index === 0,
                isCurrent: index === 0
            }))
        };
        
        // Deal cards to players
        this.dealCards();
        
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
        this.gameState.players.push({
            id: player.id,
            username: player.username,
            socketId: player.socketId,
            cards: [],
            points: 0,
            isDealer: this.gameState.players.length === 0, // First player is dealer
            isCurrent: this.gameState.players.length === 0 // First player goes first
        });
        
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
        // Your card playing logic
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        // Add your card playing logic here
        return { success: true };
    }

    dealCards() {
        this.gameState.deck = GameEngine.shuffleDeck(GameEngine.createDeck());
        
        // Deal cards to each player (adjust number as needed)
        const cardsPerPlayer = Math.floor(this.gameState.deck.length / this.gameState.players.length);
        
        this.gameState.players.forEach((player, playerIndex) => {
            player.cards = this.gameState.deck.slice(
                playerIndex * cardsPerPlayer,
                (playerIndex + 1) * cardsPerPlayer
            );
        });
        
        return { success: true };
    }

    getValidCards(playerId) {
        const player = this.gameState.players.find(p => p.id === playerId);
        if (!player) return [];
        
        // Return all cards for now - implement your game's validity rules
        return player.cards;
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
        if (rank === '3' && suit === '♠') return 12;
        if (rank === '3') return 6;
        if (rank === '4') return 4;
        if (rank === 'A') return 2;
        return 1;
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
            gamePhase: 'dealerSelection',
            flushVisibility: 'closed',
            status: 'playing'
        };
    }

    static shuffleDeck(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }
}

module.exports = GameEngine;
