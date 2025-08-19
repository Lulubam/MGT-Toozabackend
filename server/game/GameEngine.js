// game/GameEngine.js - Correct Trick-Taking Game Engine with Dealer Selection

class GameEngine {
    constructor(roomCode) {
        this.roomCode = roomCode;
        this.gameState = {
            status: 'waiting', // waiting, dealerSelection, playing, gameOver
            players: [],
            currentTrick: [],
            trickHistory: [],
            gamePhase: 'waiting', // waiting, dealing, playing, roundEnd
            deck: [],
            round: 1,
            currentPlayerIndex: 0,
            dealerIndex: 0,
            callingSuit: null, 
            trickLeader: null,
            trickWinner: null,
            gameDirection: 1, 
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
                case 'drawDealerCard':
                    return this.drawDealerCard(playerId);
                case 'confirmDealer':
                    return this.confirmDealer(playerId);
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
    // Dealer Selection Methods
    // =========================================================================
    drawDealerCard(playerId) {
        const player = this.gameState.players.find(p => 
            (p._id && p._id.toString()) === (playerId && playerId.toString())
        );
        if (!player) return { success: false, error: 'Player not found' };

        if (player.dealerCard) {
            return { success: false, error: 'Player already drew a card' };
        }

        const tempDeck = GameEngine.shuffleDeck(GameEngine.createStandardDeck());
        const card = tempDeck.pop();

        player.dealerCard = card;

        return { success: true, message: `${player.username} drew ${card.rank}${card.suit}`, card };
    }

    confirmDealer(playerId) {
        const rankOrder = { 'A': 14, '10': 13, '9': 12, '8': 11, '7': 10, '6': 9, '5': 8, '4': 7, '3': 6 };
        const sorted = [...this.gameState.players].filter(p => p.dealerCard).sort((a, b) => {
            return (rankOrder[b.dealerCard?.rank] || 0) - (rankOrder[a.dealerCard?.rank] || 0);
        });

        if (!sorted.length) {
            return { success: false, error: 'No dealer cards drawn yet' };
        }

        const dealer = sorted[0];
        this.gameState.dealerIndex = this.gameState.players.findIndex(p => p._id.toString() === dealer._id.toString());
        this.gameState.players.forEach(p => p.isDealer = false);
        this.gameState.players[this.gameState.dealerIndex].isDealer = true;

        // Move to dealing phase
        this.dealCards();
        this.gameState.status = 'playing';

        return { success: true, message: `${dealer.username} is the dealer! Game starts.` };
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

        const aiExists = this.gameState.players.some(p => 
            p.username === AI_PLAYERS[aiKey].name && p.isAI
        );
        if (aiExists) {
            return { success: false, error: 'AI player already in room' };
        }

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

        this.gameState.players.splice(aiIndex, 1);
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
    // Game Flow Methods (dealing, playCard, tricks, scoring, AI, etc.)
    // =========================================================================
    // ⚠️ All your existing methods (dealCards, playCard, isValidPlay, completeTrick, etc.)
    // remain the same as in the file you provided — no changes required.
    // =========================================================================

    // ... keep all your methods (dealCards, playCard, isValidPlay, etc.) here ...
    // (No edits needed, they already match your frontend gameplay rules)

    // =========================================================================
    // Static Deck & Card Methods
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
                    isSpecial: rank === '3' && suit === '♠'
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
