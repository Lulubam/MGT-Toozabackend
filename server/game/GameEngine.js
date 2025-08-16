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
            const existingPlayer = this.gameState.players.find(gp => gp._id.toString() === p._id.toString());
            return {
                ...existingPlayer,
                ...p.toObject(),
                isCurrent: existingPlayer?.isCurrent || false
            };
        });
        // Ensure one player is always the current one after an update
        if (!this.gameState.players.find(p => p.isCurrent) && this.gameState.players.length > 0) {
            this.gameState.players[0].isCurrent = true;
        }
    }

    // =========================================================================
    // Game Flow Methods
    // =========================================================================

    startGame(playerId) {
        const dealer = this.gameState.players.find(p => p._id.toString() === playerId);
        if (!dealer || !dealer.isDealer) {
            return { success: false, error: 'Only the dealer can start the game.' };
        }
        if (this.gameState.players.length < 2) {
            return { success: false, error: 'Need at least 2 players to start.' };
        }
        
        this.gameState.status = 'playing';
        this.gameState.gamePhase = 'dealing';
        this.gameState.deck = GameEngine.shuffleDeck(GameEngine.createDeck());
        this.dealCards();
        return { success: true };
    }

    dealCards() {
        // Phase 1: 3 cards
        for (let i = 0; i < 3; i++) {
            this.gameState.players.forEach(player => {
                if (this.gameState.deck.length > 0) {
                    player.cards.push(this.gameState.deck.pop());
                }
            });
        }
        
        // Phase 2: 2 cards
        for (let i = 0; i < 2; i++) {
            this.gameState.players.forEach(player => {
                if (this.gameState.deck.length > 0) {
                    player.cards.push(this.gameState.deck.pop());
                }
            });
        }

        // Determine the first player to start the trick
        const dealerIndex = this.gameState.players.findIndex(p => p.isDealer);
        this.gameState.currentPlayerIndex = (dealerIndex + 1) % this.gameState.players.length;
        this.updateCurrentPlayer();

        this.gameState.gamePhase = 'playing';
        
        return { success: true, message: 'Cards dealt.' };
    }

    playCard(playerId, cardId) {
        const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];

        if (currentPlayer._id.toString() !== playerId.toString()) {
            return { success: false, error: 'It is not your turn to play.' };
        }

        const cardToPlayIndex = currentPlayer.cards.findIndex(card => card.id === cardId);
        if (cardToPlayIndex === -1) {
            return { success: false, error: 'Card not found in your hand.' };
        }

        const cardToPlay = currentPlayer.cards[cardToPlayIndex];

        if (!this.isValidCardPlay(cardToPlay)) {
            return { success: false, error: 'Invalid card play.' };
        }

        // Add card to current trick
        this.gameState.currentTrick.push({
            card: cardToPlay,
            playerId: currentPlayer._id,
            playerName: currentPlayer.username
        });

        // Remove card from player's hand
        currentPlayer.cards.splice(cardToPlayIndex, 1);
        this.gameState.lastPlayedCard = cardToPlay;
        
        // Handle trick end logic
        if (this.gameState.currentTrick.length === this.gameState.players.length) {
            this.endTrick();
        } else {
            this.nextPlayer();
        }

        return { success: true };
    }

    // Checks if a card play is valid based on the last played card (following suit)
    isValidCardPlay(card) {
        if (!this.gameState.lastPlayedCard) {
            return true; // First card of a trick, any card is valid
        }
        const lastCard = this.gameState.lastPlayedCard;

        // Check if the player has a card of the same suit
        const hasSameSuit = this.gameState.players[this.gameState.currentPlayerIndex].cards.some(c => c.suit === lastCard.suit);

        // If player has a card of the same suit, they must follow suit.
        if (hasSameSuit) {
            return card.suit === lastCard.suit;
        }

        // If no card of the same suit, any card can be played.
        return true;
    }

    // Move to the next player
    nextPlayer() {
        this.gameState.currentPlayerIndex = (this.gameState.currentPlayerIndex + this.gameState.gameDirection + this.gameState.players.length) % this.gameState.players.length;
        this.updateCurrentPlayer();
    }

    updateCurrentPlayer() {
        this.gameState.players.forEach((p, index) => {
            p.isCurrent = (index === this.gameState.currentPlayerIndex);
        });
    }
    
    // Logic for ending a trick, determining the winner, and scoring
    endTrick() {
        const winningTrickPlay = this.getTrickWinner();
        const winner = this.gameState.players.find(p => p._id.toString() === winningTrickPlay.playerId.toString());
        
        if (winner) {
            // Add the trick to the history
            this.gameState.trickHistory.push({
                winner: winner._id,
                cards: this.gameState.currentTrick
            });
            
            // Move all cards from the trick to the deck
            this.gameState.deck.push(...this.gameState.currentTrick.map(play => play.card));

            // Determine the player who takes the points
            let takerIndex = this.gameState.players.findIndex(p => p._id.toString() === winner._id.toString());
            takerIndex = (takerIndex + 1) % this.gameState.players.length; // Player to the winner's left
            
            const taker = this.gameState.players[takerIndex];
            const pointsToAdd = GameEngine.getAttackValue(winningTrickPlay.card.rank, winningTrickPlay.card.suit);
            
            taker.points += pointsToAdd;
            console.log(`Player ${taker.username} takes ${pointsToAdd} points. Total points: ${taker.points}`);
            
            // Check for elimination
            if (taker.points >= 12) {
                this.eliminatePlayer(taker);
            }

            // Set the next dealer (winner of the trick)
            this.gameState.players.forEach(p => p.isDealer = false);
            winner.isDealer = true;

            // Prepare for next round
            this.gameState.currentTrick = [];
            this.gameState.lastPlayedCard = null;
            this.gameState.currentPlayerIndex = this.gameState.players.findIndex(p => p._id.toString() === winner._id.toString());
            this.updateCurrentPlayer();
            this.gameState.round++;
        }
    }

    // Determine the trick winner based on the rules.txt
    getTrickWinner() {
        const callingCard = this.gameState.currentTrick[0].card;
        let highestRankedCard = callingCard;
        let winningTrickPlay = this.gameState.currentTrick[0];

        // Filter for cards that followed suit
        const followingSuitPlays = this.gameState.currentTrick.filter(play => play.card.suit === callingCard.suit);

        // Find the highest ranked card among those that followed suit
        for (const play of followingSuitPlays) {
            if (GameEngine.getPlayOrder(play.card.rank) > GameEngine.getPlayOrder(highestRankedCard.rank)) {
                highestRankedCard = play.card;
                winningTrickPlay = play;
            }
        }
        return winningTrickPlay;
    }

    eliminatePlayer(player) {
        console.log(`Player ${player.username} is eliminated.`);
        this.gameState.players = this.gameState.players.filter(p => p._id.toString() !== player._id.toString());
        
        // If only one player is left, the game is over
        if (this.gameState.players.length === 1) {
            this.gameState.status = 'gameOver';
        }
        // If the eliminated player was the current one, advance the turn
        if (this.gameState.currentPlayerIndex >= this.gameState.players.length) {
            this.gameState.currentPlayerIndex = 0;
            this.updateCurrentPlayer();
        }
    }

    // =========================================================================
    // AI Logic
    // =========================================================================

    shouldProcessAITurn() {
        if (this.gameState.status !== 'playing' || this.gameState.gamePhase !== 'playing') {
            return false;
        }
        const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
        return currentPlayer?.isAI;
    }

    processAITurn() {
        const aiPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
        console.log(`Processing AI turn for ${aiPlayer.username}...`);

        const lastCard = this.gameState.lastPlayedCard;
        const validCards = aiPlayer.cards.filter(card => this.isValidCardPlay(card));

        let cardToPlay;

        if (validCards.length > 0) {
            // Simple AI logic:
            // 1. Play the highest ranking card of the same suit if available
            // 2. If no same suit, play any card
            // 3. For a more advanced AI, add logic for special cards (e.g., A, 3, 4)
            validCards.sort((a, b) => GameEngine.getPlayOrder(b.rank) - GameEngine.getPlayOrder(a.rank));

            const sameSuitCards = validCards.filter(c => c.suit === lastCard?.suit);

            if (sameSuitCards.length > 0) {
                // Play the highest rank of the same suit
                cardToPlay = sameSuitCards[0];
            } else {
                // Play a random valid card
                cardToPlay = validCards[Math.floor(Math.random() * validCards.length)];
            }
            
            // Play the card
            return this.playCard(aiPlayer._id, cardToPlay.id);
        } else {
            // No valid card, draw a card
            // The `rules.txt` doesn't explicitly mention drawing, but this is a standard behavior.
            const drawnCard = this.gameState.deck.pop();
            if (drawnCard) {
                aiPlayer.cards.push(drawnCard);
                // Check if the drawn card can be played.
                if (this.isValidCardPlay(drawnCard)) {
                    // Play the drawn card immediately
                    return this.playCard(aiPlayer._id, drawnCard.id);
                }
            }
            // If the drawn card can't be played or no cards to draw, pass the turn.
            return this.passTurn(aiPlayer._id);
        }
    }

    // =========================================================================
    // Static Deck & Card Methods
    // =========================================================================

    static createDeck() {
        const suits = ['♠', '♣', '♥', '♦'];
        const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'A'];
        const deck = [];
        let idCounter = 1;
        
        suits.forEach(suit => {
            ranks.forEach(rank => {
                deck.push({
                    id: idCounter++,
                    suit,
                    rank,
                    isSpecial: ['A', '4', '3'].includes(rank)
                });
            });
        });
        return deck;
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
