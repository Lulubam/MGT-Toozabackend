const crypto = require('crypto');

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  generateRoomCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  createRoom(hostPlayer) {
    const code = this.generateRoomCode();
    this.rooms.set(code, {
      players: [{
        ...hostPlayer,
        isHost: true,
        isReady: false
      }],
      gameState: null,
      createdAt: new Date()
    });
    return code;
  }

  joinRoom(code, player) {
    const room = this.rooms.get(code);
    if (!room || room.players.length >= 8) return false;

    room.players.push({
      ...player,
      isHost: false,
      isReady: false
    });
    return true;
  }

  getRoom(code) {
    return this.rooms.get(code);
  }
}

module.exports = new RoomManager();
