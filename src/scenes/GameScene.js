import Phaser from 'phaser';
import { WarfireGame } from '../game/WarfireGame.js';

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.warfireGame = null;
        this.gameConfig = null;
    }

    init(data) {
        // Receive configuration from MenuScene
        this.gameConfig = data || {
            mapWidth: 20,
            mapHeight: 15,
            players: [
                { name: 'Player 1', isAI: false },
                { name: 'Player 2', isAI: true }
            ]
        };
    }

    preload() {
        // Textures are created procedurally in WarfireGame
    }

    create() {
        this.warfireGame = new WarfireGame(this, this.gameConfig);
        this.warfireGame.initialize();
    }
}
