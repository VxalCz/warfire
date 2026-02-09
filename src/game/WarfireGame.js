import { CONFIG, GAME_WIDTH, GAME_HEIGHT, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, COLORS, TERRAIN, UNIT_DEFINITIONS } from '../constants.js';
import { Utils, Events } from '../utils.js';
import { Unit } from '../models/Unit.js';
import { City } from '../models/City.js';
import { Player } from '../models/Player.js';
import { GameMap } from '../systems/GameMap.js';
import { GameState } from '../systems/GameState.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { RenderSystem } from '../systems/RenderSystem.js';
import { AISystem } from '../systems/AISystem.js';
import { UIController } from '../ui/UIController.js';

export class WarfireGame {
    constructor(scene, gameConfig = null) {
        this.scene = scene;
        this.gameConfig = gameConfig;
        this.state = new GameState();
        this.map = null;
        this.players = [];
        this.renderer = new RenderSystem(scene);
        this.ui = null;
        this.ai = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        Events.on('ui:endTurn', () => this.endTurn());
        Events.on('ui:save', () => this.saveGame());
        Events.on('ui:load', () => this.loadGame());
        Events.on('ui:produce', ({ city, unitType }) => this.produceUnit(city, unitType));
        Events.on('player:defeated', ({ player }) => this.ui.showMessage(`${player.name} defeated!`));
        Events.on('city:captured', ({ city, newOwner }) => {
            const player = this.players[newOwner];
            this.ui.showMessage(`${player.name} captured city!`);
        });
    }

    initialize() {
        // Use config from menu or defaults
        const mapWidth = this.gameConfig?.mapWidth || CONFIG.MAP_WIDTH;
        const mapHeight = this.gameConfig?.mapHeight || CONFIG.MAP_HEIGHT;
        const playerConfigs = this.gameConfig?.players || [
            { name: 'Player 1', isAI: false },
            { name: 'Player 2', isAI: true }
        ];

        this.renderer.initialize();
        this.createTextures();

        this.map = new GameMap(mapWidth, mapHeight);
        this.createPlayers(playerConfigs);
        this.setupInitialPositions(mapWidth, mapHeight);
        this.setupNeutralCities(mapWidth, mapHeight);
        this.setupRuins(mapWidth, mapHeight);

        this.ui = new UIController(this.scene, VIEWPORT_WIDTH, 0, CONFIG.UI_WIDTH, VIEWPORT_HEIGHT);
        this.ui.initialize();

        // Setup minimap click handler
        this.ui.setMinimapClickCallback((x, y) => {
            this.renderer.centerOnTile(x, y);
            this.updateUI(); // Update minimap viewport
        });

        // Initialize AI system
        this.ai = new AISystem(this);

        this.renderer.renderMap(this.map);
        this.renderer.renderUnits(this.map.units);
        this.updateUI();

        this.setupInput();

        // Center camera on current player's hero or first city
        this.centerCameraOnPlayer(0);

        // Start AI turn if first player is AI
        this.checkAndStartAITurn();
    }

    /**
     * Center camera on a player's units
     */
    centerCameraOnPlayer(playerIndex) {
        const player = this.players[playerIndex];
        if (!player || !player.isAlive) return;

        // Try to find hero first
        const hero = player.getHero();
        if (hero) {
            this.renderer.centerOnTile(hero.x, hero.y);
            return;
        }

        // Otherwise center on first city
        if (player.cities.length > 0) {
            const city = player.cities[0];
            this.renderer.centerOnTile(city.x, city.y);
            return;
        }

        // Default to center of map
        this.renderer.centerOnTile(Math.floor(this.map.width / 2), Math.floor(this.map.height / 2));
    }

