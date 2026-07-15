import Phaser from 'phaser';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { GAME_WIDTH, GAME_HEIGHT } from './constants.js';

const config = {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: 'game-container',
    backgroundColor: '#1a1a2e',
    pixelArt: true,
    scene: [MenuScene, GameScene],
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    input: {
        activePointers: 2
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 }
        }
    }
};

const game = new Phaser.Game(config);

// Force game loop to run even when tab is not visible
game.loop.skipInactive = false;

// Prevent Phaser from auto-pausing when tab is hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        game.events.emit('hidden');
    } else {
        game.events.emit('visible');
    }
});