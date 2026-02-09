import Phaser from 'phaser';
import { CONFIG, COLORS, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';

/**
 * Menu scene for game configuration - map size, player count, AI settings
 */
export class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
        this.settings = {
            mapWidth: 20,
            mapHeight: 15,
            numPlayers: 2,
            players: [
                { name: 'Player 1', isAI: false },
                { name: 'Player 2', isAI: true },
                { name: 'Player 3', isAI: true },
                { name: 'Player 4', isAI: true }
            ]
        };
    }

    create() {
        this.createBackground();
        this.createTitle();
        this.createMapSizeSection();
        this.createPlayerCountSection();
        this.createPlayerSettingsSection();
        this.createStartButton();
        this.createHelpText();
    }

    createBackground() {
        // Dark gradient background
        const graphics = this.add.graphics();
        for (let y = 0; y < GAME_HEIGHT; y++) {
            const t = y / GAME_HEIGHT;
            const color = Phaser.Display.Color.Interpolate.ColorWithColor(
                Phaser.Display.Color.ValueToColor(0x1a1a2e),
                Phaser.Display.Color.ValueToColor(0x0f172a),
                1, t
            );
            graphics.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1);
            graphics.fillRect(0, y, GAME_WIDTH, 1);
        }

        // Decorative grid
        graphics.lineStyle(1, 0x2d3748, 0.3);
        for (let x = 0; x < GAME_WIDTH; x += 40) {
            graphics.beginPath();
            graphics.moveTo(x, 0);
            graphics.lineTo(x, GAME_HEIGHT);
            graphics.strokePath();
        }
        for (let y = 0; y < GAME_HEIGHT; y += 40) {
            graphics.beginPath();
            graphics.moveTo(0, y);
            graphics.lineTo(GAME_WIDTH, y);
            graphics.strokePath();
        }
    }

    createTitle() {
        const title = this.add.text(GAME_WIDTH / 2, 50, 'WARFIRE', {
            fontSize: '64px',
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#FFD23F'
        }).setOrigin(0.5);

        // Glow effect
        this.add.text(GAME_WIDTH / 2, 50, 'WARFIRE', {
            fontSize: '64px',
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#FFD23F',
            alpha: 0.3
        }).setOrigin(0.5).setScale(1.1);

        this.add.text(GAME_WIDTH / 2, 100, 'Turn-Based Strategy', {
            fontSize: '20px',
            fontFamily: 'Courier New, monospace',
            color: '#94a3b8'
        }).setOrigin(0.5);
    }

    createMapSizeSection() {
        const startY = 140;
        const centerX = GAME_WIDTH / 2;

        this.add.text(centerX, startY, 'MAP SIZE', {
            fontSize: '18px',
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#60a5fa'
        }).setOrigin(0.5);

        const sizes = [
            { label: 'Tiny (5x5)', width: 5, height: 5 },
            { label: 'Small (15x12)', width: 15, height: 12 },
            { label: 'Medium (20x15)', width: 20, height: 15 },
            { label: 'Large (30x22)', width: 30, height: 22 },
            { label: 'Huge (40x30)', width: 40, height: 30 },
            { label: 'Giant (50x40)', width: 50, height: 40 }
        ];

        let selectedIndex = 2; // Medium by default

        // Layout in 3 columns for nice 3x2 grid
        const container = this.add.container(centerX, startY + 35);

        this.mapSizeButtons = sizes.map((size, index) => {
            const col = index % 3;
            const row = Math.floor(index / 3);
            const x = (col - 1) * 175; // -175, 0, 175
            const y = row * 32;

            const button = this.createButton(x, y, size.label, 160, () => {
                this.settings.mapWidth = size.width;
                this.settings.mapHeight = size.height;
                this.updateMapSizeSelection(index);
            });
            container.add(button.container);
            return { ...button, index, size };
        });

        this.updateMapSizeSelection(selectedIndex);
    }

    updateMapSizeSelection(selectedIndex) {
        this.mapSizeButtons.forEach((btn, idx) => {
            const isSelected = idx === selectedIndex;
            btn.background.setFillStyle(isSelected ? 0x3B5DC9 : 0x2d3748);
            btn.text.setColor(isSelected ? '#ffffff' : '#94a3b8');
        });
    }

    createPlayerCountSection() {
        const startY = 260;
        const centerX = GAME_WIDTH / 2;

        this.add.text(centerX, startY, 'NUMBER OF PLAYERS', {
            fontSize: '18px',
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#60a5fa'
        }).setOrigin(0.5);

        const container = this.add.container(centerX, startY + 40);

        this.playerCountButtons = [2, 3, 4].map((count, index) => {
            const button = this.createButton((index - 1) * 70, 0, count.toString(), 60, () => {
                this.settings.numPlayers = count;
                this.updatePlayerCountSelection(count);
                this.updatePlayerSettingsVisibility();
            });
            container.add(button.container);
            return { ...button, count };
        });

        this.updatePlayerCountSelection(2);
    }

    updatePlayerCountSelection(selectedCount) {
        this.playerCountButtons.forEach(btn => {
            const isSelected = btn.count === selectedCount;
            btn.background.setFillStyle(isSelected ? 0x3B5DC9 : 0x2d3748);
            btn.text.setColor(isSelected ? '#ffffff' : '#94a3b8');
        });
    }

    createPlayerSettingsSection() {
        const startY = 330;
        const centerX = GAME_WIDTH / 2;

        this.add.text(centerX, startY, 'PLAYER SETTINGS', {
            fontSize: '18px',
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#60a5fa'
        }).setOrigin(0.5);

        this.playerSettingsContainer = this.add.container(centerX, startY + 50);
        this.playerSettingItems = [];

        for (let i = 0; i < 4; i++) {
            const item = this.createPlayerSettingItem(0, i * 50, i);
            this.playerSettingsContainer.add(item.container);
            this.playerSettingItems.push(item);
        }

        this.updatePlayerSettingsVisibility();
    }

    createPlayerSettingItem(x, y, playerIndex) {
        const container = this.add.container(x, y);
        const color = COLORS.players[playerIndex];
        const hexColor = '#' + color.toString(16).padStart(6, '0');

        // Color indicator
        const colorBox = this.add.rectangle(-120, 0, 24, 24, color)
            .setStrokeStyle(2, 0xffffff);
        container.add(colorBox);

        // Player label
        const label = this.add.text(-95, 0, `P${playerIndex + 1}:`, {
            fontSize: '16px',
            fontFamily: 'Courier New, monospace',
            color: hexColor
        }).setOrigin(0, 0.5);
        container.add(label);

        // AI toggle button
        const aiButtonBg = this.add.rectangle(60, 0, 100, 30, 0x2d3748)
            .setInteractive({ useHandCursor: true });
        const aiButtonText = this.add.text(60, 0, 'AI', {
            fontSize: '14px',
            fontFamily: 'Courier New, monospace',
            color: '#94a3b8'
        }).setOrigin(0.5);
        container.add(aiButtonBg);
        container.add(aiButtonText);

        aiButtonBg.on('pointerdown', () => {
            this.settings.players[playerIndex].isAI = !this.settings.players[playerIndex].isAI;
            this.updatePlayerSettingItem(playerIndex);
        });

        aiButtonBg.on('pointerover', () => {
            if (!this.settings.players[playerIndex].isAI) {
                aiButtonBg.setFillStyle(0x4a5568);
            }
        });

        aiButtonBg.on('pointerout', () => {
            this.updatePlayerSettingItem(playerIndex);
        });

        return {
            container,
            aiButtonBg,
            aiButtonText,
            playerIndex
        };
    }

    updatePlayerSettingItem(playerIndex) {
        const item = this.playerSettingItems[playerIndex];
        const isAI = this.settings.players[playerIndex].isAI;

        item.aiButtonBg.setFillStyle(isAI ? 0xEF476F : 0x06D6A0);
        item.aiButtonText.setText(isAI ? 'AI BOT' : 'HUMAN');
        item.aiButtonText.setColor('#ffffff');
    }

    updatePlayerSettingsVisibility() {
        this.playerSettingItems.forEach((item, index) => {
            const isVisible = index < this.settings.numPlayers;
            item.container.setVisible(isVisible);
            item.container.setAlpha(isVisible ? 1 : 0);
            if (isVisible) {
                this.updatePlayerSettingItem(index);
            }
        });

        // Ensure at least one human player
        let hasHuman = false;
        for (let i = 0; i < this.settings.numPlayers; i++) {
            if (!this.settings.players[i].isAI) {
                hasHuman = true;
                break;
            }
        }
        if (!hasHuman) {
            this.settings.players[0].isAI = false;
            this.updatePlayerSettingItem(0);
        }
    }

    createStartButton() {
        const button = this.createButton(GAME_WIDTH / 2, GAME_HEIGHT - 80, 'START GAME', 200, () => {
            this.startGame();
        });

        // Pulse animation
        this.tweens.add({
            targets: button.container,
            scaleX: 1.05,
            scaleY: 1.05,
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    createButton(x, y, text, width, callback) {
        const container = this.add.container(x, y);

        const background = this.add.rectangle(0, 0, width, 32, 0x2d3748)
            .setInteractive({ useHandCursor: true });

        const textObj = this.add.text(0, 0, text, {
            fontSize: '14px',
            fontFamily: 'Courier New, monospace',
            color: '#94a3b8'
        }).setOrigin(0.5);

        container.add(background);
        container.add(textObj);

        background.on('pointerdown', callback);
        background.on('pointerover', () => {
            background.setFillStyle(0x4a5568);
            textObj.setColor('#ffffff');
        });
        background.on('pointerout', () => {
            background.setFillStyle(0x2d3748);
            textObj.setColor('#94a3b8');
        });

        return { container, background, text: textObj };
    }

    createHelpText() {
        this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 25, 'Click AI/HUMAN buttons to toggle player type', {
            fontSize: '12px',
            fontFamily: 'Courier New, monospace',
            color: '#64748b'
        }).setOrigin(0.5);
    }

    startGame() {
        // Filter only active players
        const activePlayers = this.settings.players.slice(0, this.settings.numPlayers);

        // Pass settings to game scene
        this.scene.start('GameScene', {
            mapWidth: this.settings.mapWidth,
            mapHeight: this.settings.mapHeight,
            players: activePlayers
        });
    }
}
