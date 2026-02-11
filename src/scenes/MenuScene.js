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
        this.isMobile = CONFIG.IS_MOBILE;
    }

    create() {
        this.createBackground();
        this.createTitle();
        this.createMapSizeSection();
        this.createCityRuinSection();
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
        const titleSize = this.isMobile ? '36px' : '64px';
        const subtitleSize = this.isMobile ? '14px' : '20px';
        const titleY = this.isMobile ? 25 : 50;
        const subtitleY = this.isMobile ? 55 : 100;

        // Glow effect (behind)
        const glow = this.add.text(GAME_WIDTH / 2, titleY, 'WARFIRE', {
            fontSize: titleSize,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#FFD23F'
        }).setOrigin(0.5);
        glow.setAlpha(0.3);
        glow.setScale(this.isMobile ? 1.05 : 1.1);

        // Main title
        this.add.text(GAME_WIDTH / 2, titleY, 'WARFIRE', {
            fontSize: titleSize,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#FFD23F'
        }).setOrigin(0.5);

        // Subtitle
        this.add.text(GAME_WIDTH / 2, subtitleY, 'Turn-Based Strategy', {
            fontSize: subtitleSize,
            fontFamily: 'Courier New, monospace',
            color: '#94a3b8'
        }).setOrigin(0.5);
    }

    createMapSizeSection() {
        const startY = this.isMobile ? 75 : 140;
        const centerX = GAME_WIDTH / 2;
        const titleSize = this.isMobile ? '14px' : '18px';
        const btnWidth = this.isMobile ? 100 : 160;
        const btnSpacing = this.isMobile ? 105 : 175;
        const rowHeight = this.isMobile ? 28 : 32;

        this.add.text(centerX, startY, 'MAP SIZE', {
            fontSize: titleSize,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#60a5fa'
        }).setOrigin(0.5);

        const sizes = [
            { label: this.isMobile ? 'Tiny' : 'Tiny (5x5)', width: 5, height: 5 },
            { label: this.isMobile ? 'Small' : 'Small (15x12)', width: 15, height: 12 },
            { label: this.isMobile ? 'Medium' : 'Medium (20x15)', width: 20, height: 15 },
            { label: this.isMobile ? 'Large' : 'Large (30x22)', width: 30, height: 22 },
            { label: this.isMobile ? 'Huge' : 'Huge (40x30)', width: 40, height: 30 },
            { label: this.isMobile ? 'Giant' : 'Giant (50x40)', width: 50, height: 40 }
        ];

        // Calculate defaults based on map size
        const calculateDefaults = (width, height) => {
            const area = width * height;
            const baseArea = 20 * 15; // Medium map area
            const ratio = area / baseArea;
            // Increased counts for sector-based distribution
            return {
                numCities: Math.max(4, Math.floor(10 * ratio)),
                numRuins: Math.max(4, Math.floor(10 * ratio))
            };
        };

        // Layout in 3 columns for nice 3x2 grid
        const containerY = startY + (this.isMobile ? 22 : 35);
        const container = this.add.container(centerX, containerY);

        this.mapSizeButtons = sizes.map((size, index) => {
            const col = index % 3;
            const row = Math.floor(index / 3);
            const x = (col - 1) * btnSpacing;
            const y = row * rowHeight;

            const button = this.createSelectableButton(x, y, size.label, btnWidth, () => {
                this.settings.mapWidth = size.width;
                this.settings.mapHeight = size.height;
                // Update city/ruin defaults when map size changes
                const defaults = calculateDefaults(size.width, size.height);
                this.settings.numCities = defaults.numCities;
                this.settings.numRuins = defaults.numRuins;
                this.updateMapSizeSelection(index);
                this.updateCityRuinDisplay();
            });
            container.add(button.container);
            return { ...button, index, size };
        });

        // Initialize with defaults for medium map
        const initialDefaults = calculateDefaults(20, 15);
        this.settings.numCities = initialDefaults.numCities;
        this.settings.numRuins = initialDefaults.numRuins;
        this.selectedMapIndex = 2; // Medium by default
        this.updateMapSizeSelection(this.selectedMapIndex);
    }

    updateMapSizeSelection(selectedIndex) {
        this.selectedMapIndex = selectedIndex;
        this.mapSizeButtons.forEach((btn, idx) => {
            const isSelected = idx === selectedIndex;
            btn.setSelected(isSelected);
        });
    }

    createCityRuinSection() {
        const startY = this.isMobile ? 145 : 240;
        const centerX = GAME_WIDTH / 2;
        const titleSize = this.isMobile ? '14px' : '18px';

        this.add.text(centerX, startY, this.isMobile ? 'CITIES & RUINS' : 'NEUTRAL CITIES & RUINS', {
            fontSize: titleSize,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#60a5fa'
        }).setOrigin(0.5);

        // Calculate max values based on current map size
        const getMaxValues = () => {
            const mapArea = this.settings.mapWidth * this.settings.mapHeight;
            const maxCities = Math.floor(mapArea / 15); // At least 15 tiles per city
            const maxRuins = Math.floor(mapArea / 20); // At least 20 tiles per ruin
            return { maxCities, maxRuins };
        };

        const containerY = startY + (this.isMobile ? 25 : 40);
        const container = this.add.container(centerX, containerY);

        // Cities control
        const citiesLabel = this.add.text(-80, 0, 'Cities:', {
            fontSize: this.isMobile ? '12px' : '14px',
            fontFamily: 'Courier New, monospace',
            color: '#94a3b8'
        }).setOrigin(0, 0.5);
        container.add(citiesLabel);

        // Cities value display (clickable)
        this.citiesValueBg = this.add.rectangle(-10, 0, 50, 28, 0x2d3748)
            .setInteractive({ useHandCursor: true });
        this.citiesValueText = this.add.text(-10, 0, this.settings.numCities.toString(), {
            fontSize: this.isMobile ? '14px' : '16px',
            fontFamily: 'Courier New, monospace',
            color: '#ffffff'
        }).setOrigin(0.5);
        container.add(this.citiesValueBg);
        container.add(this.citiesValueText);

        // Cities - button
        const citiesMinusBtn = this.createSmallButton(-45, 0, '-', () => {
            if (this.settings.numCities > 0) {
                this.settings.numCities--;
                this.updateCityRuinDisplay();
            }
        });
        container.add(citiesMinusBtn.container);

        // Cities + button
        const citiesPlusBtn = this.createSmallButton(25, 0, '+', () => {
            const { maxCities } = getMaxValues();
            if (this.settings.numCities < maxCities) {
                this.settings.numCities++;
                this.updateCityRuinDisplay();
            }
        });
        container.add(citiesPlusBtn.container);

        // Ruins control
        const ruinsLabel = this.add.text(60, 0, 'Ruins:', {
            fontSize: this.isMobile ? '12px' : '14px',
            fontFamily: 'Courier New, monospace',
            color: '#94a3b8'
        }).setOrigin(0, 0.5);
        container.add(ruinsLabel);

        // Ruins value display
        this.ruinsValueBg = this.add.rectangle(130, 0, 50, 28, 0x2d3748)
            .setInteractive({ useHandCursor: true });
        this.ruinsValueText = this.add.text(130, 0, this.settings.numRuins.toString(), {
            fontSize: this.isMobile ? '14px' : '16px',
            fontFamily: 'Courier New, monospace',
            color: '#ffffff'
        }).setOrigin(0.5);
        container.add(this.ruinsValueBg);
        container.add(this.ruinsValueText);

        // Ruins - button
        const ruinsMinusBtn = this.createSmallButton(95, 0, '-', () => {
            if (this.settings.numRuins > 0) {
                this.settings.numRuins--;
                this.updateCityRuinDisplay();
            }
        });
        container.add(ruinsMinusBtn.container);

        // Ruins + button
        const ruinsPlusBtn = this.createSmallButton(165, 0, '+', () => {
            const { maxRuins } = getMaxValues();
            if (this.settings.numRuins < maxRuins) {
                this.settings.numRuins++;
                this.updateCityRuinDisplay();
            }
        });
        container.add(ruinsPlusBtn.container);
    }

    createSmallButton(x, y, text, callback) {
        const container = this.add.container(x, y);
        const size = 26;
        const fontSize = this.isMobile ? '14px' : '16px';

        const background = this.add.rectangle(0, 0, size, size, 0x4a5568)
            .setInteractive({ useHandCursor: true });

        const textObj = this.add.text(0, 0, text, {
            fontSize: fontSize,
            fontFamily: 'Courier New, monospace',
            color: '#ffffff',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        container.add(background);
        container.add(textObj);

        background.on('pointerdown', callback);
        background.on('pointerover', () => {
            background.setFillStyle(0x6b7280);
        });
        background.on('pointerout', () => {
            background.setFillStyle(0x4a5568);
        });

        return { container, background, text: textObj };
    }

    updateCityRuinDisplay() {
        this.citiesValueText.setText(this.settings.numCities.toString());
        this.ruinsValueText.setText(this.settings.numRuins.toString());
    }

    createPlayerCountSection() {
        const startY = this.isMobile ? 195 : 320;
        const centerX = GAME_WIDTH / 2;
        const titleSize = this.isMobile ? '14px' : '18px';

        this.add.text(centerX, startY, this.isMobile ? 'PLAYERS' : 'NUMBER OF PLAYERS', {
            fontSize: titleSize,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#60a5fa'
        }).setOrigin(0.5);

        const container = this.add.container(centerX, startY + (this.isMobile ? 22 : 40));

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
        const startY = this.isMobile ? 240 : 390;
        const centerX = GAME_WIDTH / 2;
        const titleSize = this.isMobile ? '14px' : '18px';

        this.add.text(centerX, startY, 'PLAYER SETTINGS', {
            fontSize: titleSize,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            color: '#60a5fa'
        }).setOrigin(0.5);

        const containerY = startY + (this.isMobile ? 22 : 50);
        this.playerSettingsContainer = this.add.container(centerX, containerY);
        this.playerSettingItems = [];

        const rowHeight = this.isMobile ? 32 : 50;
        for (let i = 0; i < 4; i++) {
            const item = this.createPlayerSettingItem(0, i * rowHeight, i);
            this.playerSettingsContainer.add(item.container);
            this.playerSettingItems.push(item);
        }

        this.updatePlayerSettingsVisibility();
    }

    createPlayerSettingItem(x, y, playerIndex) {
        const container = this.add.container(x, y);
        const color = COLORS.players[playerIndex];
        const hexColor = '#' + color.toString(16).padStart(6, '0');

        const boxSize = this.isMobile ? 16 : 24;
        const labelSize = this.isMobile ? '12px' : '16px';
        const btnWidth = this.isMobile ? 70 : 100;
        const btnHeight = this.isMobile ? 22 : 30;
        const btnTextSize = this.isMobile ? '11px' : '14px';
        const colorBoxX = this.isMobile ? -80 : -120;
        const labelX = this.isMobile ? -65 : -95;
        const btnX = this.isMobile ? 40 : 60;

        // Color indicator
        const colorBox = this.add.rectangle(colorBoxX, 0, boxSize, boxSize, color)
            .setStrokeStyle(2, 0xffffff);
        container.add(colorBox);

        // Player label
        const label = this.add.text(labelX, 0, `P${playerIndex + 1}:`, {
            fontSize: labelSize,
            fontFamily: 'Courier New, monospace',
            color: hexColor
        }).setOrigin(0, 0.5);
        container.add(label);

        // AI toggle button
        const aiButtonBg = this.add.rectangle(btnX, 0, btnWidth, btnHeight, 0x2d3748)
            .setInteractive({ useHandCursor: true });
        const aiButtonText = this.add.text(btnX, 0, 'AI', {
            fontSize: btnTextSize,
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
        const btnY = this.isMobile ? GAME_HEIGHT - 25 : GAME_HEIGHT - 70;
        const btnWidth = this.isMobile ? 140 : 200;
        const btnText = this.isMobile ? 'START' : 'START GAME';
        const button = this.createButton(GAME_WIDTH / 2, btnY, btnText, btnWidth, () => {
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
        const btnHeight = this.isMobile ? 26 : 32;
        const fontSize = this.isMobile ? '12px' : '14px';

        const background = this.add.rectangle(0, 0, width, btnHeight, 0x2d3748)
            .setInteractive({ useHandCursor: true });

        const textObj = this.add.text(0, 0, text, {
            fontSize: fontSize,
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

    createSelectableButton(x, y, text, width, callback) {
        const container = this.add.container(x, y);
        const btnHeight = this.isMobile ? 26 : 32;
        const fontSize = this.isMobile ? '12px' : '14px';

        const background = this.add.rectangle(0, 0, width, btnHeight, 0x2d3748)
            .setInteractive({ useHandCursor: true });

        const textObj = this.add.text(0, 0, text, {
            fontSize: fontSize,
            fontFamily: 'Courier New, monospace',
            color: '#94a3b8'
        }).setOrigin(0.5);

        container.add(background);
        container.add(textObj);

        let isSelected = false;

        const updateVisuals = () => {
            if (isSelected) {
                background.setFillStyle(0x3B5DC9);
                textObj.setColor('#ffffff');
            } else {
                background.setFillStyle(0x2d3748);
                textObj.setColor('#94a3b8');
            }
        };

        background.on('pointerdown', callback);
        background.on('pointerover', () => {
            if (!isSelected) {
                background.setFillStyle(0x4a5568);
                textObj.setColor('#ffffff');
            }
        });
        background.on('pointerout', () => {
            updateVisuals();
        });

        return {
            container,
            background,
            text: textObj,
            setSelected: (selected) => {
                isSelected = selected;
                updateVisuals();
            }
        };
    }

    createHelpText() {
        if (this.isMobile) {
            // No help text on mobile to save space
            return;
        }
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
            numCities: this.settings.numCities,
            numRuins: this.settings.numRuins,
            players: activePlayers
        });
    }
}
