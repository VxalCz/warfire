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
        Events.on('ui:togglePause', () => this.togglePause());
        Events.on('player:defeated', ({ player }) => this.ui.showMessage(`${player.name} defeated!`));
        Events.on('city:captured', ({ city, newOwner }) => {
            const player = this.players[newOwner];
            this.ui.showMessage(`${player.name} captured city!`);
        });
        Events.on('ai:turnEnded', () => {
            // In spectator mode, check if we should auto-continue
            if (this.isSpectatorMode && !this.aiPaused) {
                this.scheduleNextTurn();
            }
        });
    }

    initialize() {
        // Use config from menu or defaults
        const mapWidth = this.gameConfig?.mapWidth || CONFIG.MAP_WIDTH;
        const mapHeight = this.gameConfig?.mapHeight || CONFIG.MAP_HEIGHT;
        const numCities = this.gameConfig?.numCities;
        const numRuins = this.gameConfig?.numRuins;
        const playerConfigs = this.gameConfig?.players || [
            { name: 'Player 1', isAI: false },
            { name: 'Player 2', isAI: true }
        ];

        // Check if all players are AI (spectator mode)
        this.isSpectatorMode = playerConfigs.every(p => p.isAI);
        this.aiPaused = false;
        this.nextTurnTimer = null;

        this.renderer.initialize();
        this.createTextures();

        this.map = new GameMap(mapWidth, mapHeight);
        this.balanceTerrainForFairness(mapWidth, mapHeight);
        this.createPlayers(playerConfigs);
        this.setupInitialPositions(mapWidth, mapHeight);
        this.setupNeutralCities(mapWidth, mapHeight, numCities);
        this.setupRuins(mapWidth, mapHeight, numRuins);

        // UI position: desktop = right sidebar, mobile = bottom panel
        const uiX = CONFIG.IS_MOBILE ? 0 : VIEWPORT_WIDTH;
        const uiY = CONFIG.IS_MOBILE ? VIEWPORT_HEIGHT : 0;
        const uiWidth = CONFIG.IS_MOBILE ? GAME_WIDTH : CONFIG.UI_WIDTH;
        const uiHeight = CONFIG.IS_MOBILE ? CONFIG.UI_HEIGHT : VIEWPORT_HEIGHT;
        this.ui = new UIController(this.scene, uiX, uiY, uiWidth, uiHeight);
        this.ui.initialize();

        // Setup spectator mode in UI
        this.ui.setSpectatorMode(this.isSpectatorMode);

        // In spectator mode, disable input - purely for watching
        if (this.isSpectatorMode) {
            this.scene.input.enabled = false;
        }

        // Setup minimap click handler
        this.ui.setMinimapClickCallback((x, y) => {
            this.renderer.centerOnTile(x, y);
            this.updateUI(); // Update minimap viewport
        });

        // In spectator mode, allow camera control via minimap
        if (this.isSpectatorMode) {
            this.setupSpectatorCameraControls();
        }

        // Initialize AI system
        this.ai = new AISystem(this);

        this.renderer.renderMap(this.map, this.getBlockadedCities());
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
        // Generate 4 variants for each terrain type
        const NUM_VARIANTS = 4;

        // Deterministic pseudo-random function for consistent patterns
        const seededRandom = (seed) => {
            let x = Math.sin(seed) * 10000;
            return x - Math.floor(x);
        };

        // Generate grass positions deterministically
        const generateGrassPositions = (variant) => {
            const positions = [];
            for (let i = 0; i < 40; i++) {
                const seed = variant * 1000 + i;
                positions.push({
                    x: Math.floor(seededRandom(seed) * 58) + 2,
                    y: Math.floor(seededRandom(seed + 500) * 58) + 2,
                    size: Math.floor(seededRandom(seed + 1000) * 3) + 2,
                    colorIdx: Math.floor(seededRandom(seed + 1500) * 4)
                });
            }
            return positions;
        };

        // Generate flower positions deterministically
        const generateFlowerPositions = (variant) => {
            const positions = [];
            for (let i = 0; i < 3; i++) {
                const seed = variant * 2000 + i;
                positions.push({
                    x: Math.floor(seededRandom(seed) * 48) + 8,
                    y: Math.floor(seededRandom(seed + 500) * 48) + 8
                });
            }
            return positions;
        };

        const terrainVariants = {
            plains: (g, variant) => {
                // Base grass color with subtle gradient
                g.fillStyle(COLORS.plains, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                // Add grass texture - varied green patches (deterministic per variant)
                const grassColors = [0x6ABF40, 0x7EC850, 0x5AAD35, 0x8FD45A];
                const grassPositions = generateGrassPositions(variant);
                grassPositions.forEach(pos => {
                    g.fillStyle(grassColors[pos.colorIdx], 0.6);
                    g.fillRect(pos.x, pos.y, pos.size, pos.size);
                });

                // Add small flowers/details (deterministic)
                const flowerColors = [0xFFD700, 0xFF6B6B, 0x87CEEB, 0xDDA0DD];
                const flowerPositions = generateFlowerPositions(variant);
                flowerPositions.forEach((pos, i) => {
                    g.fillStyle(flowerColors[(variant + i) % 4], 0.8);
                    g.fillCircle(pos.x, pos.y, 2);
                });

                // Decorative rocks/stones for some variants
                if (variant % 2 === 1) {
                    g.fillStyle(0x7A7A7A, 0.4);
                    const rockX = 15 + (variant * 10) % 40;
                    const rockY = 20 + (variant * 15) % 30;
                    g.fillCircle(rockX, rockY, 3);
                }

                // Soft grid line
                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            },
            forest: (g, variant) => {
                // Darker forest floor
                g.fillStyle(0x1A3D1A, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                // Ground texture - leaves and dirt (deterministic)
                for (let i = 0; i < 30; i++) {
                    const seed = variant * 3000 + i;
                    const x = Math.floor(seededRandom(seed) * 60);
                    const y = Math.floor(seededRandom(seed + 500) * 60);
                    const w = Math.floor(seededRandom(seed + 1000) * 3) + 3;
                    const h = Math.floor(seededRandom(seed + 1500) * 2) + 2;
                    g.fillStyle(0x0F2F0F, 0.5);
                    g.fillRect(x, y, w, h);
                }

                // Tree configurations per variant
                const treeConfigs = [
                    [{ x: 12, y: 18, scale: 1 }, { x: 38, y: 12, scale: 0.9 }, { x: 48, y: 38, scale: 1.1 }, { x: 20, y: 46, scale: 0.85 }],
                    [{ x: 15, y: 15, scale: 1.1 }, { x: 42, y: 20, scale: 0.8 }, { x: 28, y: 42, scale: 0.95 }, { x: 52, y: 35, scale: 0.9 }],
                    [{ x: 10, y: 22, scale: 0.9 }, { x: 35, y: 10, scale: 1 }, { x: 50, y: 28, scale: 1.05 }, { x: 22, y: 48, scale: 0.8 }],
                    [{ x: 18, y: 12, scale: 0.95 }, { x: 45, y: 18, scale: 1.1 }, { x: 32, y: 40, scale: 0.9 }, { x: 8, y: 35, scale: 0.85 }]
                ];

                const treePositions = treeConfigs[variant % 4];
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

                // Variant-specific: mushrooms for variant 0, fallen log for variant 2
                if (variant === 0) {
                    g.fillStyle(0xFFFFFF, 1);
                    g.fillCircle(52, 52, 3);
                    g.fillCircle(54, 50, 2);
                    g.fillStyle(0x8B4513, 1);
                    g.fillRect(52, 52, 2, 4);
                    g.fillRect(54, 50, 2, 3);
                } else if (variant === 2) {
                    g.fillStyle(0x5D4037, 1);
                    g.fillRect(8, 50, 20, 6);
                    g.fillStyle(0x4A3728, 1);
                    g.fillRect(8, 50, 18, 4);
                }

                // Soft grid
                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            },
            mountains: (g, variant) => {
                // Sky/background
                g.fillStyle(0xB8C4D0, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                // Mountain configurations per variant
                const mountainConfigs = [
                    [
                        { x1: 5, y1: 55, x2: 25, y2: 15, x3: 45, y3: 55, color: 0x6B7280, snowY: 22 },
                        { x1: 30, y1: 58, x2: 50, y2: 20, x3: 70, y3: 58, color: 0x5A636E, snowY: 26 }
                    ],
                    [
                        { x1: 8, y1: 52, x2: 30, y2: 12, x3: 48, y3: 52, color: 0x6B7280, snowY: 18 },
                        { x1: 35, y1: 60, x2: 55, y2: 18, x3: 75, y3: 60, color: 0x5A636E, snowY: 22 }
                    ],
                    [
                        { x1: 0, y1: 55, x2: 20, y2: 8, x3: 42, y3: 55, color: 0x6B7280, snowY: 15 },
                        { x1: 38, y1: 55, x2: 58, y2: 15, x3: 64, y3: 55, color: 0x5A636E, snowY: 20 }
                    ],
                    [
                        { x1: 10, y1: 58, x2: 32, y2: 20, x3: 50, y3: 58, color: 0x6B7280, snowY: 25 },
                        { x1: 42, y1: 55, x2: 62, y2: 10, x3: 72, y3: 55, color: 0x5A636E, snowY: 16 }
                    ]
                ];

                const peaks = mountainConfigs[variant % 4];

                peaks.forEach(peak => {
                    // Mountain shadow side
                    g.fillStyle(0x4A5560, 1);
                    g.fillTriangle(peak.x1 + 5, peak.y1 - 3, peak.x2 + 8, peak.y2 + 5, peak.x3, peak.y3);

                    // Main mountain
                    g.fillStyle(peak.color, 1);
                    g.fillTriangle(peak.x1, peak.y1, peak.x2, peak.y2, peak.x3, peak.y3);

                    // Snow cap
                    g.fillStyle(0xFFFFFF, 1);
                    g.fillTriangle(peak.x2 - 8, peak.snowY + 5, peak.x2, peak.y2, peak.x2 + 8, peak.snowY + 5);
                    // Snow detail
                    g.fillStyle(0xE8E8E8, 1);
                    g.fillTriangle(peak.x2 - 5, peak.snowY + 8, peak.x2, peak.y2 + 3, peak.x2 + 5, peak.snowY + 8);

                    // Rock details on mountain
                    g.fillStyle(0x3D4852, 0.6);
                    g.fillRect(peak.x2 - 3, peak.y2 + 15, 4, 6);
                    g.fillRect(peak.x2 + 6, peak.y2 + 20, 3, 4);
                });

                // Rocks at base - variant specific
                const rockConfigs = [
                    [{ x: 15, y: 58, r: 6 }, { x: 55, y: 60, r: 5 }, { x: 62, y: 58, r: 4 }],
                    [{ x: 12, y: 59, r: 5 }, { x: 48, y: 58, r: 6 }, { x: 58, y: 61, r: 4 }],
                    [{ x: 8, y: 57, r: 4 }, { x: 35, y: 59, r: 5 }, { x: 52, y: 58, r: 6 }],
                    [{ x: 18, y: 60, r: 5 }, { x: 42, y: 58, r: 4 }, { x: 60, y: 59, r: 5 }]
                ];
                const rocks = rockConfigs[variant % 4];
                g.fillStyle(0x5A636E, 1);
                rocks.forEach(rock => g.fillCircle(rock.x, rock.y, rock.r));

                // Grid
                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            },
            water: (g, variant) => {
                // Deep water base
                g.fillStyle(COLORS.water, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                // Water depth variation (deterministic)
                for (let i = 0; i < 15; i++) {
                    const seed = variant * 4000 + i;
                    const x = Math.floor(seededRandom(seed) * 60);
                    const y = Math.floor(seededRandom(seed + 500) * 60);
                    const w = Math.floor(seededRandom(seed + 1000) * 8) + 8;
                    const h = Math.floor(seededRandom(seed + 1500) * 4) + 4;
                    g.fillStyle(0x3A80C2, 0.4);
                    g.fillRect(x, y, w, h);
                }

                // Wave patterns - offset by variant
                const waveColors = [0x87CEEB, 0x5BA3D0, 0xA8D4F2];
                const waveOffset = variant * 3;
                for (let row = 0; row < 4; row++) {
                    const y = 12 + row * 14;
                    for (let i = 0; i < 5; i++) {
                        const x = 6 + i * 12 + ((row + waveOffset) % 2) * 6;
                        g.fillStyle(waveColors[(row + variant) % 3], 0.5);
                        g.fillRect(x, y, 8, 3);
                        // Wave highlight
                        g.fillStyle(0xFFFFFF, 0.3);
                        g.fillRect(x + 1, y - 1, 4, 2);
                    }
                }

                // Sparkles on water (deterministic)
                for (let i = 0; i < 6; i++) {
                    const seed = variant * 5000 + i;
                    const x = Math.floor(seededRandom(seed) * 48) + 8;
                    const y = Math.floor(seededRandom(seed + 500) * 48) + 8;
                    g.fillStyle(0xFFFFFF, 0.7);
                    g.fillRect(x, y, 2, 2);
                }

                // Grid
                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            }
        };

        // Create all terrain variants
        Object.entries(terrainVariants).forEach(([name, creator]) => {
            for (let v = 0; v < NUM_VARIANTS; v++) {
                this.renderer.createTexture(`${name}_${v}`, (g) => creator(g, v));
            }
        });

        // Unit textures - use full color scheme for details
        Object.keys(UNIT_DEFINITIONS).forEach(unitType => {
            COLORS.playerSchemes.forEach((scheme, idx) => {
                this.renderer.createTexture(`${unitType}_${idx}`, (g) => {
                    this.drawUnitSprite(g, unitType, scheme);
                });
            });
        });

        // City textures - use full color scheme
        ['small', 'medium', 'large'].forEach(size => {
            COLORS.playerSchemes.forEach((scheme, idx) => {
                this.renderer.createTexture(`city_${size}_${idx}`, (g) => {
                    this.drawCitySprite(g, size, scheme);
                });
            });
            // Neutral city with neutral scheme
            const neutralScheme = {
                primary: COLORS.neutral,
                secondary: COLORS.neutralSecondary,
                dark: COLORS.neutralDark
            };
            this.renderer.createTexture(`city_${size}_neutral`, (g) => {
                this.drawCitySprite(g, size, neutralScheme);
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

    drawUnitSprite(g, type, scheme) {
        const primary = scheme.primary;
        const secondary = scheme.secondary || 0xFFD700;
        const dark = scheme.dark || this.darken(primary, 30);
        const size = type === 'HERO' ? 22 : 18;
        const offset = (CONFIG.TILE_SIZE - size) / 2;
        const cx = offset + size / 2;
        const cy = offset + size / 2;

        // Multi-layer shadow for depth
        // Outer soft shadow
        g.fillStyle(0x000000, 0.15);
        g.fillEllipse(cx, offset + size - 1, size * 0.9, 7);
        // Inner darker shadow
        g.fillStyle(0x000000, 0.25);
        g.fillEllipse(cx, offset + size - 2, size * 0.7, 5);
        // Core shadow
        g.fillStyle(0x000000, 0.35);
        g.fillEllipse(cx, offset + size - 3, size * 0.5, 3);

        // Helper function to draw gradient body
        const drawBody = (x, y, w, h, color, shadowOffset = 3) => {
            // Shadow side
            g.fillStyle(this.darken(color, 25), 1);
            g.fillRect(x + 2, y + 2, w, h);
            // Main body with vertical gradient effect (simulated with two rects)
            g.fillStyle(color, 1);
            g.fillRect(x, y, w, h - shadowOffset);
            // Highlight on top
            g.fillStyle(this.lighten(color, 15), 0.7);
            g.fillRect(x + 1, y + 1, w - 2, 2);
        };

        if (type === 'LIGHT_INFANTRY') {
            // Body/legs with gradient
            drawBody(offset + 4, offset + 10, size - 8, size - 12, primary);
            // Belt/detail in secondary color
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 4, offset + 14, size - 8, 2);
            // Head
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(cx, offset + 6, 5);
            g.fillStyle(0xE8B89A, 1); // shadow on face
            g.fillCircle(cx + 2, offset + 8, 2);
            // Face
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 2, offset + 5, 1, 2);
            g.fillRect(cx + 1, offset + 5, 1, 2);
            // Spear with wood gradient
            g.fillStyle(0x6B4423, 1);
            g.fillRect(offset + size - 4, offset + 4, 3, size - 4);
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + size - 4, offset + 4, 2, size - 6);
            // Spear tip metallic
            g.fillStyle(0xC0C0C0, 1);
            g.fillRect(offset + size - 5, offset + 2, 5, 4);
            g.fillStyle(0xE8E8E8, 1);
            g.fillRect(offset + size - 4, offset + 2, 3, 2);
            // Shield with rim
            g.fillStyle(0x4A3728, 1);
            g.fillCircle(offset + 5, offset + 12, 5);
            g.fillStyle(primary, 1);
            g.fillCircle(offset + 5, offset + 12, 4);
            g.fillStyle(secondary, 1);
            g.fillCircle(offset + 5, offset + 12, 2);
        } else if (type === 'HEAVY_INFANTRY') {
            // Heavy armor body with gradient
            drawBody(offset + 2, offset + 8, size - 4, size - 10, primary, 4);
            // Armor plates with metallic look
            g.fillStyle(0x606060, 1);
            g.fillRect(offset + 4, offset + 10, size - 8, 4);
            g.fillStyle(0x808080, 1);
            g.fillRect(offset + 5, offset + 11, size - 10, 2);
            g.fillStyle(0x606060, 1);
            g.fillRect(offset + 4, offset + 16, size - 8, 4);
            g.fillStyle(0x808080, 1);
            g.fillRect(offset + 5, offset + 17, size - 10, 2);
            // Helmet with highlight
            g.fillStyle(0x707070, 1);
            g.fillRect(offset + 4, offset + 2, size - 8, 8);
            g.fillStyle(0x909090, 1);
            g.fillRect(offset + 5, offset + 3, size - 10, 3);
            // Crest in secondary color
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 6, offset, size - 12, 3);
            // Face slit
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 2, offset + 6, 4, 2);
            // Large shield with rim and emblem
            g.fillStyle(0x444444, 1);
            g.fillCircle(offset + 5, offset + 13, 6);
            g.fillStyle(primary, 1);
            g.fillCircle(offset + 5, offset + 13, 5);
            g.fillStyle(secondary, 1);
            g.fillCircle(offset + 5, offset + 13, 2);
            // Sword with metallic gradient
            g.fillStyle(0x808080, 1);
            g.fillRect(offset + size - 5, offset + 6, 4, 10);
            g.fillStyle(0xB0B0B0, 1);
            g.fillRect(offset + size - 4, offset + 6, 2, 10);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + size - 6, offset + 4, 6, 3);
        } else if (type === 'CAVALRY') {
            // Horse body with gradient
            g.fillStyle(0x6B3E23, 1);
            g.fillRect(offset + 4, offset + 8, size - 8, 8);
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + 4, offset + 8, size - 10, 6);
            // Horse head
            g.fillStyle(0x6B3E23, 1);
            g.fillRect(offset + 2, offset + 6, 6, 5);
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + 3, offset + 6, 4, 4);
            g.fillRect(offset, offset + 8, 3, 2);
            // Legs
            g.fillStyle(0x5A3A1A, 1);
            g.fillRect(offset + 5, offset + 14, 3, 4);
            g.fillRect(offset + size - 8, offset + 14, 3, 4);
            // Rider body
            drawBody(offset + 10, offset + 4, 6, 8, primary, 2);
            // Rider head
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(offset + 13, offset + 3, 3);
            // Lance
            g.fillStyle(0x5A3A1A, 1);
            g.fillRect(offset + 16, offset, 2, 14);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 15, offset - 2, 4, 4);
        } else if (type === 'ARCHER') {
            // Body with gradient
            drawBody(offset + 5, offset + 8, size - 10, size - 10, primary, 3);
            // Head with hood (secondary color)
            g.fillStyle(dark, 1);
            g.fillCircle(cx, offset + 6, 6);
            g.fillStyle(primary, 1);
            g.fillCircle(cx, offset + 6, 5);
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(cx, offset + 6, 4);
            // Face
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 1, offset + 5, 1, 2);
            g.fillRect(cx + 1, offset + 5, 1, 2);
            // Bow with wood gradient
            g.lineStyle(2, 0x6B4423);
            g.beginPath();
            g.arc(offset + 4, offset + 10, 7, -Math.PI / 2, Math.PI / 2);
            g.strokePath();
            // Bowstring
            g.lineStyle(1, 0xDDDDDD);
            g.beginPath();
            g.moveTo(offset + 4, offset + 3);
            g.lineTo(offset + 4, offset + 17);
            g.strokePath();
            // Arrow with fletching in secondary
            g.fillStyle(0x5A3A1A, 1);
            g.fillRect(offset + 8, offset + 8, 8, 2);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 14, offset + 6, 2, 6);
        } else if (type === 'CATAPULT') {
            // Wooden base with grain effect
            g.fillStyle(0x5A3A1A, 1);
            g.fillRect(offset + 2, offset + 12, size - 4, 6);
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + 2, offset + 12, size - 6, 4);
            // Wheels with rim
            g.fillStyle(0x3A2A1A, 1);
            g.fillCircle(offset + 6, offset + 16, 4);
            g.fillCircle(offset + size - 6, offset + 16, 4);
            g.fillStyle(0x5A4A3A, 1);
            g.fillCircle(offset + 6, offset + 16, 3);
            g.fillCircle(offset + size - 6, offset + 16, 3);
            // Frame
            g.fillStyle(0x6B4423, 1);
            g.fillRect(offset + 4, offset + 8, 4, 8);
            g.fillRect(offset + size - 8, offset + 8, 4, 8);
            g.fillRect(offset + 4, offset + 6, size - 8, 3);
            // Throwing arm
            g.fillStyle(0x5A3A1A, 1);
            g.fillRect(offset + 8, offset + 4, 3, 10);
            // Rope/basket
            g.fillStyle(0x4A3728, 1);
            g.fillRect(offset + 6, offset + 2, 7, 4);
            // Projectile (stone)
            g.fillStyle(0x444444, 1);
            g.fillCircle(offset + size - 6, offset + 8, 3);
            g.fillStyle(0x666666, 1);
            g.fillCircle(offset + size - 6, offset + 7, 2);
        } else if (type === 'DRAGON') {
            // Dragon body with gradient
            g.fillStyle(0x990000, 1);
            g.fillRect(offset + 8, offset + 10, 10, 6);
            g.fillStyle(0xCC0000, 1);
            g.fillRect(offset + 8, offset + 10, 8, 4);
            // Wings with membrane gradient
            g.fillStyle(0x770000, 1);
            g.fillTriangle(offset + 4, offset + 10, offset + 2, offset + 2, offset + 10, offset + 8);
            g.fillTriangle(offset + size - 4, offset + 10, offset + size - 2, offset + 2, offset + size - 10, offset + 8);
            // Wing membranes in secondary (gold highlights)
            g.fillStyle(secondary, 0.5);
            g.fillTriangle(offset + 4, offset + 9, offset + 3, offset + 4, offset + 8, offset + 8);
            g.fillTriangle(offset + size - 4, offset + 9, offset + size - 3, offset + 4, offset + size - 8, offset + 8);
            // Head with gradient
            g.fillStyle(0x990000, 1);
            g.fillRect(offset + 2, offset + 8, 8, 6);
            g.fillStyle(0xCC0000, 1);
            g.fillRect(offset + 3, offset + 8, 6, 4);
            g.fillRect(offset, offset + 9, 3, 3);
            // Eye (glowing)
            g.fillStyle(0xFFFF00, 1);
            g.fillCircle(offset + 4, offset + 10, 2);
            g.fillStyle(0xFFFFFF, 0.8);
            g.fillCircle(offset + 3, offset + 9, 1);
            g.fillStyle(0x000000, 1);
            g.fillCircle(offset + 4, offset + 10, 1);
            // Fire breath effect (animated look with layers)
            g.fillStyle(0xFF4400, 0.9);
            g.fillRect(offset - 5, offset + 9, 5, 3);
            g.fillStyle(0xFF8800, 0.8);
            g.fillRect(offset - 4, offset + 9, 4, 3);
            g.fillStyle(0xFFFF00, 0.9);
            g.fillRect(offset - 3, offset + 9, 3, 3);
            // Tail
            g.fillStyle(0x770000, 1);
            g.fillRect(offset + size - 4, offset + 12, 4, 4);
            // Spikes on back (secondary color)
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 10, offset + 6, 2, 4);
            g.fillRect(offset + 14, offset + 7, 2, 3);
        } else if (type === 'HERO') {
            // Hero is larger and more detailed
            // Cape/cloak with shadow
            g.fillStyle(dark, 1);
            g.fillRect(offset + 4, offset + 10, size - 8, size - 12);
            g.fillStyle(primary, 1);
            g.fillRect(offset + 5, offset + 10, size - 10, size - 14);
            // Body armor with highlight
            g.fillStyle(primary, 1);
            g.fillRect(offset + 6, offset + 8, size - 12, 10);
            g.fillStyle(this.lighten(primary, 20), 1);
            g.fillRect(offset + 7, offset + 9, size - 14, 4);
            // Decorative chest plate in secondary
            g.fillStyle(secondary, 1);
            g.fillRect(cx - 2, offset + 10, 4, 6);
            g.fillStyle(0xFFFFFF, 0.6);
            g.fillRect(cx - 1, offset + 11, 2, 2);
            // Crown/helmet with gradient
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 6, offset + 2, size - 12, 6);
            g.fillStyle(0xFFE44D, 1);
            g.fillRect(offset + 7, offset + 3, size - 14, 3);
            // Crown spikes
            g.fillRect(offset + 4, offset - 2, 3, 5);
            g.fillRect(cx - 1, offset - 4, 3, 6);
            g.fillRect(offset + size - 7, offset - 2, 3, 5);
            // Face with shading
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(cx, offset + 7, 4);
            g.fillStyle(0xE8B89A, 1);
            g.fillCircle(cx + 1, offset + 8, 2);
            // Eyes
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 2, offset + 6, 1, 2);
            g.fillRect(cx + 1, offset + 6, 1, 2);
            // Sword with metallic gradient
            g.fillStyle(0xA0A0A0, 1);
            g.fillRect(offset + size - 6, offset + 6, 4, 12);
            g.fillStyle(0xE0E0E0, 1);
            g.fillRect(offset + size - 5, offset + 6, 2, 12);
            // Guard in secondary
            g.fillStyle(secondary, 1);
            g.fillRect(offset + size - 7, offset + 6, 6, 3);
            g.fillStyle(0xFFE44D, 1);
            g.fillRect(offset + size - 6, offset + 6, 4, 2);
            // Pommel
            g.fillRect(offset + size - 6, offset + 2, 4, 4);
            // Shield with rim and emblem
            g.fillStyle(0x333333, 1);
            g.fillCircle(offset + 6, offset + 14, 5);
            g.fillStyle(primary, 1);
            g.fillCircle(offset + 6, offset + 14, 4);
            g.fillStyle(secondary, 1);
            g.fillCircle(offset + 6, offset + 14, 2);
        }
    }

    // Helper functions for color manipulation
    darken(color, percent) {
        const r = Math.max(0, ((color >> 16) & 0xFF) * (100 - percent) / 100);
        const g = Math.max(0, ((color >> 8) & 0xFF) * (100 - percent) / 100);
        const b = Math.max(0, (color & 0xFF) * (100 - percent) / 100);
        return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    }

    lighten(color, percent) {
        const r = Math.min(255, ((color >> 16) & 0xFF) * (100 + percent) / 100);
        const g = Math.min(255, ((color >> 8) & 0xFF) * (100 + percent) / 100);
        const b = Math.min(255, (color & 0xFF) * (100 + percent) / 100);
        return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    }

    drawCitySprite(g, size, scheme) {
        const primary = scheme.primary;
        const secondary = scheme.secondary || 0xFFD700;
        const dark = scheme.dark || this.darken(primary, 30);

        // Flag waving above city with secondary color accent
        const drawFlag = (fx, fy) => {
            // Flag pole
            g.fillStyle(0x6B4423, 1);
            g.fillRect(fx, fy, 2, 14);
            // Flag cloth (primary)
            g.fillStyle(primary, 1);
            g.fillRect(fx + 2, fy, 10, 7);
            // Flag secondary stripe
            g.fillStyle(secondary, 1);
            g.fillRect(fx + 2, fy + 2, 10, 3);
            // Flag highlight
            g.fillStyle(0xFFFFFF, 0.4);
            g.fillRect(fx + 3, fy + 1, 3, 2);
        };

        if (size === 'small') {
            const ox = (CONFIG.TILE_SIZE - 36) / 2;
            const oy = (CONFIG.TILE_SIZE - 28) / 2 + 4;

            // Base/foundation with shadow
            g.fillStyle(0x4A3A2A, 1);
            g.fillRect(ox + 1, oy + 21, 36, 7);
            g.fillStyle(0x5A4A3A, 1);
            g.fillRect(ox, oy + 20, 36, 8);

            // Main building with gradient effect
            g.fillStyle(dark, 1);
            g.fillRect(ox + 6, oy + 10, 24, 14);
            g.fillStyle(primary, 1);
            g.fillRect(ox + 6, oy + 10, 22, 12);
            // Highlight
            g.fillStyle(this.lighten(primary, 15), 0.5);
            g.fillRect(ox + 8, oy + 11, 18, 3);

            // Roof with highlight
            g.fillStyle(0x3A3A3A, 1);
            g.fillTriangle(ox, oy + 10, ox + 18, oy - 2, ox + 36, oy + 10);
            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox + 2, oy + 10, ox + 18, oy, ox + 34, oy + 10);
            g.fillStyle(0x5A5A5A, 1);
            g.fillTriangle(ox + 8, oy + 10, ox + 18, oy + 2, ox + 28, oy + 10);

            // Door with frame
            g.fillStyle(0x2D1F0F, 1);
            g.fillRect(ox + 14, oy + 16, 8, 8);
            g.fillStyle(0x3D2817, 1);
            g.fillRect(ox + 14, oy + 16, 8, 7);
            // Door frame
            g.fillStyle(0x5A4A3A, 1);
            g.fillRect(ox + 13, oy + 15, 10, 1);
            g.fillRect(ox + 13, oy + 15, 1, 9);
            g.fillRect(ox + 22, oy + 15, 1, 9);

            // Windows with warm light
            g.fillStyle(0xFFD700, 1);
            g.fillRect(ox + 10, oy + 12, 4, 4);
            g.fillRect(ox + 22, oy + 12, 4, 4);
            g.fillStyle(0x87CEEB, 0.7);
            g.fillRect(ox + 11, oy + 13, 2, 2);
            g.fillRect(ox + 23, oy + 13, 2, 2);
            // Window frames
            g.fillStyle(0x2C1810, 1);
            g.fillRect(ox + 11, oy + 13, 2, 2);
            g.fillRect(ox + 23, oy + 13, 2, 2);

            // Chimney
            g.fillStyle(0x3A3A3A, 1);
            g.fillRect(ox + 26, oy + 4, 4, 8);
            // Smoke (multiple layers for depth)
            g.fillStyle(0x888888, 0.4);
            g.fillCircle(ox + 29, oy - 2, 4);
            g.fillStyle(0xAAAAAA, 0.5);
            g.fillCircle(ox + 28, oy, 3);
            g.fillStyle(0xCCCCCC, 0.6);
            g.fillCircle(ox + 30, oy - 3, 2);

            // Flag
            drawFlag(ox + 28, oy - 12);

        } else if (size === 'medium') {
            const ox = (CONFIG.TILE_SIZE - 44) / 2;
            const oy = (CONFIG.TILE_SIZE - 36) / 2 + 2;

            // Town wall base with shadow
            g.fillStyle(0x4A4A4A, 1);
            g.fillRect(ox + 1, oy + 27, 44, 7);
            g.fillStyle(0x5A4A3A, 1);
            g.fillRect(ox, oy + 26, 44, 8);
            // Crenellations
            for (let i = 0; i < 5; i++) {
                g.fillStyle(0x4A4A4A, 1);
                g.fillRect(ox + i * 9, oy + 25, 5, 3);
                g.fillStyle(0x5A4A3A, 1);
                g.fillRect(ox + i * 9, oy + 24, 5, 3);
            }

            // Left building with gradient
            g.fillStyle(dark, 1);
            g.fillRect(ox + 4, oy + 14, 14, 14);
            g.fillStyle(primary, 1);
            g.fillRect(ox + 4, oy + 14, 12, 12);
            // Left roof
            g.fillStyle(0x3A3A3A, 1);
            g.fillTriangle(ox + 2, oy + 14, ox + 11, oy + 4, ox + 20, oy + 14);
            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox + 4, oy + 14, ox + 11, oy + 6, ox + 18, oy + 14);

            // Right building with gradient
            g.fillStyle(dark, 1);
            g.fillRect(ox + 26, oy + 12, 14, 16);
            g.fillStyle(primary, 1);
            g.fillRect(ox + 26, oy + 12, 12, 14);
            // Right roof
            g.fillStyle(0x3A3A3A, 1);
            g.fillTriangle(ox + 24, oy + 12, ox + 33, oy + 2, ox + 42, oy + 12);
            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox + 26, oy + 12, ox + 33, oy + 4, ox + 40, oy + 12);

            // Center tower with stone texture
            g.fillStyle(0x5A5A5A, 1);
            g.fillRect(ox + 16, oy + 8, 12, 20);
            g.fillStyle(0x6A6A6A, 1);
            for (let i = 0; i < 2; i++) {
                for (let j = 0; j < 3; j++) {
                    g.fillRect(ox + 17 + i * 5, oy + 10 + j * 6, 4, 4);
                }
            }
            // Tower roof (cone)
            g.fillStyle(0x2A2A2A, 1);
            g.fillTriangle(ox + 14, oy + 8, ox + 22, oy - 4, ox + 30, oy + 8);
            g.fillStyle(0x3A3A3A, 1);
            g.fillTriangle(ox + 16, oy + 8, ox + 22, oy - 2, ox + 28, oy + 8);

            // Tower window with glow
            g.fillStyle(0xFFA500, 1);
            g.fillCircle(ox + 22, oy + 16, 3);
            g.fillStyle(0xFFD700, 0.8);
            g.fillCircle(ox + 22, oy + 16, 2);

            // Main gate
            g.fillStyle(0x2D1F0F, 1);
            g.fillRect(ox + 18, oy + 22, 8, 10);
            g.fillStyle(0x3D2817, 1);
            g.fillRect(ox + 18, oy + 22, 8, 9);
            // Gate arch
            g.fillStyle(0x5A4A3A, 1);
            g.fillRect(ox + 16, oy + 20, 12, 2);

            // Flags
            drawFlag(ox + 8, oy);
            drawFlag(ox + 34, oy - 2);

        } else if (size === 'large') {
            const ox = (CONFIG.TILE_SIZE - 52) / 2;
            const oy = (CONFIG.TILE_SIZE - 44) / 2;

            // Fortress walls with stone texture
            g.fillStyle(0x3A3A3A, 1);
            g.fillRect(ox, oy + 21, 52, 23);
            g.fillStyle(0x4A4A4A, 1);
            g.fillRect(ox, oy + 20, 52, 24);
            // Stone texture on walls
            for (let i = 0; i < 6; i++) {
                for (let j = 0; j < 3; j++) {
                    g.fillStyle(0x5A5A5A, 1);
                    g.fillRect(ox + 2 + i * 8, oy + 22 + j * 7, 6, 5);
                    g.fillStyle(0x6A6A6A, 1);
                    g.fillRect(ox + 3 + i * 8, oy + 23 + j * 7, 4, 3);
                }
            }

            // Corner towers with primary color and stone details
            // Left tower
            g.fillStyle(dark, 1);
            g.fillRect(ox, oy + 8, 14, 36);
            g.fillStyle(primary, 1);
            g.fillRect(ox, oy + 8, 12, 34);
            // Stone details
            g.fillStyle(0x5A5A5A, 1);
            g.fillRect(ox + 2, oy + 12, 8, 4);
            g.fillRect(ox + 2, oy + 24, 8, 4);
            g.fillRect(ox + 2, oy + 36, 8, 4);
            // Tower roof
            g.fillStyle(0x2A2A2A, 1);
            g.fillTriangle(ox - 2, oy + 8, ox + 7, oy - 6, ox + 16, oy + 8);
            g.fillStyle(0x3A3A3A, 1);
            g.fillTriangle(ox, oy + 8, ox + 7, oy - 4, ox + 14, oy + 8);

            // Right tower
            g.fillStyle(dark, 1);
            g.fillRect(ox + 38, oy + 8, 14, 36);
            g.fillStyle(primary, 1);
            g.fillRect(ox + 40, oy + 8, 12, 34);
            // Stone details
            g.fillStyle(0x5A5A5A, 1);
            g.fillRect(ox + 42, oy + 12, 8, 4);
            g.fillRect(ox + 42, oy + 24, 8, 4);
            g.fillRect(ox + 42, oy + 36, 8, 4);
            // Tower roof
            g.fillStyle(0x2A2A2A, 1);
            g.fillTriangle(ox + 36, oy + 8, ox + 45, oy - 6, ox + 54, oy + 8);
            g.fillStyle(0x3A3A3A, 1);
            g.fillTriangle(ox + 38, oy + 8, ox + 45, oy - 4, ox + 52, oy + 8);

            // Keep (center building)
            g.fillStyle(dark, 1);
            g.fillRect(ox + 16, oy + 12, 20, 32);
            g.fillStyle(primary, 1);
            g.fillRect(ox + 18, oy + 12, 16, 30);
            // Stone stripes on keep
            g.fillStyle(0x5A5A5A, 1);
            g.fillRect(ox + 20, oy + 14, 12, 3);
            g.fillRect(ox + 20, oy + 28, 12, 3);
            // Keep roof
            g.fillStyle(0x2A2A2A, 1);
            g.fillTriangle(ox + 14, oy + 12, ox + 26, oy - 8, ox + 38, oy + 12);
            g.fillStyle(0x3A3A3A, 1);
            g.fillTriangle(ox + 16, oy + 12, ox + 26, oy - 6, ox + 36, oy + 12);

            // Windows with warm light
            g.fillStyle(0xFF8800, 1);
            // Left tower windows
            g.fillRect(ox + 4, oy + 20, 4, 6);
            g.fillRect(ox + 4, oy + 30, 4, 6);
            // Right tower windows
            g.fillRect(ox + 44, oy + 20, 4, 6);
            g.fillRect(ox + 44, oy + 30, 4, 6);
            // Keep windows
            g.fillRect(ox + 20, oy + 24, 4, 6);
            g.fillRect(ox + 28, oy + 24, 4, 6);
            // Window glow
            g.fillStyle(0xFFD700, 0.7);
            g.fillRect(ox + 5, oy + 21, 2, 4);
            g.fillRect(ox + 5, oy + 31, 2, 4);
            g.fillRect(ox + 45, oy + 21, 2, 4);
            g.fillRect(ox + 45, oy + 31, 2, 4);

            // Main gate (portcullis)
            g.fillStyle(0x1A1A1A, 1);
            g.fillRect(ox + 20, oy + 33, 12, 11);
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
            g.fillStyle(primary, 1);
            g.fillRect(ox + 24, oy - 6, 4, 10);
            g.fillStyle(secondary, 1);
            g.fillRect(ox + 25, oy - 4, 2, 6);
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

            // Place hero adjacent to city (1 unit per tile limit)
            const heroX = pos.x + 1;
            const heroY = pos.y;
            const hero = new Unit('HERO', player.id, heroX, heroY);
            this.map.units.push(hero);
            player.units.push(hero);

            // Place light infantry at other positions around the city
            const unitPositions = [
                { x: pos.x - 1, y: pos.y },
                { x: pos.x, y: pos.y + 1 },
                { x: pos.x, y: pos.y - 1 }
            ];

            let unitsPlaced = 0;
            for (const p of unitPositions) {
                if (unitsPlaced >= 2) break;
                if (this.map.isValid(p.x, p.y)) {
                    // Ensure we don't place on hero's position
                    if (p.x !== heroX || p.y !== heroY) {
                        this.map.terrain[p.y][p.x] = TERRAIN.PLAINS;
                        const li = new Unit('LIGHT_INFANTRY', player.id, p.x, p.y);
                        this.map.units.push(li);
                        player.units.push(li);
                        unitsPlaced++;
                    }
                }
            }
        });
    }

    setupNeutralCities(mapWidth, mapHeight, numCities = null) {
        // Use provided value or scale with map size
        let numNeutral;
        if (numCities !== undefined && numCities !== null) {
            numNeutral = numCities;
        } else {
            const areaRatio = (mapWidth * mapHeight) / (CONFIG.MAP_WIDTH * CONFIG.MAP_HEIGHT);
            // Increased base count for sector-based distribution (was 6-10)
            numNeutral = Math.floor(Utils.randomInt(10, 16) * areaRatio);
        }

        // Sector-based placement for fairness
        const numPlayers = this.players.length;
        const sectorCities = Math.floor(numNeutral * 0.6); // 60% evenly distributed
        const contestedCities = numNeutral - sectorCities; // 40% in center for competition

        // Each sector gets equal number of cities
        const perSector = Math.max(1, Math.floor(sectorCities / numPlayers));

        // Place cities in each player's sector
        for (let playerIdx = 0; playerIdx < numPlayers; playerIdx++) {
            const sector = this.getPlayerSector(playerIdx, mapWidth, mapHeight);
            this.placeCitiesInSector(sector, perSector, playerIdx, mapWidth, mapHeight);
        }

        // Place contested cities in the center
        const centerSector = this.getCenterSector(mapWidth, mapHeight);
        this.placeCitiesInSector(centerSector, contestedCities, null, mapWidth, mapHeight);
    }

    /**
     * Get sector bounds for a player's starting corner
     */
    getPlayerSector(playerIdx, mapWidth, mapHeight) {
        const margin = 3; // Margin from edges
        const centerX = Math.floor(mapWidth / 2);
        const centerY = Math.floor(mapHeight / 2);

        // Define sectors based on starting corners
        const sectors = [
            { x1: margin, y1: margin, x2: centerX - 1, y2: centerY - 1 }, // Top-left (P1)
            { x1: margin, y1: centerY, x2: centerX - 1, y2: mapHeight - margin - 1 }, // Bottom-left (P2)
            { x1: centerX, y1: centerY, x2: mapWidth - margin - 1, y2: mapHeight - margin - 1 }, // Bottom-right (P3)
            { x1: centerX, y1: margin, x2: mapWidth - margin - 1, y2: centerY - 1 } // Top-right (P4)
        ];

        return sectors[playerIdx] || sectors[0];
    }

    /**
     * Get center sector for contested resources
     */
    getCenterSector(mapWidth, mapHeight) {
        const marginX = Math.floor(mapWidth * 0.25);
        const marginY = Math.floor(mapHeight * 0.25);
        return {
            x1: marginX,
            y1: marginY,
            x2: mapWidth - marginX - 1,
            y2: mapHeight - marginY - 1
        };
    }

    /**
     * Place cities in a sector with smart positioning
     */
    placeCitiesInSector(sector, count, preferredPlayerIdx, mapWidth, mapHeight) {
        const sizes = ['small', 'medium', 'medium', 'large']; // Weighted toward medium
        const minDistFromStart = 5; // Minimum distance from starting city
        const minDistBetweenCities = 4; // Minimum distance between neutral cities

        for (let i = 0; i < count; i++) {
            let bestPos = null;
            let bestScore = -Infinity;

            // Try multiple positions and pick the best one
            for (let attempt = 0; attempt < 50; attempt++) {
                const x = Utils.randomInt(sector.x1, sector.x2);
                const y = Utils.randomInt(sector.y1, sector.y2);

                // Basic validation
                if (!this.isValidCityPosition(x, y)) continue;

                // Score this position
                const score = this.evaluateCityPosition(x, y, preferredPlayerIdx, minDistFromStart, minDistBetweenCities);

                if (score > bestScore) {
                    bestScore = score;
                    bestPos = { x, y };
                }
            }

            if (bestPos && bestScore > 0) {
                // Weighted size selection
                const size = this.weightedRandom(sizes, [0.25, 0.40, 0.25, 0.10]);
                this.map.addCity(new City(bestPos.x, bestPos.y, size, null));
            }
        }
    }

    /**
     * Check if position is valid for a city
     */
    isValidCityPosition(x, y) {
        if (this.map.getCity(x, y)) return false;
        if (this.map.getRuin(x, y)) return false;
        if (this.map.getTerrain(x, y) === TERRAIN.WATER) return false;
        return true;
    }

    /**
     * Evaluate city position score (higher = better)
     */
    evaluateCityPosition(x, y, preferredPlayerIdx, minDistFromStart, minDistBetweenCities) {
        let score = 100; // Base score

        // Distance from all starting positions
        const startPositions = [
            { x: 1, y: 1 }, // P1
            { x: this.map.width - 2, y: 1 }, // P2 - wait, need to check actual corners
            { x: 1, y: this.map.height - 2 },
            { x: this.map.width - 2, y: this.map.height - 2 }
        ];

        // Get actual start positions from setupInitialPositions
        const corners = [
            { x: 1, y: 1 },
            { x: this.map.width - 2, y: this.map.height - 2 },
            { x: 1, y: this.map.height - 2 },
            { x: this.map.width - 2, y: 1 }
        ];

        for (let i = 0; i < this.players.length; i++) {
            const start = corners[i];
            if (!start) continue;

            const dist = Utils.manhattanDistance(x, y, start.x, start.y);

            if (i === preferredPlayerIdx) {
                // For preferred player: optimal distance is 5-10 tiles
                if (dist < minDistFromStart) {
                    score -= 200; // Too close - big penalty
                } else if (dist >= 5 && dist <= 10) {
                    score += 50; // Ideal range
                } else if (dist > 10 && dist <= 15) {
                    score += 20; // Good range
                } else {
                    score -= 10; // Too far
                }
            } else {
                // For other players: farther is better
                if (dist < minDistFromStart) {
                    score -= 30; // Too close to their start
                } else if (dist >= 8) {
                    score += 10; // Good, far from their reach
                }
            }
        }

        // Distance from other cities
        for (const city of this.map.cities) {
            const dist = Utils.manhattanDistance(x, y, city.x, city.y);
            if (dist < minDistBetweenCities) {
                score -= 100; // Too close to existing city
            } else if (dist >= 4 && dist <= 8) {
                score += 15; // Good spacing for strategic play
            }
        }

        // Check terrain accessibility
        const accessibleTiles = this.countAccessibleTiles(x, y, 3);
        score += accessibleTiles * 3;

        // Prefer plains for accessibility
        const terrain = this.map.getTerrain(x, y);
        if (terrain === TERRAIN.PLAINS) score += 10;
        if (terrain === TERRAIN.FOREST) score += 5;
        if (terrain === TERRAIN.MOUNTAINS) score -= 5;

        // Ruins nearby = bonus (synergy of interest)
        const nearbyRuin = this.map.ruins.find(r =>
            Utils.manhattanDistance(x, y, r.x, r.y) <= 4
        );
        if (nearbyRuin) score += 20;

        return score;
    }

    /**
     * Count accessible (non-water) tiles within radius
     */
    countAccessibleTiles(centerX, centerY, radius) {
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = centerX + dx;
                const y = centerY + dy;
                if (this.map.isValid(x, y) && this.map.getTerrain(x, y) !== TERRAIN.WATER) {
                    count++;
                }
            }
        }
        return count;
    }

    /**
     * Weighted random selection from array
     */
    weightedRandom(items, weights) {
        const total = weights.reduce((a, b) => a + b, 0);
        let random = Math.random() * total;
        for (let i = 0; i < items.length; i++) {
            random -= weights[i];
            if (random <= 0) return items[i];
        }
        return items[items.length - 1];
    }

    setupRuins(mapWidth, mapHeight, numRuins = null) {
        // Use provided value or scale with map size
        let actualNumRuins;
        if (numRuins !== undefined && numRuins !== null) {
            actualNumRuins = numRuins;
        } else {
            const areaRatio = (mapWidth * mapHeight) / (CONFIG.MAP_WIDTH * CONFIG.MAP_HEIGHT);
            // Increased base count for strategic path placement (was 6-10)
            actualNumRuins = Math.floor(Utils.randomInt(10, 16) * areaRatio);
        }

        // 50% of ruins on strategic paths between important locations
        const pathRuins = Math.floor(actualNumRuins * 0.5);
        const scatterRuins = actualNumRuins - pathRuins;

        // Find key paths and place ruins along them
        const paths = this.findKeyPaths();
        this.placeRuinsOnPaths(paths, pathRuins);

        // Scatter remaining ruins evenly
        this.scatterRemainingRuins(scatterRuins, mapWidth, mapHeight);
    }

    /**
     * Find key strategic paths (start -> nearest cities, between cities)
     */
    findKeyPaths() {
        const paths = [];
        const corners = [
            { x: 1, y: 1 },
            { x: this.map.width - 2, y: this.map.height - 2 },
            { x: 1, y: this.map.height - 2 },
            { x: this.map.width - 2, y: 1 }
        ];
        const neutralCities = this.map.cities.filter(c => c.owner === null);

        // Path from each start to nearest 2 neutral cities
        for (let i = 0; i < this.players.length; i++) {
            const start = corners[i];
            if (!start) continue;

            // Find nearest neutral cities by distance
            const nearest = neutralCities
                .map(c => ({
                    city: c,
                    dist: Utils.manhattanDistance(start.x, start.y, c.x, c.y)
                }))
                .filter(item => item.dist >= 5) // Not too close
                .sort((a, b) => a.dist - b.dist)
                .slice(0, 2);

            for (const { city } of nearest) {
                paths.push({ from: start, to: city, type: 'expansion' });
            }
        }

        // Paths between neutral cities (trade routes)
        for (let i = 0; i < neutralCities.length; i++) {
            for (let j = i + 1; j < neutralCities.length; j++) {
                const dist = Utils.manhattanDistance(
                    neutralCities[i].x, neutralCities[i].y,
                    neutralCities[j].x, neutralCities[j].y
                );
                // Only connect cities at reasonable distance
                if (dist >= 5 && dist <= 12) {
                    paths.push({
                        from: neutralCities[i],
                        to: neutralCities[j],
                        type: 'trade'
                    });
                }
            }
        }

        // Shuffle paths to add variety
        return paths.sort(() => Math.random() - 0.5);
    }

    /**
     * Place ruins along strategic paths
     */
    placeRuinsOnPaths(paths, count) {
        let placed = 0;

        for (let i = 0; i < paths.length && placed < count; i++) {
            const path = paths[i];

            // Calculate position ~60% along the path (creates "checkpoint" feel)
            // Add some randomness so they're not perfectly predictable
            const t = 0.5 + (Math.random() * 0.3 - 0.15); // 35% - 65%

            const x = Math.round(path.from.x + (path.to.x - path.from.x) * t);
            const y = Math.round(path.from.y + (path.to.y - path.from.y) * t);

            // Try to find valid position near the calculated point
            const pos = this.findValidRuinPosition(x, y);
            if (pos) {
                this.map.addRuin(pos.x, pos.y);
                placed++;
            }
        }
    }

    /**
     * Find valid position for a ruin near target coordinates
     */
    findValidRuinPosition(targetX, targetY, searchRadius = 3) {
        // Try the target position first
        if (this.isValidRuinPosition(targetX, targetY)) {
            return { x: targetX, y: targetY };
        }

        // Search in expanding radius
        for (let r = 1; r <= searchRadius; r++) {
            const candidates = [];
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) + Math.abs(dy) !== r) continue; // Only check ring

                    const x = targetX + dx;
                    const y = targetY + dy;
                    if (this.isValidRuinPosition(x, y)) {
                        candidates.push({ x, y, dist: Math.abs(dx) + Math.abs(dy) });
                    }
                }
            }

            if (candidates.length > 0) {
                // Pick closest valid position
                candidates.sort((a, b) => a.dist - b.dist);
                return candidates[0];
            }
        }

        return null;
    }

    /**
     * Check if position is valid for a ruin
     */
    isValidRuinPosition(x, y) {
        if (!this.map.isValid(x, y)) return false;
        if (this.map.getCity(x, y)) return false;
        if (this.map.getRuin(x, y)) return false;
        if (this.map.getTerrain(x, y) === TERRAIN.WATER) return false;

        // Don't place too close to starting positions
        const corners = [
            { x: 1, y: 1 },
            { x: this.map.width - 2, y: this.map.height - 2 },
            { x: 1, y: this.map.height - 2 },
            { x: this.map.width - 2, y: 1 }
        ];

        for (const start of corners) {
            const dist = Utils.manhattanDistance(x, y, start.x, start.y);
            if (dist < 3) return false;
        }

        return true;
    }

    /**
     * Scatter remaining ruins evenly across the map
     */
    scatterRemainingRuins(count, mapWidth, mapHeight) {
        // Divide map into regions for even distribution
        const numPlayers = this.players.length || 4;
        const regions = [];

        for (let i = 0; i < numPlayers; i++) {
            regions.push(this.getPlayerSector(i, mapWidth, mapHeight));
        }

        const perRegion = Math.floor(count / regions.length);
        const remainder = count % regions.length;

        for (let i = 0; i < regions.length; i++) {
            const region = regions[i];
            const toPlace = perRegion + (i < remainder ? 1 : 0);

            for (let j = 0; j < toPlace; j++) {
                // Try multiple positions in this region
                let bestPos = null;
                let bestScore = -Infinity;

                for (let attempt = 0; attempt < 30; attempt++) {
                    const x = Utils.randomInt(region.x1, region.x2);
                    const y = Utils.randomInt(region.y1, region.y2);

                    if (!this.isValidRuinPosition(x, y)) continue;

                    // Score based on distance from other ruins (spread them out)
                    let score = 100;
                    for (const ruin of this.map.ruins) {
                        const dist = Utils.manhattanDistance(x, y, ruin.x, ruin.y);
                        if (dist < 3) score -= 50;
                        else if (dist > 6) score += 5;
                    }

                    // Prefer accessible terrain
                    const accessible = this.countAccessibleTiles(x, y, 2);
                    score += accessible * 2;

                    if (score > bestScore) {
                        bestScore = score;
                        bestPos = { x, y };
                    }
                }

                if (bestPos) {
                    this.map.addRuin(bestPos.x, bestPos.y);
                }
            }
        }
    }

    /**
     * Balance terrain distribution between player sectors for fairness
     * Ensures each player has similar terrain composition
     */
    balanceTerrainForFairness(mapWidth, mapHeight) {
        const numPlayers = 4; // Always check all 4 potential sectors
        const targetForestRatio = 0.20; // ~20% forest per sector
        const targetMountainRatio = 0.15; // ~15% mountains per sector
        const tolerance = 0.05; // 5% tolerance

        // Analyze each sector
        const sectorStats = [];
        for (let i = 0; i < numPlayers; i++) {
            const sector = this.getPlayerSector(i, mapWidth, mapHeight);
            const stats = this.analyzeSectorTerrain(sector);
            sectorStats.push({ sector, stats });
        }

        // Find average ratios
        const avgForest = sectorStats.reduce((s, data) => s + data.stats.forestRatio, 0) / numPlayers;
        const avgMountains = sectorStats.reduce((s, data) => s + data.stats.mountainRatio, 0) / numPlayers;

        // Balance sectors that are too far from average
        for (const { sector, stats } of sectorStats) {
            // If this sector has too little forest, add some
            if (stats.forestRatio < avgForest - tolerance) {
                const neededTiles = Math.floor(stats.total * (avgForest - stats.forestRatio));
                this.addTerrainToSector(sector, TERRAIN.FOREST, neededTiles);
            }

            // If this sector has too little mountains, add some
            if (stats.mountainRatio < avgMountains - tolerance) {
                const neededTiles = Math.floor(stats.total * (avgMountains - stats.mountainRatio));
                this.addTerrainToSector(sector, TERRAIN.MOUNTAINS, neededTiles);
            }

            // Ensure each sector has minimal water access
            if (stats.waterCount < 2) {
                // Add a small water patch near the edge
                this.addWaterToSector(sector);
            }
        }

        // Ensure starting positions (corners) are always plains
        const corners = [
            { x: 1, y: 1 },
            { x: mapWidth - 2, y: 1 },
            { x: 1, y: mapHeight - 2 },
            { x: mapWidth - 2, y: mapHeight - 2 }
        ];

        for (const pos of corners) {
            // Clear 3x3 area around each corner for starting position
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const x = pos.x + dx;
                    const y = pos.y + dy;
                    if (this.map.isValid(x, y)) {
                        this.map.terrain[y][x] = TERRAIN.PLAINS;
                    }
                }
            }
        }
    }

    /**
     * Analyze terrain composition in a sector
     */
    analyzeSectorTerrain(sector) {
        let plains = 0, forest = 0, mountains = 0, water = 0, total = 0;

        for (let y = sector.y1; y <= sector.y2; y++) {
            for (let x = sector.x1; x <= sector.x2; x++) {
                if (!this.map.isValid(x, y)) continue;
                total++;

                const terrain = this.map.getTerrain(x, y);
                switch (terrain) {
                    case TERRAIN.PLAINS: plains++; break;
                    case TERRAIN.FOREST: forest++; break;
                    case TERRAIN.MOUNTAINS: mountains++; break;
                    case TERRAIN.WATER: water++; break;
                }
            }
        }

        return {
            total,
            plains,
            forest,
            mountains,
            water,
            forestRatio: forest / total,
            mountainRatio: mountains / total,
            waterCount: water
        };
    }

    /**
     * Add terrain to a sector at random valid positions
     */
    addTerrainToSector(sector, terrainType, count) {
        let added = 0;
        let attempts = 0;

        while (added < count && attempts < count * 10) {
            attempts++;
            const x = Utils.randomInt(sector.x1, sector.x2);
            const y = Utils.randomInt(sector.y1, sector.y2);

            if (!this.map.isValid(x, y)) continue;
            if (this.map.getTerrain(x, y) !== TERRAIN.PLAINS) continue;

            // Don't modify near starting positions
            const isNearStart = this.isNearStartingPosition(x, y);
            if (isNearStart) continue;

            this.map.terrain[y][x] = terrainType;
            added++;

            // Add some clustering (terrain patches)
            if (Math.random() < 0.5) {
                const neighbors = this.map.getNeighbors(x, y);
                for (const n of neighbors) {
                    if (this.map.getTerrain(n.x, n.y) === TERRAIN.PLAINS && !this.isNearStartingPosition(n.x, n.y)) {
                        this.map.terrain[n.y][n.x] = terrainType;
                        added++;
                        if (added >= count) break;
                    }
                }
            }
        }
    }

    /**
     * Add a small water body to a sector (edge placement)
     */
    addWaterToSector(sector) {
        // Try to place water near sector edge
        const edgePositions = [];

        // Top and bottom edges
        for (let x = sector.x1; x <= sector.x2; x++) {
            edgePositions.push({ x, y: sector.y1 });
            edgePositions.push({ x, y: sector.y2 });
        }
        // Left and right edges
        for (let y = sector.y1 + 1; y < sector.y2; y++) {
            edgePositions.push({ x: sector.x1, y });
            edgePositions.push({ x: sector.x2, y });
        }

        // Shuffle and try positions
        const shuffled = edgePositions.sort(() => Math.random() - 0.5);

        for (const pos of shuffled) {
            if (!this.map.isValid(pos.x, pos.y)) continue;
            if (this.map.getTerrain(pos.x, pos.y) !== TERRAIN.PLAINS) continue;
            if (this.isNearStartingPosition(pos.x, pos.y)) continue;

            // Create small water patch (2-3 tiles)
            this.map.terrain[pos.y][pos.x] = TERRAIN.WATER;

            const neighbors = this.map.getNeighbors(pos.x, pos.y);
            for (const n of neighbors) {
                if (Math.random() < 0.5 && this.map.getTerrain(n.x, n.y) === TERRAIN.PLAINS) {
                    this.map.terrain[n.y][n.x] = TERRAIN.WATER;
                }
            }
            return; // Done
        }
    }

    /**
     * Check if position is near any starting position
     */
    isNearStartingPosition(x, y, radius = 4) {
        const corners = [
            { x: 1, y: 1 },
            { x: this.map.width - 2, y: 1 },
            { x: 1, y: this.map.height - 2 },
            { x: this.map.width - 2, y: this.map.height - 2 }
        ];

        for (const start of corners) {
            const dist = Utils.manhattanDistance(x, y, start.x, start.y);
            if (dist <= radius) return true;
        }
        return false;
    }

    setupSpectatorCameraControls() {
        // Allow camera drag and zoom in spectator mode (but no unit interaction)
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let cameraStart = { x: 0, y: 0 };

        // Pointer down - start drag
        this.scene.input.on('pointerdown', (pointer) => {
            if (!this.renderer.isInViewport(pointer.x, pointer.y)) return;
            isDragging = true;
            dragStart = { x: pointer.x, y: pointer.y };
            cameraStart = { x: this.renderer.camera.x, y: this.renderer.camera.y };
        });

        // Pointer move - drag camera
        this.scene.input.on('pointermove', (pointer) => {
            if (!isDragging) return;
            const dx = dragStart.x - pointer.x;
            const dy = dragStart.y - pointer.y;
            this.renderer.setCamera(cameraStart.x + dx, cameraStart.y + dy);
            this.updateUI();
        });

        // Pointer up - end drag
        this.scene.input.on('pointerup', () => {
            isDragging = false;
        });

        // Mouse wheel for zoom
        this.scene.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => {
            if (!this.renderer.isInViewport(pointer.x, pointer.y)) return;
            const zoomDelta = deltaY > 0 ? -0.1 : 0.1;
            const newZoom = Utils.clamp(
                this.renderer.zoom + zoomDelta,
                this.renderer.minZoom,
                this.renderer.maxZoom
            );
            this.renderer.setZoom(newZoom);
            this.updateUI();
        });
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

        // Pinch zoom for mobile - track multiple pointers
        this.activePointers = [];

        this.scene.input.on('pointerdown', (pointer) => {
            // Add pointer to active list if not already there
            if (!this.activePointers.includes(pointer)) {
                this.activePointers.push(pointer);
            }

            // Check if we have two pointers (multi-touch)
            if (this.activePointers.length >= 2) {
                this.isDragging = false; // Cancel drag when pinching starts
                const p1 = this.activePointers[0];
                const p2 = this.activePointers[1];

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
            // Update pointer position in our tracking
            const idx = this.activePointers.indexOf(pointer);
            if (idx >= 0) {
                this.activePointers[idx] = pointer;
            }

            if (this.activePointers.length >= 2) {
                const p1 = this.activePointers[0];
                const p2 = this.activePointers[1];

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

        this.scene.input.on('pointerup', (pointer) => {
            // Remove pointer from active list
            const idx = this.activePointers.indexOf(pointer);
            if (idx >= 0) {
                this.activePointers.splice(idx, 1);
            }

            if (this.activePointers.length < 2) {
                this.pinchDistance = 0;
            }
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

    async handleTileClick(x, y) {
        const player = this.players[this.state.currentPlayerIndex];
        const unitsAtTile = this.map.getUnitsAt(x, y);
        const ownUnit = unitsAtTile.find(u => u.owner === player.id && u.hp > 0);
        const city = this.map.getCity(x, y);

        // Update tile info in UI
        this.ui.updateTileInfo(x, y, this.map);

        // First priority: select movable units (even in cities)
        // With 1 unit per tile, there's at most 1 friendly unit here
        if (ownUnit && !ownUnit.hasMoved) {
            this.selectUnit(ownUnit);
            return;
        }

        // Second priority: select own city for production
        if (city && city.owner === player.id) {
            // Check if city is blockaded
            if (this.map.isCityBlockaded(city, player.id)) {
                this.ui.showMessage('City is BLOCKADED! Enemy unit adjacent.');
            }
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
                        await this.moveUnit(unit, x, y);
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

    selectUnit(unit) {
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

    async moveUnit(unit, x, y) {
        const oldX = unit.x, oldY = unit.y;

        // Check if target tile has a friendly unit (1 unit per tile limit)
        const existingUnit = this.map.getUnitsAt(x, y).find(u => u.owner === unit.owner && u.hp > 0 && u !== unit);
        if (existingUnit) {
            // Cannot move onto a tile with a friendly unit
            return;
        }

        // Get the sprite for animation
        const sprite = this.renderer.pools.unitSprites.get(unit.id);
        const targetX = x * CONFIG.TILE_SIZE;
        const targetY = y * CONFIG.TILE_SIZE;

        // Animate movement if sprite exists
        if (sprite && (oldX !== x || oldY !== y)) {
            // Disable input during animation
            this.scene.input.enabled = false;

            await new Promise(resolve => {
                this.scene.tweens.add({
                    targets: sprite,
                    x: targetX,
                    y: targetY,
                    duration: 250,
                    ease: 'Quad.easeInOut',
                    onComplete: resolve
                });
            });

            // Re-enable input
            this.scene.input.enabled = true;
        }

        // Update unit position
        this.map.moveUnit(unit, x, y);

        // Ruin exploration - any unit can explore
        const ruin = this.map.getRuin(x, y);
        if (ruin) {
            this.handleRuinExploration(unit, x, y);
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

        this.renderer.renderMap(this.map, this.getBlockadedCities());
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

        // Trigger particle effect based on attack type
        let effectType = 'hit';
        if (attacker.type === 'CATAPULT') {
            effectType = 'catapult';
        } else if (attacker.type === 'DRAGON') {
            effectType = 'dragon';
        } else if (isRanged) {
            effectType = 'ranged';
        }

        // Create particle effect at defender position
        const targetUnit = defenderStack.units[0];
        if (targetUnit) {
            this.renderer.createParticleEffect(targetUnit.x, targetUnit.y, effectType);
        }

        if (results.defender.died && results.defender.unit.isHero) {
            this.checkWinCondition();
        }
        if (results.attacker.died && results.attacker.unit.isHero) {
            this.checkWinCondition();
        }

        // Melee kill: move attacker to defender's tile (only for adjacent/melee attacks)
        if (results.defender.died && !isRanged && !results.attacker.died) {
            const targetX = results.defender.unit.x;
            const targetY = results.defender.unit.y;
            const oldX = attacker.x;
            const oldY = attacker.y;

            // Move attacker to the tile (just update coordinates - units array is global)
            attacker.x = targetX;
            attacker.y = targetY;
            attacker.hasMoved = true;

            // Check for city capture on the new tile
            const city = this.map.getCity(targetX, targetY);
            if (city && city.owner !== attacker.owner) {
                // Check if any enemy units remain
                const remainingEnemies = this.map.getUnitsAt(targetX, targetY)
                    .filter(u => u.owner !== attacker.owner && u.hp > 0);
                if (remainingEnemies.length === 0) {
                    this.captureCity(city, attacker.owner);
                }
            }
        }

        if (results.cityCaptured && !isRanged) {
            // City capture already handled above for melee, but keep for ranged edge cases
            this.captureCity(results.cityCaptured, attacker.owner);
        }

        if (isRanged) {
            attacker.hasAttacked = true;
            this.updateUI();
        } else {
            this.deselect();
        }

        this.renderer.renderMap(this.map, this.getBlockadedCities());
        this.renderer.renderUnits(this.map.units);
    }

    /**
     * Handle ruin exploration and give random reward
     * @param {Unit} unit - unit that entered the ruin
     * @param {number} x - ruin x coordinate
     * @param {number} y - ruin y coordinate
     */
    handleRuinExploration(unit, x, y) {
        const player = this.players[unit.owner];
        const rewardType = this.map.exploreRuin(x, y);

        if (!rewardType) return;

        switch (rewardType) {
            case 'gold_50':
                player.addGold(50);
                this.ui.showMessage('Ruin found: 50 gold!');
                break;

            case 'gold_100':
                player.addGold(100);
                this.ui.showMessage('Ruin found: 100 gold!');
                break;

            case 'random_unit': {
                // Get free adjacent tiles
                const freeTiles = this.map.getAdjacentFreeTiles(x, y, unit.owner);

                if (freeTiles.length === 0) {
                    // No free space - give gold instead
                    player.addGold(75);
                    this.ui.showMessage('Ruin found: Gold (no space for unit)!');
                } else {
                    // Spawn random unit on a random free adjacent tile
                    const spawnTile = freeTiles[Utils.randomInt(0, freeTiles.length - 1)];
                    const unitTypes = ['LIGHT_INFANTRY', 'ARCHER', 'CAVALRY', 'HEAVY_INFANTRY'];
                    const randomType = unitTypes[Utils.randomInt(0, unitTypes.length - 1)];

                    const newUnit = new Unit(randomType, unit.owner, spawnTile.x, spawnTile.y);
                    newUnit.hasMoved = true;
                    newUnit.hasAttacked = true;
                    this.map.units.push(newUnit);
                    player.units.push(newUnit);

                    this.ui.showMessage(`Ruin found: ${UNIT_DEFINITIONS[randomType].name} joined!`);
                    this.renderer.renderUnits(this.map.units);
                }
                break;
            }

            case 'new_city': {
                // Build city directly on the ruin tile
                // The exploring unit is on this tile, move them to adjacent free tile
                const terrain = this.map.getTerrain(x, y);
                const existingCity = this.map.getCity(x, y);

                if (terrain === TERRAIN.WATER || existingCity) {
                    // Cannot build on water or existing city - give gold
                    player.addGold(150);
                    this.ui.showMessage('Ruin found: Gold (cannot build here)!');
                } else {
                    const freeTiles = this.map.getAdjacentFreeTiles(x, y, unit.owner);

                    if (freeTiles.length > 0) {
                        // Move unit to adjacent free tile
                        const moveTo = freeTiles[Utils.randomInt(0, freeTiles.length - 1)];
                        const fromX = unit.x;
                        const fromY = unit.y;
                        unit.x = moveTo.x;
                        unit.y = moveTo.y;
                        unit.hasMoved = true;
                        Events.emit('unit:moved', { unit, fromX, fromY, toX: moveTo.x, toY: moveTo.y });

                        // Build city on the ruin location
                        const sizes = ['small', 'medium'];
                        const randomSize = sizes[Utils.randomInt(0, sizes.length - 1)];

                        const newCity = new City(x, y, randomSize, unit.owner);
                        this.map.addCity(newCity);
                        player.cities.push(newCity);

                        this.ui.showMessage(`Ruin found: New ${randomSize} city established!`);
                        this.renderer.renderMap(this.map, this.getBlockadedCities());
                    } else {
                        // No adjacent space for unit - give gold instead
                        player.addGold(150);
                        this.ui.showMessage('Ruin found: Gold (no space for city)!');
                    }
                }
                break;
            }
        }
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

            // Check if old player lost all cities (defeated)
            if (oldPlayer.cities.length === 0) {
                this.defeatPlayer(oldPlayer);
            }
        }

        this.checkWinCondition();
    }

    /**
     * Defeat a player - remove all their units and mark as defeated
     */
    defeatPlayer(player) {
        if (!player.isAlive) return;

        // Remove all player's units from the map
        const unitsToRemove = this.map.units.filter(u => u.owner === player.id);
        unitsToRemove.forEach(unit => {
            this.map.removeUnit(unit);
        });

        // Clear from player's unit list
        player.units = [];

        // Mark as defeated
        player.defeat();

        // Show defeat message
        this.ui.showMessage(`${player.name} DEFEATED!`);
        Events.emit('player:defeated', { player });

        // Re-render to show removed units
        this.renderer.renderMap(this.map, this.getBlockadedCities());
        this.renderer.renderUnits(this.map.units);
    }

    produceUnit(city, unitType) {
        const player = this.players[this.state.currentPlayerIndex];
        const cost = UNIT_DEFINITIONS[unitType].cost;

        // Check if city is blockaded by enemy units
        if (this.map.isCityBlockaded(city, player.id)) {
            this.ui.showMessage('City is blockaded! Cannot produce.');
            return false;
        }

        if (!player.spendGold(cost)) {
            return false;
        }

        // Find spawn location - try city first, then adjacent tiles
        let spawnX = city.x;
        let spawnY = city.y;

        // Check if city tile is occupied by a friendly unit
        const cityOccupant = this.map.getUnitsAt(city.x, city.y).find(u => u.owner === player.id && u.hp > 0);
        if (cityOccupant) {
            // Find adjacent free tile
            const adjacent = [
                { x: city.x + 1, y: city.y },
                { x: city.x - 1, y: city.y },
                { x: city.x, y: city.y + 1 },
                { x: city.x, y: city.y - 1 }
            ].filter(p => this.map.isValid(p.x, p.y));

            const freeTile = adjacent.find(p => {
                const terrain = this.map.getTerrain(p.x, p.y);
                const unitDef = UNIT_DEFINITIONS[unitType];
                // Check terrain is valid and no friendly unit there
                return unitDef.canEnter.includes(terrain) &&
                       !this.map.getUnitsAt(p.x, p.y).some(u => u.owner === player.id && u.hp > 0);
            });

            if (!freeTile) {
                // No free tile found - refund and abort
                player.addGold(cost);
                this.ui.showMessage('No free space to produce unit!');
                return false;
            }

            spawnX = freeTile.x;
            spawnY = freeTile.y;
        }

        const unit = new Unit(unitType, player.id, spawnX, spawnY);
        unit.hasMoved = true;
        unit.hasAttacked = true;
        this.map.units.push(unit);
        player.units.push(unit);
        this.ui.showMessage(`Produced ${UNIT_DEFINITIONS[unitType].name}!`);
        this.renderer.renderUnits(this.map.units);
        this.updateUI();
        return true;
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
            // In spectator mode, respect pause state
            if (this.isSpectatorMode && this.aiPaused) {
                return; // Don't start AI turn while paused
            }

            // Disable input during AI turn (safety)
            this.scene.input.enabled = false;
            this.ui.showMessage(`${currentPlayer.name} (AI) is thinking...`, 2000);

            // Start AI turn after a short delay
            setTimeout(() => {
                this.ai.playTurn().then(() => {
                    // Only re-enable input if NOT in spectator mode
                    // In spectator mode, input stays disabled (pure watching)
                    if (!this.isSpectatorMode) {
                        this.scene.input.enabled = true;
                    }
                });
            }, 1000);
        }
    }

    /**
     * Toggle pause in spectator mode (all AI game)
     */
    togglePause() {
        if (!this.isSpectatorMode) return;

        this.aiPaused = !this.aiPaused;
        this.ui.setPaused(this.aiPaused);

        if (this.aiPaused) {
            // Cancel any pending auto-turn
            if (this.nextTurnTimer) {
                clearTimeout(this.nextTurnTimer);
                this.nextTurnTimer = null;
            }
            this.ui.showMessage('PAUSED - Click RESUME to continue', 2000);
        } else {
            // Resume - check if we should start AI turn immediately
            this.ui.showMessage('RESUMED', 1000);
            const currentPlayer = this.players[this.state.currentPlayerIndex];
            if (currentPlayer.isAI && currentPlayer.isAlive && !this.ai.isRunning) {
                // In spectator mode, input stays disabled - AI plays automatically
                this.checkAndStartAITurn();
            }
        }
    }

    /**
     * Schedule next turn in spectator mode with delay
     */
    scheduleNextTurn() {
        if (!this.isSpectatorMode || this.aiPaused) return;

        // Clear any existing timer
        if (this.nextTurnTimer) {
            clearTimeout(this.nextTurnTimer);
        }

        // Schedule next turn with 2 second delay for viewing
        this.nextTurnTimer = setTimeout(() => {
            this.nextTurnTimer = null;
            const currentPlayer = this.players[this.state.currentPlayerIndex];
            // Only auto-continue if current player is AI and alive and not already running
            if (currentPlayer.isAI && currentPlayer.isAlive && !this.ai.isRunning) {
                this.endTurn();
                // endTurn calls checkAndStartAITurn which starts next AI
            }
        }, 2000);
    }

    checkWinCondition() {
        this.players.forEach(player => {
            if (!player.isAlive) return;

            const hasHero = player.units.some(u => u.isHero && u.hp > 0);
            const hasCities = player.cities.length > 0;

            if (!hasHero && !hasCities) {
                // Player has no hero and no cities - defeat them and remove units
                this.defeatPlayer(player);
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

        // Check if selected entity is a blockaded city
        let isBlockaded = false;
        if (this.state.selectedEntity instanceof City) {
            isBlockaded = this.map.isCityBlockaded(this.state.selectedEntity, player.id);
        }

        this.ui.updateSelected(this.state.selectedEntity, null, isBlockaded);

        // Update minimap
        this.ui.updateMinimap(this.map, this.players, this.renderer.camera.x, this.renderer.camera.y, this.renderer.zoom);
    }

    /**
     * Get all cities that are currently blockaded by enemy units
     */
    getBlockadedCities() {
        return this.map.cities.filter(city =>
            city.owner !== null && this.map.isCityBlockaded(city, city.owner)
        );
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

        this.renderer.renderMap(this.map, this.getBlockadedCities());
        this.renderer.renderUnits(this.map.units);
        this.updateUI();
        this.ui.showMessage('Game loaded!');
    }
}
