class GameEngine {
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
      flushVisibility: 'closed'
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
