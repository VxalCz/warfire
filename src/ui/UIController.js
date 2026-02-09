import { CONFIG, GAME_WIDTH, GAME_HEIGHT, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, COLORS, TERRAIN_NAMES, TERRAIN_DEFENSE } from '../constants.js';
import { Events } from '../utils.js';

export class UIController {
    constructor(scene, x, y, width, height) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.elements = {};
        this.panels = {};
    }

    initialize() {
        // Background with decorative border
        const bg = this.scene.add.graphics();
        // Main panel background
        bg.fillStyle(COLORS.uiBg, 1);
        bg.fillRect(this.x, this.y, this.width, this.height);
        // Outer border
        bg.lineStyle(4, COLORS.uiBorder, 1);
        bg.strokeRect(this.x, this.y, this.width, this.height);
        // Inner decorative line
        bg.lineStyle(2, 0x2D5A8B, 1);
        bg.strokeRect(this.x + 4, this.y + 4, this.width - 8, this.height - 8);
        // Corner decorations
        const cornerSize = 16;
        bg.fillStyle(0xFFD700, 1);
        // Top left
        bg.fillTriangle(this.x, this.y, this.x + cornerSize, this.y, this.x, this.y + cornerSize);
        // Top right
        bg.fillTriangle(this.x + this.width, this.y, this.x + this.width - cornerSize, this.y, this.x + this.width, this.y + cornerSize);
        // Bottom left
        bg.fillTriangle(this.x, this.y + this.height, this.x + cornerSize, this.y + this.height, this.x, this.y + this.height - cornerSize);
        // Bottom right
        bg.fillTriangle(this.x + this.width, this.y + this.height, this.x + this.width - cornerSize, this.y + this.height, this.x + this.width, this.y + this.height - cornerSize);

        // Header with title
        bg.fillStyle(0x1A2F4A, 1);
        bg.fillRect(this.x + 8, this.y + 8, this.width - 16, 30);
        bg.lineStyle(2, 0xFFD700, 0.5);
        bg.strokeRect(this.x + 8, this.y + 8, this.width - 16, 30);

        // Player info with icons (using text instead of emojis for compatibility)
        this.elements.playerText = this.createText(15, 45, 'Player 1', { fontSize: '16px', color: '#FFFFFF' });
        this.elements.goldText = this.createText(35, 75, '50g', { fontSize: '14px', color: '#FFD700' });
        this.elements.turnText = this.createText(35, 105, 'Turn 1', { fontSize: '12px', color: '#AAAAAA' });

        // Icons for gold and turn (text-based)
        const goldIcon = this.scene.add.text(this.x + 15, this.y + 75, '$', { fontSize: '14px', color: '#FFD700', fontFamily: 'Press Start 2P' });
        const turnIcon = this.scene.add.text(this.x + 15, this.y + 105, 'T', { fontSize: '12px', color: '#AAAAAA', fontFamily: 'Press Start 2P' });

        // Panel sections with decorative headers
        this.panels.selectedHeader = this.createPanelHeader(10, 130, 'Selected Unit');
        this.elements.selectedInfo = this.createText(15, 155, 'None', { fontSize: '10px', lineSpacing: 5 });

        this.panels.stackHeader = this.createPanelHeader(10, 240, 'Stack');
        this.elements.stackInfo = this.createText(15, 265, '', { fontSize: '9px', lineSpacing: 3 });

        this.panels.tileHeader = this.createPanelHeader(10, 320, 'Tile Info');
        this.elements.tileInfo = this.createText(15, 345, '', { fontSize: '10px', lineSpacing: 4 });

        // Action buttons
        this.elements.endTurnBtn = this.createEnhancedButton(50, this.height - 150, 200, 50, 'END TURN', 0xFFD700, 0xFFAA00);
        this.elements.saveBtn = this.createEnhancedButton(50, this.height - 90, 95, 40, 'SAVE', 0x4CAF50, 0x388E3C);
        this.elements.loadBtn = this.createEnhancedButton(155, this.height - 90, 95, 40, 'LOAD', 0x2196F3, 0x1976D2);

        // Minimap panel - positioned above production panel
        this.panels.minimap = this.scene.add.container(this.x + 10, 390);
        this.minimapScale = 3; // 3px per tile for better visibility

        // Production panel (hidden by default) - positioned below minimap, above buttons
        this.panels.production = this.scene.add.container(this.x + 10, 520);
        this.panels.production.setVisible(false);

        // Event listeners
        this.elements.endTurnBtn.on('pointerup', () => Events.emit('ui:endTurn'));
        this.elements.saveBtn.on('pointerup', () => Events.emit('ui:save'));
        this.elements.loadBtn.on('pointerup', () => Events.emit('ui:load'));
    }

    /**
     * Create a decorative panel header
     */
    createPanelHeader(x, y, text) {
        const container = this.scene.add.container(this.x + x, this.y + y);

        const g = this.scene.add.graphics();
        // Header background
        g.fillStyle(0x1A3A5A, 0.8);
        g.fillRect(0, 0, this.width - 20, 22);
        // Header border
        g.lineStyle(2, 0x3A6A9A, 1);
        g.strokeRect(0, 0, this.width - 20, 22);

        // Text
        const label = this.scene.add.text(8, 5, text, {
            fontFamily: 'Press Start 2P',
            fontSize: '10px',
            color: '#CCCCCC'
        });

        container.add([g, label]);
        return container;
    }

    createText(x, y, text, style) {
        return this.scene.add.text(this.x + x, this.y + y, text, {
            fontFamily: 'Press Start 2P',
            ...style
        });
    }

    createButton(x, y, w, h, text, color) {
        const container = this.scene.add.container(this.x + x, this.y + y);

        const bg = this.scene.add.graphics();
        bg.fillStyle(color, 1);
        bg.fillRect(0, 0, w, h);
        bg.lineStyle(3, 0xFFFFFF, 1);
        bg.strokeRect(0, 0, w, h);
        bg.fillStyle(0x000000, 0.3);
        bg.fillRect(4, h - 4, w - 4, 4);
        bg.fillRect(w - 4, 4, 4, h - 4);

        const label = this.scene.add.text(w / 2, h / 2, text, {
            fontFamily: 'Press Start 2P',
            fontSize: '14px',
            color: '#000000'
        }).setOrigin(0.5, 0.5);

        container.add([bg, label]);
        container.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);

        container.on('pointerdown', () => container.setPosition(this.x + x + 2, this.y + y + 2));
        container.on('pointerup', () => container.setPosition(this.x + x, this.y + y));

        return container;
    }

    /**
     * Create enhanced 3D button with hover effects
     */
    createEnhancedButton(x, y, w, h, text, baseColor, shadowColor) {
        const container = this.scene.add.container(this.x + x, this.y + y);
        const originalY = this.y + y;

        // Shadow layer (offset)
        const shadow = this.scene.add.graphics();
        shadow.fillStyle(shadowColor, 1);
        shadow.fillRect(3, 3, w, h);
        shadow.fillStyle(0x000000, 0.2);
        shadow.fillRect(3, 3, w, h);

        // Main button layer
        const bg = this.scene.add.graphics();
        // Gradient effect with multiple layers
        bg.fillStyle(baseColor, 1);
        bg.fillRect(0, 0, w, h);
        // Highlight on top
        bg.fillStyle(0xFFFFFF, 0.2);
        bg.fillRect(0, 0, w, h / 2);
        // Border
        bg.lineStyle(2, 0xFFFFFF, 0.8);
        bg.strokeRect(0, 0, w, h);
        // Inner highlight
        bg.lineStyle(1, 0xFFFFFF, 0.4);
        bg.strokeRect(2, 2, w - 4, h - 4);

        const label = this.scene.add.text(w / 2, h / 2, text, {
            fontFamily: 'Press Start 2P',
            fontSize: '12px',
            color: '#000000'
        }).setOrigin(0.5, 0.5);

        container.add([shadow, bg, label]);
        container.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);

        // Enhanced press effect
        container.on('pointerdown', () => {
            container.setPosition(this.x + x + 2, originalY + 2);
            shadow.setVisible(false);
        });

        container.on('pointerup', () => {
            container.setPosition(this.x + x, originalY);
            shadow.setVisible(true);
        });

        container.on('pointerout', () => {
            container.setPosition(this.x + x, originalY);
            shadow.setVisible(true);
        });

        // Hover effect
        container.on('pointerover', () => {
            bg.clear();
            // Brighter on hover
            const hoverColor = Phaser.Display.Color.IntegerToColor(baseColor);
            hoverColor.brighten(20);
            bg.fillStyle(hoverColor.color, 1);
            bg.fillRect(0, 0, w, h);
            bg.fillStyle(0xFFFFFF, 0.3);
            bg.fillRect(0, 0, w, h / 2);
            bg.lineStyle(2, 0xFFFFFF, 1);
            bg.strokeRect(0, 0, w, h);
        });

        container.on('pointerout', () => {
            bg.clear();
            bg.fillStyle(baseColor, 1);
            bg.fillRect(0, 0, w, h);
            bg.fillStyle(0xFFFFFF, 0.2);
            bg.fillRect(0, 0, w, h / 2);
            bg.lineStyle(2, 0xFFFFFF, 0.8);
            bg.strokeRect(0, 0, w, h);
        });

        return container;
    }

    updatePlayer(player, turn) {
        const aiIndicator = player.isAI ? ' [AI]' : '';
        this.elements.playerText.setText(player.name + aiIndicator);
        this.elements.playerText.setColor('#' + player.color.toString(16).padStart(6, '0'));
        this.elements.goldText.setText(`Gold: ${player.gold}`);
        this.elements.turnText.setText(`Turn: ${turn}`);
    }

    updateSelected(unit, stack) {
        if (!unit) {
            this.elements.selectedInfo.setText('None');
            this.elements.stackInfo.setText('');
            return;
        }

        const artifactNames = unit.artifacts.map(a => a.name).join(', ') || 'None';
        let status;
        if (unit.hasAttacked) {
            status = '[ATTACKED]';
        } else if (unit.hasMoved) {
            status = '[MOVED]';
        } else {
            status = '[READY]';
        }

        this.elements.selectedInfo.setText(
            `${unit.name} ${status}\n` +
            `HP: ${unit.hp}/${unit.maxHp}\n` +
            `ATK: ${unit.effectiveAttack} DEF: ${unit.effectiveDefense}\n` +
            `MOV: ${unit.effectiveMovement} RNG: ${unit.range}\n` +
            `Artifacts: ${artifactNames}`
        );

        if (stack && stack.units.length > 1) {
            let text = `${stack.units.length} units:\n`;
            stack.units.forEach(u => {
                const moved = u.hasMoved ? 'M' : '.';
                const attacked = u.hasAttacked ? 'A' : '.';
                text += `${u.name} HP:${u.hp} [${moved}${attacked}]\n`;
            });
            this.elements.stackInfo.setText(text);
        } else {
            this.elements.stackInfo.setText('');
        }
    }

    updateTileInfo(x, y, map) {
        if (!map.isValid(x, y)) {
            this.elements.tileInfo.setText('');
            return;
        }

        const terrain = map.getTerrain(x, y);
        const terrainName = TERRAIN_NAMES[terrain];
        const defenseBonus = TERRAIN_DEFENSE[terrain];

        const city = map.getCity(x, y);
        const ruin = map.getRuin(x, y);

        let text = `${terrainName}`;
        if (defenseBonus > 0) {
            text += ` (DEF +${defenseBonus})`;
        }

        if (city) {
            text += `\nCity: ${city.size}`;
            if (city.owner !== null) {
                text += ` (P${city.owner + 1})`;
            } else {
                text += ` (Neutral)`;
            }
            text += `\nIncome: +${city.income}g`;
        }

        if (ruin && !ruin.explored) {
            text += `\nRuin (unexplored)`;
        }

        this.elements.tileInfo.setText(text);
    }

    clearTileInfo() {
        this.elements.tileInfo.setText('');
    }

    showProduction(city, player) {
        this.panels.production.removeAll(true);
        this.panels.production.setVisible(true);

        const title = this.scene.add.text(0, 0, 'PRODUCTION:', {
            fontFamily: 'Press Start 2P', fontSize: '12px', color: '#FFFFFF'
        });
        this.panels.production.add(title);

        const options = city.getProductionOptions();
        options.forEach((opt, idx) => {
            const y = 30 + idx * 45;
            const canAfford = player.gold >= opt.cost;
            const btn = this.createProductionButton(0, y, 280, 40, opt, canAfford);
            this.panels.production.add(btn.container);

            if (canAfford) {
                btn.container.on('pointerup', () => {
                    Events.emit('ui:produce', { city, unitType: opt.type });
                    this.hideProduction();
                });
            }
        });
    }

    createProductionButton(x, y, w, h, opt, canAfford) {
        const container = this.scene.add.container(x, y);
        const color = canAfford ? 0x4CAF50 : 0x666666;

        const bg = this.scene.add.graphics();
        bg.fillStyle(color, 1);
        bg.fillRect(0, 0, w, h);
        bg.lineStyle(2, 0xFFFFFF, 1);
        bg.strokeRect(0, 0, w, h);

        const label = this.scene.add.text(w / 2, h / 2, `${opt.name} - ${opt.cost}g`, {
            fontFamily: 'Press Start 2P', fontSize: '10px', color: '#FFFFFF'
        }).setOrigin(0.5, 0.5);

        container.add([bg, label]);
        container.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);

        return { container, bg, label };
    }

    hideProduction() {
        this.panels.production.setVisible(false);
    }

    showMessage(text, duration = 2000) {
        const msg = this.scene.add.text(
            GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, text,
            { fontFamily: 'Press Start 2P', fontSize: '16px', color: '#FFD700', backgroundColor: '#000000' }
        ).setOrigin(0.5, 0.5).setDepth(1000);

        this.scene.tweens.add({
            targets: msg, alpha: 0, duration,
            onComplete: () => msg.destroy()
        });
    }

    showGameOver(winner) {
        const overlay = this.scene.add.graphics();
        overlay.fillStyle(0x000000, 0.8);
        overlay.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        overlay.setDepth(2000);

        const text = this.scene.add.text(
            GAME_WIDTH / 2, GAME_HEIGHT / 2,
            `${winner.name} WINS!`,
            { fontFamily: 'Press Start 2P', fontSize: '32px', color: '#FFD700' }
        ).setOrigin(0.5, 0.5).setDepth(2001);

        const sub = this.scene.add.text(
            GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60,
            'Press F5 to restart',
            { fontFamily: 'Press Start 2P', fontSize: '14px', color: '#FFFFFF' }
        ).setOrigin(0.5, 0.5).setDepth(2001);
    }

    /**
     * Update minimap with current game state
     * @param {GameMap} map
     * @param {Player[]} players
     * @param {number} cameraX
     * @param {number} cameraY
     */
    updateMinimap(map, players, cameraX, cameraY) {
        this.panels.minimap.removeAll(true);

        const miniW = map.width * this.minimapScale;
        const miniH = map.height * this.minimapScale;

        // Background with border
        const bg = this.scene.add.graphics();
        bg.fillStyle(0x1a1a2e, 1);
        bg.fillRect(0, 0, miniW + 4, miniH + 4);
        bg.lineStyle(2, 0x3A6A9A, 1);
        bg.strokeRect(0, 0, miniW + 4, miniH + 4);
        bg.setPosition(-2, -2);
        this.panels.minimap.add(bg);

        // Terrain - enhanced colors
        const terrainColors = [0x8FD45A, 0x228B22, 0xB8C4D0, 0x5BA3D0];
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                const terrain = map.getTerrain(x, y);
                const pixel = this.scene.add.rectangle(
                    x * this.minimapScale,
                    y * this.minimapScale,
                    this.minimapScale,
                    this.minimapScale,
                    terrainColors[terrain]
                );
                pixel.setOrigin(0, 0);
                this.panels.minimap.add(pixel);
            }
        }

        // Cities with different sizes
        map.cities.forEach(city => {
            const color = city.owner !== null ? COLORS.players[city.owner] : 0x808080;
            const citySize = city.size === 'large' ? 4 : city.size === 'medium' ? 3 : 2;
            const dot = this.scene.add.rectangle(
                city.x * this.minimapScale + this.minimapScale / 2,
                city.y * this.minimapScale + this.minimapScale / 2,
                citySize * 2,
                citySize * 2,
                color
            );
            this.panels.minimap.add(dot);
        });

        // Ruins
        map.ruins.forEach(ruin => {
            if (!ruin.explored) {
                const dot = this.scene.add.rectangle(
                    ruin.x * this.minimapScale + 1,
                    ruin.y * this.minimapScale + 1,
                    2, 2,
                    0x8B4513
                );
                dot.setOrigin(0, 0);
                this.panels.minimap.add(dot);
            }
        });

        // Units (show only alive units)
        players.forEach(player => {
            if (!player.isAlive) return;
            player.units.forEach(unit => {
                if (unit.hp > 0) {
                    const dot = this.scene.add.rectangle(
                        unit.x * this.minimapScale,
                        unit.y * this.minimapScale,
                        this.minimapScale,
                        this.minimapScale,
                        COLORS.players[player.id]
                    );
                    dot.setOrigin(0, 0);
                    this.panels.minimap.add(dot);
                }
            });
        });

        // Viewport rectangle
        const viewX = (cameraX / CONFIG.TILE_SIZE) * this.minimapScale;
        const viewY = (cameraY / CONFIG.TILE_SIZE) * this.minimapScale;
        const viewW = (VIEWPORT_WIDTH / CONFIG.TILE_SIZE) * this.minimapScale;
        const viewH = (VIEWPORT_HEIGHT / CONFIG.TILE_SIZE) * this.minimapScale;

        const viewRect = this.scene.add.graphics();
        viewRect.lineStyle(2, 0xFFFFFF, 1);
        viewRect.strokeRect(viewX, viewY, viewW, viewH);
        viewRect.fillStyle(0xFFFFFF, 0.15);
        viewRect.fillRect(viewX, viewY, viewW, viewH);
        this.panels.minimap.add(viewRect);

        // Make minimap clickable to jump camera
        const clickArea = this.scene.add.rectangle(0, 0, miniW, miniH);
        clickArea.setOrigin(0, 0);
        clickArea.setInteractive();
        this.panels.minimap.add(clickArea);

        clickArea.on('pointerdown', (pointer) => {
            const localX = pointer.x - this.panels.minimap.x;
            const localY = pointer.y - this.panels.minimap.y;
            const tileX = Math.floor(localX / this.minimapScale);
            const tileY = Math.floor(localY / this.minimapScale);

            if (this.onMinimapClick) {
                this.onMinimapClick(tileX, tileY);
            }
        });
    }

    /**
     * Set callback for minimap clicks
     */
    setMinimapClickCallback(callback) {
        this.onMinimapClick = callback;
    }
}