    createTextures() {
        const terrainCreators = {
            plains: (g) => {
                // Base grass color with subtle gradient
                g.fillStyle(COLORS.plains, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                // Add grass texture - varied green patches
                const grassColors = [0x6ABF40, 0x7EC850, 0x5AAD35, 0x8FD45A];
                for (let i = 0; i < 40; i++) {
                    const color = grassColors[Utils.randomInt(0, grassColors.length - 1)];
                    g.fillStyle(color, 0.6);
                    const x = Utils.randomInt(2, 60);
                    const y = Utils.randomInt(2, 60);
                    const size = Utils.randomInt(2, 5);
                    g.fillRect(x, y, size, size);
                }

                // Add small flowers/details
                for (let i = 0; i < 3; i++) {
                    g.fillStyle(0xFFD700, 0.8);
                    const x = Utils.randomInt(8, 56);
                    const y = Utils.randomInt(8, 56);
                    g.fillCircle(x, y, 2);
                }

                // Soft grid line
                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            },
            forest: (g) => {
                // Darker forest floor
                g.fillStyle(0x1A3D1A, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                // Ground texture - leaves and dirt
                for (let i = 0; i < 30; i++) {
                    g.fillStyle(0x0F2F0F, 0.5);
                    g.fillRect(Utils.randomInt(0, 60), Utils.randomInt(0, 60), Utils.randomInt(3, 6), Utils.randomInt(2, 4));
                }

                // Draw 3-4 trees with varying sizes
                const treePositions = [
                    { x: 12, y: 18, scale: 1 },
                    { x: 38, y: 12, scale: 0.9 },
                    { x: 48, y: 38, scale: 1.1 },
                    { x: 20, y: 46, scale: 0.85 }
                ];

                treePositions.forEach(tree => {
                    const tx = tree.x;
                    const ty = tree.y;
                    const s = tree.scale;

                    // Tree trunk - darker and textured
                    g.fillStyle(0x3D2817, 1);
                    g.fillRect(tx + 4 * s, ty + 12 * s, 6 * s, 14 * s);
                    // Trunk texture
                    g.fillStyle(0x2A1B0F, 1);
                    g.fillRect(tx + 5 * s, ty + 14 * s, 2 * s, 8 * s);

                    // Tree crown - multiple layers for depth
                    // Darker bottom layer
                    g.fillStyle(0x1B5E20, 1);
                    g.fillCircle(tx + 7 * s, ty + 8 * s, 14 * s);
                    // Middle layer
                    g.fillStyle(0x2E7D32, 1);
                    g.fillCircle(tx + 5 * s, ty + 5 * s, 10 * s);
                    g.fillCircle(tx + 9 * s, ty + 6 * s, 9 * s);
                    // Highlight
                    g.fillStyle(0x4CAF50, 0.7);
                    g.fillCircle(tx + 4 * s, ty + 3 * s, 5 * s);
                });

                // Soft grid
                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            },
            mountains: (g) => {
                // Sky/background
                g.fillStyle(0xB8C4D0, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                // Draw multiple mountain peaks
                const peaks = [
                    { x1: 5, y1: 55, x2: 25, y2: 15, x3: 45, y3: 55, color: 0x6B7280, snowY: 22 },
                    { x1: 30, y1: 58, x2: 50, y2: 20, x3: 70, y3: 58, color: 0x5A636E, snowY: 26 }
                ];

                peaks.forEach(peak => {
                    // Mountain shadow side
                    g.fillStyle(0x4A5560, 1);
                    g.fillTriangle(peak.x1 + 5, peak.y1 - 3, peak.x2 + 8, peak.y2 + 5, peak.x3, peak.y3);

                    // Main mountain
                    g.fillStyle(peak.color, 1);
                    g.fillTriangle(peak.x1, peak.y1, peak.x2, peak.y2, peak.x3, peak.y3);

                    // Snow cap
                    g.fillStyle(0xFFFFFF, 1);
                    const snowHeight = 12;
                    g.fillTriangle(peak.x2 - 8, peak.snowY + 5, peak.x2, peak.y2, peak.x2 + 8, peak.snowY + 5);
                    // Snow detail
                    g.fillStyle(0xE8E8E8, 1);
                    g.fillTriangle(peak.x2 - 5, peak.snowY + 8, peak.x2, peak.y2 + 3, peak.x2 + 5, peak.snowY + 8);

                    // Rock details on mountain
                    g.fillStyle(0x3D4852, 0.6);
                    g.fillRect(peak.x2 - 3, peak.y2 + 15, 4, 6);
                    g.fillRect(peak.x2 + 6, peak.y2 + 20, 3, 4);
                });

                // Rocks at base
                g.fillStyle(0x5A636E, 1);
                g.fillCircle(15, 58, 6);
                g.fillCircle(55, 60, 5);
                g.fillCircle(62, 58, 4);

                // Grid
                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            },
            water: (g) => {
                // Deep water base
                g.fillStyle(COLORS.water, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                // Water depth variation
                for (let i = 0; i < 15; i++) {
                    g.fillStyle(0x3A80C2, 0.4);
                    g.fillRect(Utils.randomInt(0, 60), Utils.randomInt(0, 60), Utils.randomInt(8, 16), Utils.randomInt(4, 8));
                }

                // Wave patterns
                const waveColors = [0x87CEEB, 0x5BA3D0, 0xA8D4F2];
                for (let row = 0; row < 4; row++) {
                    const y = 12 + row * 14;
                    for (let i = 0; i < 5; i++) {
                        const x = 6 + i * 12 + (row % 2) * 6;
                        g.fillStyle(waveColors[row % 3], 0.5);
                        g.fillRect(x, y, 8, 3);
                        // Wave highlight
                        g.fillStyle(0xFFFFFF, 0.3);
                        g.fillRect(x + 1, y - 1, 4, 2);
                    }
                }

                // Sparkles on water
                for (let i = 0; i < 6; i++) {
                    g.fillStyle(0xFFFFFF, 0.7);
                    g.fillRect(Utils.randomInt(8, 56), Utils.randomInt(8, 56), 2, 2);
                }

                // Grid
                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            }
        };

        Object.entries(terrainCreators).forEach(([name, creator]) => {
            this.renderer.createTexture(name, creator);
        });

        // Unit textures
        Object.keys(UNIT_DEFINITIONS).forEach(unitType => {
            COLORS.players.forEach((color, idx) => {
                this.renderer.createTexture(`${unitType}_${idx}`, (g) => {
                    this.drawUnitSprite(g, unitType, color);
                });
            });
        });

        // City textures
        ['small', 'medium', 'large'].forEach(size => {
            COLORS.players.forEach((color, idx) => {
                this.renderer.createTexture(`city_${size}_${idx}`, (g) => {
                    this.drawCitySprite(g, size, color);
                });
            });
            this.renderer.createTexture(`city_${size}_neutral`, (g) => {
                this.drawCitySprite(g, size, COLORS.neutral);
            });
        });

        // Highlights with animated patterns
        this.renderer.createTexture('highlight_move', (g) => {
            g.fillStyle(COLORS.highlightMove, 0.25);
            g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            // Animated corner brackets
            g.lineStyle(3, COLORS.highlightMove, 1);
            g.beginPath();
            // Top left
            g.moveTo(4, 16);
            g.lineTo(4, 4);
            g.lineTo(16, 4);
            // Top right
            g.moveTo(CONFIG.TILE_SIZE - 4, 16);
            g.lineTo(CONFIG.TILE_SIZE - 4, 4);
            g.lineTo(CONFIG.TILE_SIZE - 16, 4);
            // Bottom left
            g.moveTo(4, CONFIG.TILE_SIZE - 16);
            g.lineTo(4, CONFIG.TILE_SIZE - 4);
            g.lineTo(16, CONFIG.TILE_SIZE - 4);
            // Bottom right
            g.moveTo(CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 16);
            g.lineTo(CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);
            g.lineTo(CONFIG.TILE_SIZE - 16, CONFIG.TILE_SIZE - 4);
            g.strokePath();
            // Movement arrows
            g.fillStyle(COLORS.highlightMove, 0.8);
            g.fillTriangle(32, 20, 28, 26, 36, 26);
            g.fillTriangle(32, 44, 28, 38, 36, 38);
        });

        this.renderer.createTexture('highlight_attack', (g) => {
            g.fillStyle(COLORS.highlightAttack, 0.3);
            g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            // X pattern for attack
            g.lineStyle(4, COLORS.highlightAttack, 0.9);
            g.beginPath();
            g.moveTo(12, 12);
            g.lineTo(CONFIG.TILE_SIZE - 12, CONFIG.TILE_SIZE - 12);
            g.moveTo(CONFIG.TILE_SIZE - 12, 12);
            g.lineTo(12, CONFIG.TILE_SIZE - 12);
            g.strokePath();
            // Sword icon
            g.lineStyle(3, 0xFFFFFF, 0.8);
            g.beginPath();
            g.moveTo(28, 28);
            g.lineTo(36, 36);
            g.strokePath();
            // Outer glow ring
            g.lineStyle(2, COLORS.highlightAttack, 0.6);
            g.strokeCircle(32, 32, 26);
        });

        this.renderer.createTexture('highlight_ranged', (g) => {
            g.fillStyle(COLORS.highlightRanged, 0.3);
            g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            // Target pattern
            g.lineStyle(2, COLORS.highlightRanged, 0.9);
            g.strokeCircle(32, 32, 20);
            g.lineStyle(2, 0xFFFFFF, 0.7);
            g.strokeCircle(32, 32, 12);
            // Crosshair
            g.fillStyle(0xFFFFFF, 0.8);
            g.fillRect(30, 10, 4, 12);
            g.fillRect(30, 42, 4, 12);
            g.fillRect(10, 30, 12, 4);
            g.fillRect(42, 30, 12, 4);
            // Center dot
            g.fillCircle(32, 32, 4);
        });

        this.renderer.createTexture('highlight_select', (g) => {
            // Animated corner brackets with glow
            g.lineStyle(4, 0x00FF00, 1);
            g.beginPath();
            // Top left
            g.moveTo(2, 20);
            g.lineTo(2, 2);
            g.lineTo(20, 2);
            // Top right
            g.moveTo(CONFIG.TILE_SIZE - 2, 20);
            g.lineTo(CONFIG.TILE_SIZE - 2, 2);
            g.lineTo(CONFIG.TILE_SIZE - 20, 2);
            // Bottom left
            g.moveTo(2, CONFIG.TILE_SIZE - 20);
            g.lineTo(2, CONFIG.TILE_SIZE - 2);
            g.lineTo(20, CONFIG.TILE_SIZE - 2);
            // Bottom right
            g.moveTo(CONFIG.TILE_SIZE - 2, CONFIG.TILE_SIZE - 20);
            g.lineTo(CONFIG.TILE_SIZE - 2, CONFIG.TILE_SIZE - 2);
            g.lineTo(CONFIG.TILE_SIZE - 20, CONFIG.TILE_SIZE - 2);
            g.strokePath();
            // Inner glow
            g.lineStyle(2, 0x00FF00, 0.5);
            g.strokeRect(6, 6, CONFIG.TILE_SIZE - 12, CONFIG.TILE_SIZE - 12);
        });

        // Hover effect
        this.renderer.createTexture('tile_hover', (g) => {
            g.lineStyle(2, 0xFFFFFF, 0.6);
            g.strokeRect(2, 2, CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);
            // Corner accents
            g.lineStyle(3, 0xFFFFFF, 0.8);
            g.beginPath();
            g.moveTo(4, 4);
            g.lineTo(4, 12);
            g.moveTo(4, 4);
            g.lineTo(12, 4);
            g.moveTo(CONFIG.TILE_SIZE - 4, 4);
            g.lineTo(CONFIG.TILE_SIZE - 12, 4);
            g.moveTo(CONFIG.TILE_SIZE - 4, 4);
            g.lineTo(CONFIG.TILE_SIZE - 4, 12);
            g.moveTo(4, CONFIG.TILE_SIZE - 4);
            g.lineTo(4, CONFIG.TILE_SIZE - 12);
            g.moveTo(4, CONFIG.TILE_SIZE - 4);
            g.lineTo(12, CONFIG.TILE_SIZE - 4);
            g.moveTo(CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);
            g.lineTo(CONFIG.TILE_SIZE - 12, CONFIG.TILE_SIZE - 4);
            g.moveTo(CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);
            g.lineTo(CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 12);
            g.strokePath();
        });
    }

    drawUnitSprite(g, type, color) {
        const size = type === 'HERO' ? 22 : 18;
        const offset = (CONFIG.TILE_SIZE - size) / 2;
        const cx = offset + size / 2;
        const cy = offset + size / 2;

        // Shadow under unit
        g.fillStyle(0x000000, 0.25);
        g.fillEllipse(cx, offset + size - 2, size * 0.8, 6);

        if (type === 'LIGHT_INFANTRY') {
            // Body/legs
            g.fillStyle(color, 1);
            g.fillRect(offset + 4, offset + 10, size - 8, size - 12);
            // Head
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(cx, offset + 6, 5);
            // Face
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 2, offset + 5, 1, 2); // eye
            g.fillRect(cx + 1, offset + 5, 1, 2); // eye
            // Spear
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + size - 4, offset + 4, 3, size - 4);
            g.fillStyle(0xC0C0C0, 1);
            g.fillRect(offset + size - 5, offset + 2, 5, 4); // spear tip
            // Shield
            g.fillStyle(0x654321, 1);
            g.fillCircle(offset + 5, offset + 12, 4);
        } else if (type === 'HEAVY_INFANTRY') {
            // Heavy armor body
            g.fillStyle(color, 1);
            g.fillRect(offset + 2, offset + 8, size - 4, size - 10);
            // Armor plates
            g.fillStyle(0x404040, 1);
            g.fillRect(offset + 4, offset + 10, size - 8, 4);
            g.fillRect(offset + 4, offset + 16, size - 8, 4);
            // Helmet
            g.fillStyle(0x808080, 1);
            g.fillRect(offset + 4, offset + 2, size - 8, 8);
            g.fillStyle(0x606060, 1);
            g.fillRect(offset + 6, offset, size - 12, 3); // crest
            // Face slit
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 2, offset + 6, 4, 2);
            // Large shield
            g.fillStyle(0x555555, 1);
            g.fillCircle(offset + 5, offset + 13, 5);
            g.fillStyle(color, 1);
            g.fillCircle(offset + 5, offset + 13, 3);
            // Sword
            g.fillStyle(0xA0A0A0, 1);
            g.fillRect(offset + size - 5, offset + 6, 4, 10);
            g.fillRect(offset + size - 6, offset + 4, 6, 3);
        } else if (type === 'CAVALRY') {
            // Horse body
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + 4, offset + 8, size - 8, 8);
            // Horse head
            g.fillRect(offset + 2, offset + 6, 6, 5);
            g.fillRect(offset, offset + 8, 3, 2); // snout
            // Legs
            g.fillRect(offset + 5, offset + 14, 3, 4);
            g.fillRect(offset + size - 8, offset + 14, 3, 4);
            // Rider body
            g.fillStyle(color, 1);
            g.fillRect(offset + 10, offset + 4, 6, 8);
            // Rider head
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(offset + 13, offset + 3, 3);
            // Lance
            g.fillStyle(0x654321, 1);
            g.fillRect(offset + 16, offset, 2, 14);
            g.fillStyle(0xC0C0C0, 1);
            g.fillRect(offset + 15, offset - 2, 4, 4);
        } else if (type === 'ARCHER') {
            // Body
            g.fillStyle(color, 1);
            g.fillRect(offset + 5, offset + 8, size - 10, size - 10);
            // Head with hood
            g.fillStyle(0x228B22, 1);
            g.fillCircle(cx, offset + 6, 6);
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(cx, offset + 6, 4);
            // Face
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 1, offset + 5, 1, 2);
            g.fillRect(cx + 1, offset + 5, 1, 2);
            // Bow
            g.lineStyle(2, 0x8B4513);
            g.beginPath();
            g.arc(offset + 4, offset + 10, 7, -Math.PI / 2, Math.PI / 2);
            g.strokePath();
            // Bowstring
            g.lineStyle(1, 0xDDDDDD);
            g.beginPath();
            g.moveTo(offset + 4, offset + 3);
            g.lineTo(offset + 4, offset + 17);
            g.strokePath();
            // Arrow
            g.fillStyle(0x654321, 1);
            g.fillRect(offset + 8, offset + 8, 8, 2);
            g.fillStyle(0x808080, 1);
            g.fillRect(offset + 14, offset + 6, 2, 6); // fletching
        } else if (type === 'CATAPULT') {
            // Wooden base/platform
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + 2, offset + 12, size - 4, 6);
            // Wheels
            g.fillStyle(0x4A3728, 1);
            g.fillCircle(offset + 6, offset + 16, 4);
            g.fillCircle(offset + size - 6, offset + 16, 4);
            g.fillStyle(0x2A1B0F, 1);
            g.fillCircle(offset + 6, offset + 16, 2);
            g.fillCircle(offset + size - 6, offset + 16, 2);
            // Frame structure
            g.fillStyle(0x654321, 1);
            g.fillRect(offset + 4, offset + 8, 4, 8);
            g.fillRect(offset + size - 8, offset + 8, 4, 8);
            g.fillRect(offset + 4, offset + 6, size - 8, 3);
            // Throwing arm
            g.fillStyle(0x5D4037, 1);
            g.fillRect(offset + 8, offset + 4, 3, 10);
            // Rope/basket
            g.fillStyle(0x4A3728, 1);
            g.fillRect(offset + 6, offset + 2, 7, 4);
            // Projectile
            g.fillStyle(0x333333, 1);
            g.fillCircle(offset + size - 6, offset + 8, 3);
        } else if (type === 'DRAGON') {
            // Dragon body - serpentine
            g.fillStyle(0xCC0000, 1);
            g.fillRect(offset + 8, offset + 10, 10, 6);
            // Wings
            g.fillStyle(0x990000, 1);
            g.fillTriangle(offset + 4, offset + 10, offset + 2, offset + 2, offset + 10, offset + 8);
            g.fillTriangle(offset + size - 4, offset + 10, offset + size - 2, offset + 2, offset + size - 10, offset + 8);
            // Wing membranes
            g.fillStyle(0xFF4500, 0.7);
            g.fillTriangle(offset + 4, offset + 9, offset + 3, offset + 4, offset + 8, offset + 8);
            g.fillTriangle(offset + size - 4, offset + 9, offset + size - 3, offset + 4, offset + size - 8, offset + 8);
            // Head
            g.fillStyle(0xCC0000, 1);
            g.fillRect(offset + 2, offset + 8, 8, 6);
            g.fillRect(offset, offset + 9, 3, 3); // snout
            // Eye
            g.fillStyle(0xFFFF00, 1);
            g.fillCircle(offset + 4, offset + 10, 2);
            g.fillStyle(0x000000, 1);
            g.fillCircle(offset + 4, offset + 10, 1);
            // Fire breath effect
            g.fillStyle(0xFF6600, 0.8);
            g.fillRect(offset - 4, offset + 9, 4, 3);
            g.fillStyle(0xFFFF00, 0.9);
            g.fillRect(offset - 3, offset + 9, 2, 3);
            // Tail
            g.fillStyle(0x990000, 1);
            g.fillRect(offset + size - 4, offset + 12, 4, 4);
            // Spikes on back
            g.fillStyle(0x660000, 1);
            g.fillRect(offset + 10, offset + 6, 2, 4);
            g.fillRect(offset + 14, offset + 7, 2, 3);
        } else if (type === 'HERO') {
            // Hero is larger and more detailed
            // Cape/cloak
            g.fillStyle(0x8B0000, 1);
            g.fillRect(offset + 4, offset + 10, size - 8, size - 12);
            // Body armor
            g.fillStyle(color, 1);
            g.fillRect(offset + 6, offset + 8, size - 12, 10);
            // Decorative chest plate
            g.fillStyle(0xFFD700, 1);
            g.fillRect(cx - 2, offset + 10, 4, 6);
            // Crown/helmet
            g.fillStyle(0xFFD700, 1);
            g.fillRect(offset + 6, offset + 2, size - 12, 6);
            // Crown spikes
            g.fillRect(offset + 4, offset - 2, 3, 5);
            g.fillRect(cx - 1, offset - 4, 3, 6);
            g.fillRect(offset + size - 7, offset - 2, 3, 5);
            // Face
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(cx, offset + 7, 4);
            // Eyes
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 2, offset + 6, 1, 2);
            g.fillRect(cx + 1, offset + 6, 1, 2);
            // Sword (legendary)
            g.fillStyle(0xC0C0C0, 1);
            g.fillRect(offset + size - 6, offset + 6, 4, 12);
            g.fillStyle(0xFFD700, 1);
            g.fillRect(offset + size - 7, offset + 6, 6, 3); // guard
            g.fillRect(offset + size - 6, offset + 2, 4, 4); // pommel
            // Shield
            g.fillStyle(0x444444, 1);
            g.fillCircle(offset + 6, offset + 14, 4);
            g.fillStyle(color, 1);
            g.fillCircle(offset + 6, offset + 14, 3);
            g.fillStyle(0xFFD700, 1);
            g.fillCircle(offset + 6, offset + 14, 1); // emblem
        }
    }

    drawCitySprite(g, size, color) {
        // Flag waving above city
        const drawFlag = (fx, fy) => {
            // Flag pole
            g.fillStyle(0x8B4513, 1);
            g.fillRect(fx, fy, 2, 14);
            // Flag cloth
            g.fillStyle(color, 1);
            g.fillRect(fx + 2, fy, 10, 7);
            // Flag wave effect
            g.fillStyle(0xFFFFFF, 0.3);
            g.fillRect(fx + 4, fy + 1, 4, 2);
        };

        if (size === 'small') {
            const ox = (CONFIG.TILE_SIZE - 36) / 2;
            const oy = (CONFIG.TILE_SIZE - 28) / 2 + 4;

            // Base/foundation
            g.fillStyle(0x5A4A3A, 1);
            g.fillRect(ox, oy + 20, 36, 8);

            // Main building
            g.fillStyle(color, 1);
            g.fillRect(ox + 6, oy + 10, 24, 14);

            // Roof
            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox, oy + 10, ox + 18, oy - 2, ox + 36, oy + 10);
            // Roof highlight
            g.fillStyle(0x5A5A5A, 1);
            g.fillTriangle(ox + 8, oy + 10, ox + 18, oy + 2, ox + 28, oy + 10);

            // Door
            g.fillStyle(0x3D2817, 1);
            g.fillRect(ox + 14, oy + 16, 8, 8);
            // Door frame
            g.fillStyle(0x5A4A3A, 1);
            g.fillRect(ox + 13, oy + 15, 10, 1);
            g.fillRect(ox + 13, oy + 15, 1, 9);
            g.fillRect(ox + 22, oy + 15, 1, 9);

            // Window
            g.fillStyle(0x87CEEB, 1);
            g.fillRect(ox + 10, oy + 12, 4, 4);
            g.fillRect(ox + 22, oy + 12, 4, 4);
            g.fillStyle(0x2C1810, 1);
            g.fillRect(ox + 11, oy + 13, 2, 2);
            g.fillRect(ox + 23, oy + 13, 2, 2);

            // Chimney
            g.fillStyle(0x4A4A4A, 1);
            g.fillRect(ox + 26, oy + 4, 4, 8);
            // Smoke
            g.fillStyle(0xAAAAAA, 0.6);
            g.fillCircle(ox + 28, oy, 3);
            g.fillCircle(ox + 30, oy - 3, 2);

            // Flag
            drawFlag(ox + 28, oy - 12);

        } else if (size === 'medium') {
            const ox = (CONFIG.TILE_SIZE - 44) / 2;
            const oy = (CONFIG.TILE_SIZE - 36) / 2 + 2;

            // Town wall base
            g.fillStyle(0x5A4A3A, 1);
            g.fillRect(ox, oy + 26, 44, 8);
            // Crenellations
            for (let i = 0; i < 5; i++) {
                g.fillRect(ox + i * 9, oy + 24, 5, 3);
            }

            // Left building
            g.fillStyle(color, 1);
            g.fillRect(ox + 4, oy + 14, 14, 14);
            // Left roof
            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox + 2, oy + 14, ox + 11, oy + 4, ox + 20, oy + 14);

            // Right building
            g.fillStyle(color, 1);
            g.fillRect(ox + 26, oy + 12, 14, 16);
            // Right roof
            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox + 24, oy + 12, ox + 33, oy + 2, ox + 42, oy + 12);

            // Center tower
            g.fillStyle(0x6A6A6A, 1);
            g.fillRect(ox + 16, oy + 8, 12, 20);
            // Tower roof (cone)
            g.fillStyle(0x3A3A3A, 1);
            g.fillTriangle(ox + 14, oy + 8, ox + 22, oy - 4, ox + 30, oy + 8);

            // Tower window
            g.fillStyle(0xFFD700, 1);
            g.fillCircle(ox + 22, oy + 16, 3);

            // Main gate
            g.fillStyle(0x3D2817, 1);
            g.fillRect(ox + 18, oy + 22, 8, 10);
            // Gate arch
            g.fillStyle(0x5A4A3A, 1);
            g.fillRect(ox + 16, oy + 20, 12, 2);

            // Flags
            drawFlag(ox + 8, oy);
            drawFlag(ox + 34, oy - 2);

        } else if (size === 'large') {
            const ox = (CONFIG.TILE_SIZE - 52) / 2;
            const oy = (CONFIG.TILE_SIZE - 44) / 2;

            // Fortress walls
            g.fillStyle(0x4A4A4A, 1);
            g.fillRect(ox, oy + 20, 52, 24);

            // Stone texture on walls
            g.fillStyle(0x5A5A5A, 1);
            for (let i = 0; i < 6; i++) {
                for (let j = 0; j < 3; j++) {
                    g.fillRect(ox + 2 + i * 8, oy + 22 + j * 7, 6, 5);
                }
            }

            // Corner towers
            const towerColor = color;
            // Left tower
            g.fillStyle(towerColor, 1);
            g.fillRect(ox, oy + 8, 14, 36);
            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox - 2, oy + 8, ox + 7, oy - 6, ox + 16, oy + 8);

            // Right tower
            g.fillStyle(towerColor, 1);
            g.fillRect(ox + 38, oy + 8, 14, 36);
            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox + 36, oy + 8, ox + 45, oy - 6, ox + 54, oy + 8);

            // Keep (center building)
            g.fillStyle(towerColor, 1);
            g.fillRect(ox + 16, oy + 12, 20, 32);
            // Keep roof
            g.fillStyle(0x3A3A3A, 1);
            g.fillTriangle(ox + 14, oy + 12, ox + 26, oy - 8, ox + 38, oy + 12);

            // Windows with light
            g.fillStyle(0xFFD700, 1);
            // Left tower windows
            g.fillRect(ox + 4, oy + 20, 4, 6);
            g.fillRect(ox + 4, oy + 30, 4, 6);
            // Right tower windows
            g.fillRect(ox + 44, oy + 20, 4, 6);
            g.fillRect(ox + 44, oy + 30, 4, 6);
            // Keep windows
            g.fillRect(ox + 20, oy + 24, 4, 6);
            g.fillRect(ox + 28, oy + 24, 4, 6);

            // Main gate (portcullis)
            g.fillStyle(0x2A2A2A, 1);
            g.fillRect(ox + 20, oy + 32, 12, 12);
            // Gate bars
            g.fillStyle(0x1A1A1A, 1);
            for (let i = 0; i < 4; i++) {
                g.fillRect(ox + 21 + i * 3, oy + 32, 2, 12);
            }
            // Gate arch
            g.fillStyle(0x5A5A5A, 1);
            g.fillRect(ox + 18, oy + 30, 16, 3);

            // Flags on towers
            drawFlag(ox + 6, oy - 8);
            drawFlag(ox + 44, oy - 8);
            // Banner on keep
            g.fillStyle(color, 1);
            g.fillRect(ox + 24, oy - 6, 4, 10);
        }
    }

    createPlayers(playerConfigs) {
        this.players = playerConfigs.map((config, index) => {
            return new Player(index, COLORS.players[index], config.name, config.isAI);
        });
    }

    setupInitialPositions(mapWidth, mapHeight) {
        const corners = [
            { x: 1, y: 1 },
            { x: mapWidth - 2, y: mapHeight - 2 },
            { x: 1, y: mapHeight - 2 },
            { x: mapWidth - 2, y: 1 }
        ];

        this.players.forEach((player, idx) => {
            const pos = corners[idx];
            if (!pos) return;

            this.map.terrain[pos.y][pos.x] = TERRAIN.PLAINS;

            const city = new City(pos.x, pos.y, 'large', player.id);
            this.map.addCity(city);
            player.cities.push(city);

            const hero = new Unit('HERO', player.id, pos.x, pos.y);
            this.map.units.push(hero);
            player.units.push(hero);

            for (let i = 0; i < 2; i++) {
                const lx = pos.x + (i === 0 ? 1 : -1);
                const ly = pos.y;
                if (this.map.isValid(lx, ly)) {
                    const li = new Unit('LIGHT_INFANTRY', player.id, lx, ly);
                    this.map.units.push(li);
                    player.units.push(li);
                }
            }
        });
    }

    setupNeutralCities(mapWidth, mapHeight) {
        // Scale number of cities with map size
        const areaRatio = (mapWidth * mapHeight) / (CONFIG.MAP_WIDTH * CONFIG.MAP_HEIGHT);
        const numNeutral = Math.floor(Utils.randomInt(4, 6) * areaRatio);
        const sizes = ['small', 'small', 'medium', 'medium', 'large'];

        for (let i = 0; i < numNeutral; i++) {
            let x, y, attempts = 0;
            do {
                x = Utils.randomInt(2, mapWidth - 3);
                y = Utils.randomInt(2, mapHeight - 3);
                attempts++;
            } while ((this.map.getCity(x, y) || this.map.getTerrain(x, y) === TERRAIN.WATER) && attempts < 50);

            if (attempts < 50) {
                const size = sizes[Utils.randomInt(0, sizes.length - 1)];
                this.map.addCity(new City(x, y, size, null));
            }
        }
    }

    setupRuins(mapWidth, mapHeight) {
        // Scale number of ruins with map size
        const areaRatio = (mapWidth * mapHeight) / (CONFIG.MAP_WIDTH * CONFIG.MAP_HEIGHT);
        const numRuins = Math.floor(Utils.randomInt(5, 8) * areaRatio);

        for (let i = 0; i < numRuins; i++) {
            let x, y, attempts = 0;
            do {
                x = Utils.randomInt(2, mapWidth - 3);
                y = Utils.randomInt(2, mapHeight - 3);
                attempts++;
            } while ((this.map.getCity(x, y) || this.map.getRuin(x, y) || this.map.getTerrain(x, y) === TERRAIN.WATER) && attempts < 50);

            if (attempts < 50) {
                this.map.addRuin(x, y);
            }
        }
    }

    setupInput() {
        // Track drag for camera scrolling
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.cameraStart = { x: 0, y: 0 };

        // Pinch zoom tracking
        this.pinchDistance = 0;
        this.pinchCenter = { x: 0, y: 0 };
        this.pinchZoomStart = 1;

        // Pointer down - start drag or click
        this.scene.input.on('pointerdown', (pointer) => {
            // Only handle if in viewport (not on UI)
            if (!this.renderer.isInViewport(pointer.x, pointer.y)) return;

            // Right-click opens production for city
            if (pointer.button === 2) {
                const tile = this.renderer.screenToTile(pointer.x, pointer.y);
                const city = this.map.getCity(tile.x, tile.y);
                const player = this.players[this.state.currentPlayerIndex];
                if (city && city.owner === player.id) {
                    this.selectCity(city);
                }
                return;
            }

            this.isDragging = true;
            this.dragStart = { x: pointer.x, y: pointer.y };
            this.cameraStart = { x: this.renderer.camera.x, y: this.renderer.camera.y };
        });

        // Pointer move - drag camera or hover
        this.scene.input.on('pointermove', (pointer) => {
            // Update tile info on hover (when not dragging)
            if (!this.isDragging && this.renderer.isInViewport(pointer.x, pointer.y)) {
                const tile = this.renderer.screenToTile(pointer.x, pointer.y);
                this.handleTileHover(tile.x, tile.y);
            }

            if (!this.isDragging || !pointer.isDown) return;

            const dx = this.dragStart.x - pointer.x;
            const dy = this.dragStart.y - pointer.y;

            // If moved significantly, it's a drag not a click
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                this.renderer.setCamera(this.cameraStart.x + dx, this.cameraStart.y + dy);
                this.updateUI(); // Update minimap viewport
            }
        });

        // Pointer up - end drag or handle click
        this.scene.input.on('pointerup', (pointer) => {
            if (!this.isDragging) return;

            const dx = this.dragStart.x - pointer.x;
            const dy = this.dragStart.y - pointer.y;

            // If didn't drag much, treat as click
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
                // Use dragStart position (where click started) not current pointer position
                // This ensures we click on the tile where user originally clicked
                const tile = this.renderer.screenToTile(this.dragStart.x, this.dragStart.y);
                if (this.map.isValid(tile.x, tile.y)) {
                    this.handleTileClick(tile.x, tile.y);
                }
            }

            this.isDragging = false;
        });

        // Pinch zoom for mobile
        this.scene.input.on('pointerdown', (pointer) => {
            // Check if we have two pointers (multi-touch)
            const pointers = this.scene.input.getActivePointers();
            if (pointers.length >= 2) {
                this.isDragging = false; // Cancel drag when pinching starts
                const p1 = pointers[0];
                const p2 = pointers[1];

                // Calculate initial distance and center
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                this.pinchDistance = Math.sqrt(dx * dx + dy * dy);
                this.pinchCenter = {
                    x: (p1.x + p2.x) / 2,
                    y: (p1.y + p2.y) / 2
                };
                this.pinchZoomStart = this.renderer.zoom;
            }
        });

        this.scene.input.on('pointermove', (pointer) => {
            const pointers = this.scene.input.getActivePointers();

            if (pointers.length >= 2) {
                const p1 = pointers[0];
                const p2 = pointers[1];

                // Calculate current distance
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Calculate new zoom
                if (this.pinchDistance > 0) {
                    const scale = distance / this.pinchDistance;
                    const newZoom = this.pinchZoomStart * scale;

                    // Calculate new center point
                    const newCenterX = (p1.x + p2.x) / 2;
                    const newCenterY = (p1.y + p2.y) / 2;

                    // Apply zoom at the pinch center
                    this.renderer.zoomAt(newZoom, newCenterX, newCenterY);
                    this.updateUI(); // Update minimap

                    // Track how much we've panned during pinch
                    const panX = newCenterX - this.pinchCenter.x;
                    const panY = newCenterY - this.pinchCenter.y;

                    // Pan camera to follow pinch movement
                    if (Math.abs(panX) > 1 || Math.abs(panY) > 1) {
                        this.renderer.moveCamera(-panX / this.renderer.zoom, -panY / this.renderer.zoom);
                        this.pinchCenter.x = newCenterX;
                        this.pinchCenter.y = newCenterY;
                    }
                }
            }
        });

        this.scene.input.on('pointerup', () => {
            this.pinchDistance = 0;
        });

        // Mouse wheel zoom for desktop
        this.scene.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => {
            const zoomSpeed = 0.001;
            const newZoom = this.renderer.zoom - deltaY * zoomSpeed;
            this.renderer.zoomAt(newZoom, pointer.x, pointer.y);
            this.updateUI();
        });

        // Keyboard camera controls
        const cameraSpeed = CONFIG.TILE_SIZE;
        this.scene.input.keyboard.on('keydown-LEFT', () => {
            this.renderer.moveCamera(-cameraSpeed, 0);
            this.updateUI(); // Update minimap viewport
        });
        this.scene.input.keyboard.on('keydown-RIGHT', () => {
            this.renderer.moveCamera(cameraSpeed, 0);
            this.updateUI(); // Update minimap viewport
        });
        this.scene.input.keyboard.on('keydown-UP', () => {
            this.renderer.moveCamera(0, -cameraSpeed);
            this.updateUI(); // Update minimap viewport
        });
        this.scene.input.keyboard.on('keydown-DOWN', () => {
            this.renderer.moveCamera(0, cameraSpeed);
            this.updateUI(); // Update minimap viewport
        });

        // Center camera on current player with 'C'
        this.scene.input.keyboard.on('keydown-C', () => {
            this.centerCameraOnPlayer(this.state.currentPlayerIndex);
            this.updateUI(); // Update minimap viewport
        });

        // Existing shortcuts
        this.scene.input.keyboard.on('keydown-ESC', () => this.deselect());
        this.scene.input.keyboard.on('keydown-S', () => this.saveGame());
        this.scene.input.keyboard.on('keydown-L', () => this.loadGame());

        // Production shortcut - opens production for selected city or city under cursor
        this.scene.input.keyboard.on('keydown-P', () => {
            const player = this.players[this.state.currentPlayerIndex];

            // If we have a selected city, just ensure production is shown
            if (this.state.selectedEntity instanceof City) {
                this.selectCity(this.state.selectedEntity);
                return;
            }

            // Otherwise, try to find a city at the camera center
            const centerTileX = Math.floor((this.renderer.camera.x + VIEWPORT_WIDTH / 2) / CONFIG.TILE_SIZE);
            const centerTileY = Math.floor((this.renderer.camera.y + VIEWPORT_HEIGHT / 2) / CONFIG.TILE_SIZE);

            // Check all cities owned by player
            for (const city of player.cities) {
                // Check if city is visible on screen
                const cityScreenX = city.x * CONFIG.TILE_SIZE - this.renderer.camera.x;
                const cityScreenY = city.y * CONFIG.TILE_SIZE - this.renderer.camera.y;

                if (cityScreenX >= 0 && cityScreenX < VIEWPORT_WIDTH &&
                    cityScreenY >= 0 && cityScreenY < VIEWPORT_HEIGHT) {
                    this.selectCity(city);
                    return;
                }
            }
        });
    }

    handleTileClick(x, y) {
        const player = this.players[this.state.currentPlayerIndex];
        const stack = this.map.getStack(x, y);
        const city = this.map.getCity(x, y);

        // Update tile info in UI
        this.ui.updateTileInfo(x, y, this.map);

        // First priority: select movable units (even in cities)
        if (stack && stack.owner === player.id) {
            // Find any unit that hasn't moved yet
            const movableUnit = stack.units.find(u => u.hp > 0 && !u.hasMoved);
            if (movableUnit) {
                this.selectUnit(movableUnit, stack);
                return;
            }
        }

        // Second priority: select own city for production
        if (city && city.owner === player.id) {
            this.selectCity(city);
            return;
        }

        // Handle unit actions based on phase
        if (this.state.selectedEntity instanceof Unit) {
            const unit = this.state.selectedEntity;

            // Phase 1: SELECTED - unit hasn't moved, can move or attack
            if (this.state.phase === GameState.PHASES.SELECTED && !unit.hasMoved) {
                const reachable = MovementSystem.getReachableTiles(unit, this.map);
                const moveTarget = reachable.find(t => t.x === x && t.y === y);

                if (moveTarget) {
                    if (moveTarget.isEnemy) {
                        // Attack adjacent enemy
                        const enemyStack = this.map.getStack(x, y);
                        if (enemyStack) this.performAttack(unit, enemyStack);
                    } else {
                        // Move to empty tile
                        this.moveUnit(unit, x, y);
                    }
                    return;
                }

                // Check for ranged attack target (not adjacent but in range)
                // Use Chebyshev distance for attacks (8 directions including diagonals)
                const dist = Utils.chebyshevDistance(unit.x, unit.y, x, y);
                if (dist <= unit.range && dist > 1 && !unit.hasAttacked) {
                    const enemyStack = this.map.getStack(x, y);
                    if (enemyStack && enemyStack.owner !== unit.owner) {
                        this.performAttack(unit, enemyStack, true);
                        return;
                    }
                }
            }

            // Phase 2: MOVED - unit has moved, can only attack
            if (this.state.phase === GameState.PHASES.MOVED && !unit.hasAttacked) {
                // Use Chebyshev distance for attacks (8 directions including diagonals)
                const dist = Utils.chebyshevDistance(unit.x, unit.y, x, y);
                if (dist <= unit.range && dist > 0) {
                    const enemyStack = this.map.getStack(x, y);
                    if (enemyStack && enemyStack.owner !== unit.owner) {
                        const isRanged = dist > 1;
                        this.performAttack(unit, enemyStack, isRanged);
                        return;
                    }
                }
            }
        }

        this.deselect();
    }

    /**
     * Update tile info when hovering over a tile
     */
    handleTileHover(x, y) {
        if (this.map.isValid(x, y)) {
            this.ui.updateTileInfo(x, y, this.map);
            this.renderer.showHover(x, y);
        } else {
            this.renderer.clearHover();
        }
    }

    selectUnit(unit, stack) {
        this.state.selectedEntity = unit;
        this.state.transition(GameState.PHASES.SELECTED);
        this.ui.hideProduction();

        // Get movement targets
        const reachable = MovementSystem.getReachableTiles(unit, this.map);

        // For ranged units (range > 1), show attack targets from current position
        // Melee units (range = 1) must move adjacent first, then attack
        if (!unit.hasAttacked && unit.range > 1) {
            const attackTargets = MovementSystem.getAttackTargets(unit, this.map);
            // Add attack targets that aren't already in reachable (movement targets)
            for (const target of attackTargets) {
                if (!reachable.find(r => r.x === target.x && r.y === target.y)) {
                    reachable.push(target);
                }
            }
        }

        this.renderer.highlightTiles(reachable);
        this.renderer.renderUnits(this.map.units, unit);
        this.updateUI();
    }

    /**
     * Show only attack targets for a unit that has moved
     */
    showAttackTargets(unit) {
        const targets = MovementSystem.getAttackTargets(unit, this.map);
        this.renderer.highlightTiles(targets);
    }

    selectCity(city) {
        this.state.selectedEntity = city;
        this.state.transition(GameState.PHASES.PRODUCTION);
        this.renderer.clearHighlights();
        this.ui.showProduction(city, this.players[this.state.currentPlayerIndex]);
        this.updateUI();
    }

    deselect() {
        this.state.selectedEntity = null;
        this.state.transition(GameState.PHASES.IDLE);
        this.renderer.clearHighlights();
        this.ui.hideProduction();
        this.ui.clearTileInfo();
        this.renderer.renderUnits(this.map.units);
        this.updateUI();
    }

    moveUnit(unit, x, y) {
        const oldX = unit.x, oldY = unit.y;
        this.map.moveUnit(unit, x, y);

        // Ruin exploration
        const ruin = this.map.getRuin(x, y);
        if (ruin && unit.isHero) {
            const artifact = this.map.exploreRuin(x, y);
            if (artifact) {
                unit.addArtifact(artifact);
                this.ui.showMessage(`Found ${artifact.name}!`);
            }
        }

        // City capture
        const city = this.map.getCity(x, y);
        if (city) {
            if (city.owner === null) {
                this.captureCity(city, unit.owner);
            } else if (city.owner !== unit.owner) {
                const defenders = this.map.getUnitsAt(x, y).filter(u => u.owner !== unit.owner && u.hp > 0);
                if (defenders.length === 0) {
                    this.captureCity(city, unit.owner);
                }
            }
        }

        this.renderer.renderMap(this.map);
        this.renderer.renderUnits(this.map.units);

        // After movement, check if unit can still attack
        if (!unit.hasAttacked) {
            this.state.transition(GameState.PHASES.MOVED);
            this.showAttackTargets(unit);
            this.updateUI();
        } else {
            this.deselect();
        }
    }

    performAttack(attacker, defenderStack, isRanged = false) {
        const results = CombatSystem.performAttack(attacker, defenderStack, this.map);
        if (!results) return;

        if (results.defender.died && results.defender.unit.isHero) {
            this.checkWinCondition();
        }
        if (results.attacker.died && results.attacker.unit.isHero) {
            this.checkWinCondition();
        }

        if (results.cityCaptured) {
            this.captureCity(results.cityCaptured, attacker.owner);
        }

        if (isRanged) {
            attacker.hasAttacked = true;
            this.updateUI();
        } else {
            this.deselect();
        }

        this.renderer.renderMap(this.map);
        this.renderer.renderUnits(this.map.units);
    }

    captureCity(city, newOwner) {
        const oldOwner = city.owner;
        city.changeOwner(newOwner);

        const newPlayer = this.players[newOwner];
        newPlayer.cities.push(city);

        if (oldOwner !== null) {
            const oldPlayer = this.players[oldOwner];
            const idx = oldPlayer.cities.indexOf(city);
            if (idx > -1) oldPlayer.cities.splice(idx, 1);
        }

        this.checkWinCondition();
    }

    produceUnit(city, unitType) {
        const player = this.players[this.state.currentPlayerIndex];
        const cost = UNIT_DEFINITIONS[unitType].cost;

        if (player.spendGold(cost)) {
            const unit = new Unit(unitType, player.id, city.x, city.y);
            unit.hasMoved = true;
            unit.hasAttacked = true;
            this.map.units.push(unit);
            player.units.push(unit);
            this.ui.showMessage(`Produced ${UNIT_DEFINITIONS[unitType].name}!`);
            this.renderer.renderUnits(this.map.units);
            this.updateUI();
            return true;
        }
        return false;
    }

    endTurn() {
        const player = this.players[this.state.currentPlayerIndex];

        // Collect income
        player.cities.forEach(city => player.addGold(city.income));

        // Heal units in cities
        this.map.healUnitsInCities();

        // Reset units
        player.units.forEach(u => u.resetTurn());

        // Next player
        this.state.nextPlayer(this.players.length);

        // Skip dead players
        while (!this.players[this.state.currentPlayerIndex].isAlive) {
            this.state.nextPlayer(this.players.length);
        }

        this.deselect();
        this.updateUI();

        const nextPlayer = this.players[this.state.currentPlayerIndex];
        this.ui.showMessage(`${nextPlayer.name}'s turn!`, 1500);

        // Center camera on next player (smoothly)
        this.centerCameraOnPlayer(this.state.currentPlayerIndex);

        // Start AI turn if next player is AI
        this.checkAndStartAITurn();
    }

    /**
     * Check if current player is AI and start their turn
     */
    checkAndStartAITurn() {
        const currentPlayer = this.players[this.state.currentPlayerIndex];
        if (currentPlayer.isAI && currentPlayer.isAlive && this.ai) {
            // Disable input during AI turn
            this.scene.input.enabled = false;
            this.ui.showMessage(`${currentPlayer.name} (AI) is thinking...`, 2000);

            // Start AI turn after a short delay
            setTimeout(() => {
                this.ai.playTurn().then(() => {
                    // Re-enable input after AI turn
                    this.scene.input.enabled = true;
                });
            }, 1000);
        }
    }

    checkWinCondition() {
        this.players.forEach(player => {
            if (!player.isAlive) return;

            const hasHero = player.units.some(u => u.isHero && u.hp > 0);
            const hasCities = player.cities.length > 0;

            if (!hasHero && !hasCities) {
                player.defeat();
            }
        });

        const alive = this.players.filter(p => p.isAlive);
        if (alive.length === 1) {
            this.state.transition(GameState.PHASES.GAME_OVER);
            this.ui.showGameOver(alive[0]);
        }
    }

    updateUI() {
        const player = this.players[this.state.currentPlayerIndex];
        this.ui.updatePlayer(player, this.state.turnNumber);

        const stack = this.state.selectedEntity instanceof Unit ?
            this.map.getStack(this.state.selectedEntity.x, this.state.selectedEntity.y) : null;
        this.ui.updateSelected(this.state.selectedEntity, stack);

        // Update minimap
        this.ui.updateMinimap(this.map, this.players, this.renderer.camera.x, this.renderer.camera.y);
    }

    saveGame() {
        SaveSystem.save(this);
        this.ui.showMessage('Game saved!');
    }

    loadGame() {
        const data = SaveSystem.load();
        if (!data) {
            this.ui.showMessage('No save found!');
            return;
        }

        // Restore map
        this.map.terrain = data.map.terrain;
        this.map.cities = data.map.cities.map(c => {
            const city = new City(c.x, c.y, c.size, c.owner);
            city.id = c.id;
            return city;
        });
        this.map.ruins = data.map.ruins;
        this.map.units = data.map.units.map(u => Unit.deserialize(u));

        // Restore players
        this.players = data.players.map(p => {
            const player = new Player(p.id, COLORS.players[p.id], p.name);
            player.gold = p.gold;
            player.isAlive = p.isAlive;
            player.units = this.map.units.filter(u => u.owner === p.id);
            player.cities = this.map.cities.filter(c => c.owner === p.id);
            return player;
        });

        // Restore state
        this.state.currentPlayerIndex = data.currentPlayer;
        this.state.turnNumber = data.turn;
        this.state.selectedEntity = null;
        this.state.phase = GameState.PHASES.IDLE;

        this.renderer.renderMap(this.map);
        this.renderer.renderUnits(this.map.units);
        this.updateUI();
        this.ui.showMessage('Game loaded!');
    }
}
