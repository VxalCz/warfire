import { CONFIG, COLORS, UNIT_DEFINITIONS } from '../constants.js';

/**
 * TextureGenerator - generates all procedural game textures
 */
export class TextureGenerator {
    constructor(renderer) {
        this.renderer = renderer;
    }

    /**
     * Generate all game textures
     */
    generateAll() {
        this.generateTerrainVariants();
        this.generateUnitTextures();
        this.generateCityTextures();
        this.generateHighlightTextures();
    }

    /**
     * Generate 4 variants for each terrain type
     */
    generateTerrainVariants() {
        const NUM_VARIANTS = 4;
        const seededRandom = (seed) => {
            let x = Math.sin(seed) * 10000;
            return x - Math.floor(x);
        };

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
                g.fillStyle(COLORS.plains, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                const grassColors = [0x6ABF40, 0x7EC850, 0x5AAD35, 0x8FD45A];
                const grassPositions = generateGrassPositions(variant);
                grassPositions.forEach(pos => {
                    g.fillStyle(grassColors[pos.colorIdx], 0.6);
                    g.fillRect(pos.x, pos.y, pos.size, pos.size);
                });

                const flowerColors = [0xFFD700, 0xFF6B6B, 0x87CEEB, 0xDDA0DD];
                const flowerPositions = generateFlowerPositions(variant);
                flowerPositions.forEach((pos, i) => {
                    g.fillStyle(flowerColors[(variant + i) % 4], 0.8);
                    g.fillCircle(pos.x, pos.y, 2);
                });

                if (variant % 2 === 1) {
                    g.fillStyle(0x7A7A7A, 0.4);
                    const rockX = 15 + (variant * 10) % 40;
                    const rockY = 20 + (variant * 15) % 30;
                    g.fillCircle(rockX, rockY, 3);
                }

                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            },
            forest: (g, variant) => {
                g.fillStyle(0x1A3D1A, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                for (let i = 0; i < 30; i++) {
                    const seed = variant * 3000 + i;
                    const x = Math.floor(seededRandom(seed) * 60);
                    const y = Math.floor(seededRandom(seed + 500) * 60);
                    const w = Math.floor(seededRandom(seed + 1000) * 3) + 3;
                    const h = Math.floor(seededRandom(seed + 1500) * 2) + 2;
                    g.fillStyle(0x0F2F0F, 0.5);
                    g.fillRect(x, y, w, h);
                }

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

                    g.fillStyle(0x3D2817, 1);
                    g.fillRect(tx + 4 * s, ty + 12 * s, 6 * s, 14 * s);
                    g.fillStyle(0x2A1B0F, 1);
                    g.fillRect(tx + 5 * s, ty + 14 * s, 2 * s, 8 * s);

                    g.fillStyle(0x1B5E20, 1);
                    g.fillCircle(tx + 7 * s, ty + 8 * s, 14 * s);
                    g.fillStyle(0x2E7D32, 1);
                    g.fillCircle(tx + 5 * s, ty + 5 * s, 10 * s);
                    g.fillCircle(tx + 9 * s, ty + 6 * s, 9 * s);
                    g.fillStyle(0x4CAF50, 0.7);
                    g.fillCircle(tx + 4 * s, ty + 3 * s, 5 * s);
                });

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

                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            },
            mountains: (g, variant) => {
                g.fillStyle(0xB8C4D0, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

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
                    g.fillStyle(0x4A5560, 1);
                    g.fillTriangle(peak.x1 + 5, peak.y1 - 3, peak.x2 + 8, peak.y2 + 5, peak.x3, peak.y3);

                    g.fillStyle(peak.color, 1);
                    g.fillTriangle(peak.x1, peak.y1, peak.x2, peak.y2, peak.x3, peak.y3);

                    g.fillStyle(0xFFFFFF, 1);
                    g.fillTriangle(peak.x2 - 8, peak.snowY + 5, peak.x2, peak.y2, peak.x2 + 8, peak.snowY + 5);
                    g.fillStyle(0xE8E8E8, 1);
                    g.fillTriangle(peak.x2 - 5, peak.snowY + 8, peak.x2, peak.y2 + 3, peak.x2 + 5, peak.snowY + 8);

                    g.fillStyle(0x3D4852, 0.6);
                    g.fillRect(peak.x2 - 3, peak.y2 + 15, 4, 6);
                    g.fillRect(peak.x2 + 6, peak.y2 + 20, 3, 4);
                });

                const rockConfigs = [
                    [{ x: 15, y: 58, r: 6 }, { x: 55, y: 60, r: 5 }, { x: 62, y: 58, r: 4 }],
                    [{ x: 12, y: 59, r: 5 }, { x: 48, y: 58, r: 6 }, { x: 58, y: 61, r: 4 }],
                    [{ x: 8, y: 57, r: 4 }, { x: 35, y: 59, r: 5 }, { x: 52, y: 58, r: 6 }],
                    [{ x: 18, y: 60, r: 5 }, { x: 42, y: 58, r: 4 }, { x: 60, y: 59, r: 5 }]
                ];
                const rocks = rockConfigs[variant % 4];
                g.fillStyle(0x5A636E, 1);
                rocks.forEach(rock => g.fillCircle(rock.x, rock.y, rock.r));

                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            },
            water: (g, variant) => {
                g.fillStyle(COLORS.water, 1);
                g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);

                for (let i = 0; i < 15; i++) {
                    const seed = variant * 4000 + i;
                    const x = Math.floor(seededRandom(seed) * 60);
                    const y = Math.floor(seededRandom(seed + 500) * 60);
                    const w = Math.floor(seededRandom(seed + 1000) * 8) + 8;
                    const h = Math.floor(seededRandom(seed + 1500) * 4) + 4;
                    g.fillStyle(0x3A80C2, 0.4);
                    g.fillRect(x, y, w, h);
                }

                const waveColors = [0x87CEEB, 0x5BA3D0, 0xA8D4F2];
                const waveOffset = variant * 3;
                for (let row = 0; row < 4; row++) {
                    const y = 12 + row * 14;
                    for (let i = 0; i < 5; i++) {
                        const x = 6 + i * 12 + ((row + waveOffset) % 2) * 6;
                        g.fillStyle(waveColors[(row + variant) % 3], 0.5);
                        g.fillRect(x, y, 8, 3);
                        g.fillStyle(0xFFFFFF, 0.3);
                        g.fillRect(x + 1, y - 1, 4, 2);
                    }
                }

                for (let i = 0; i < 6; i++) {
                    const seed = variant * 5000 + i;
                    const x = Math.floor(seededRandom(seed) * 48) + 8;
                    const y = Math.floor(seededRandom(seed + 500) * 48) + 8;
                    g.fillStyle(0xFFFFFF, 0.7);
                    g.fillRect(x, y, 2, 2);
                }

                g.lineStyle(1, COLORS.grid, 0.15);
                g.strokeRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            }
        };

        Object.entries(terrainVariants).forEach(([name, creator]) => {
            for (let v = 0; v < NUM_VARIANTS; v++) {
                this.renderer.createTexture(`${name}_${v}`, (g) => creator(g, v));
            }
        });
    }

    /**
     * Generate unit textures for all player colors
     */
    generateUnitTextures() {
        Object.keys(UNIT_DEFINITIONS).forEach(unitType => {
            COLORS.playerSchemes.forEach((scheme, idx) => {
                this.renderer.createTexture(`${unitType}_${idx}`, (g) => {
                    this.drawUnitSprite(g, unitType, scheme);
                });
            });
        });
    }

    /**
     * Draw a unit sprite
     */
    drawUnitSprite(g, type, scheme) {
        const primary = scheme.primary;
        const secondary = scheme.secondary || 0xFFD700;
        const dark = this.darken(primary, 30);
        const size = type === 'HERO' ? 22 : 18;
        const offset = (CONFIG.TILE_SIZE - size) / 2;
        const cx = offset + size / 2;
        const cy = offset + size / 2;

        // Multi-layer shadow for depth
        g.fillStyle(0x000000, 0.15);
        g.fillEllipse(cx, offset + size - 1, size * 0.9, 7);
        g.fillStyle(0x000000, 0.25);
        g.fillEllipse(cx, offset + size - 2, size * 0.7, 5);
        g.fillStyle(0x000000, 0.35);
        g.fillEllipse(cx, offset + size - 3, size * 0.5, 3);

        const drawBody = (x, y, w, h, color, shadowOffset = 3) => {
            g.fillStyle(this.darken(color, 25), 1);
            g.fillRect(x + 2, y + 2, w, h);
            g.fillStyle(color, 1);
            g.fillRect(x, y, w, h - shadowOffset);
            g.fillStyle(this.lighten(color, 15), 0.7);
            g.fillRect(x + 1, y + 1, w - 2, 2);
        };

        if (type === 'LIGHT_INFANTRY') {
            drawBody(offset + 4, offset + 10, size - 8, size - 12, primary);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 4, offset + 14, size - 8, 2);
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(cx, offset + 6, 5);
            g.fillStyle(0xE8B89A, 1);
            g.fillCircle(cx + 2, offset + 8, 2);
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 2, offset + 5, 1, 2);
            g.fillRect(cx + 1, offset + 5, 1, 2);
            g.fillStyle(0x6B4423, 1);
            g.fillRect(offset + size - 4, offset + 4, 3, size - 4);
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + size - 4, offset + 4, 2, size - 6);
            g.fillStyle(0xC0C0C0, 1);
            g.fillRect(offset + size - 5, offset + 2, 5, 4);
            g.fillStyle(0xE8E8E8, 1);
            g.fillRect(offset + size - 4, offset + 2, 3, 2);
            g.fillStyle(0x4A3728, 1);
            g.fillCircle(offset + 5, offset + 12, 5);
            g.fillStyle(primary, 1);
            g.fillCircle(offset + 5, offset + 12, 4);
            g.fillStyle(secondary, 1);
            g.fillCircle(offset + 5, offset + 12, 2);
        } else if (type === 'HEAVY_INFANTRY') {
            drawBody(offset + 2, offset + 8, size - 4, size - 10, primary, 4);
            g.fillStyle(0x606060, 1);
            g.fillRect(offset + 4, offset + 10, size - 8, 4);
            g.fillStyle(0x808080, 1);
            g.fillRect(offset + 5, offset + 11, size - 10, 2);
            g.fillStyle(0x606060, 1);
            g.fillRect(offset + 4, offset + 16, size - 8, 4);
            g.fillStyle(0x808080, 1);
            g.fillRect(offset + 5, offset + 17, size - 10, 2);
            g.fillStyle(0x707070, 1);
            g.fillRect(offset + 4, offset + 2, size - 8, 8);
            g.fillStyle(0x909090, 1);
            g.fillRect(offset + 5, offset + 3, size - 10, 3);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 6, offset, size - 12, 3);
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 2, offset + 6, 4, 2);
            g.fillStyle(0x444444, 1);
            g.fillCircle(offset + 5, offset + 13, 6);
            g.fillStyle(primary, 1);
            g.fillCircle(offset + 5, offset + 13, 5);
            g.fillStyle(secondary, 1);
            g.fillCircle(offset + 5, offset + 13, 2);
            g.fillStyle(0x808080, 1);
            g.fillRect(offset + size - 5, offset + 6, 4, 10);
            g.fillStyle(0xB0B0B0, 1);
            g.fillRect(offset + size - 4, offset + 6, 2, 10);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + size - 6, offset + 4, 6, 3);
        } else if (type === 'CAVALRY') {
            g.fillStyle(0x6B3E23, 1);
            g.fillRect(offset + 4, offset + 8, size - 8, 8);
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + 4, offset + 8, size - 10, 6);
            g.fillStyle(0x6B3E23, 1);
            g.fillRect(offset + 2, offset + 6, 6, 5);
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + 3, offset + 6, 4, 4);
            g.fillRect(offset, offset + 8, 3, 2);
            g.fillStyle(0x5A3A1A, 1);
            g.fillRect(offset + 5, offset + 14, 3, 4);
            g.fillRect(offset + size - 8, offset + 14, 3, 4);
            drawBody(offset + 10, offset + 4, 6, 8, primary, 2);
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(offset + 13, offset + 3, 3);
            g.fillStyle(0x5A3A1A, 1);
            g.fillRect(offset + 16, offset, 2, 14);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 15, offset - 2, 4, 4);
        } else if (type === 'ARCHER') {
            drawBody(offset + 5, offset + 8, size - 10, size - 10, primary, 3);
            g.fillStyle(dark, 1);
            g.fillCircle(cx, offset + 6, 6);
            g.fillStyle(primary, 1);
            g.fillCircle(cx, offset + 6, 5);
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(cx, offset + 6, 4);
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 1, offset + 5, 1, 2);
            g.fillRect(cx + 1, offset + 5, 1, 2);
            g.lineStyle(2, 0x6B4423);
            g.beginPath();
            g.arc(offset + 4, offset + 10, 7, -Math.PI / 2, Math.PI / 2);
            g.strokePath();
            g.lineStyle(1, 0xDDDDDD);
            g.beginPath();
            g.moveTo(offset + 4, offset + 3);
            g.lineTo(offset + 4, offset + 17);
            g.strokePath();
            g.fillStyle(0x5A3A1A, 1);
            g.fillRect(offset + 8, offset + 8, 8, 2);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 14, offset + 6, 2, 6);
        } else if (type === 'CATAPULT') {
            g.fillStyle(0x5A3A1A, 1);
            g.fillRect(offset + 2, offset + 12, size - 4, 6);
            g.fillStyle(0x8B4513, 1);
            g.fillRect(offset + 2, offset + 12, size - 6, 4);
            g.fillStyle(0x3A2A1A, 1);
            g.fillCircle(offset + 6, offset + 16, 4);
            g.fillCircle(offset + size - 6, offset + 16, 4);
            g.fillStyle(0x5A4A3A, 1);
            g.fillCircle(offset + 6, offset + 16, 3);
            g.fillCircle(offset + size - 6, offset + 16, 3);
            g.fillStyle(0x6B4423, 1);
            g.fillRect(offset + 4, offset + 8, 4, 8);
            g.fillRect(offset + size - 8, offset + 8, 4, 8);
            g.fillRect(offset + 4, offset + 6, size - 8, 3);
            g.fillStyle(0x5A3A1A, 1);
            g.fillRect(offset + 8, offset + 4, 3, 10);
            g.fillStyle(0x4A3728, 1);
            g.fillRect(offset + 6, offset + 2, 7, 4);
            g.fillStyle(0x444444, 1);
            g.fillCircle(offset + size - 6, offset + 8, 3);
            g.fillStyle(0x666666, 1);
            g.fillCircle(offset + size - 6, offset + 7, 2);
        } else if (type === 'DRAGON') {
            g.fillStyle(0x990000, 1);
            g.fillRect(offset + 8, offset + 10, 10, 6);
            g.fillStyle(0xCC0000, 1);
            g.fillRect(offset + 8, offset + 10, 8, 4);
            g.fillStyle(0x770000, 1);
            g.fillTriangle(offset + 4, offset + 10, offset + 2, offset + 2, offset + 10, offset + 8);
            g.fillTriangle(offset + size - 4, offset + 10, offset + size - 2, offset + 2, offset + size - 10, offset + 8);
            g.fillStyle(secondary, 0.5);
            g.fillTriangle(offset + 4, offset + 9, offset + 3, offset + 4, offset + 8, offset + 8);
            g.fillTriangle(offset + size - 4, offset + 9, offset + size - 3, offset + 4, offset + size - 8, offset + 8);
            g.fillStyle(0x990000, 1);
            g.fillRect(offset + 2, offset + 8, 8, 6);
            g.fillStyle(0xCC0000, 1);
            g.fillRect(offset + 3, offset + 8, 6, 4);
            g.fillRect(offset, offset + 9, 3, 3);
            g.fillStyle(0xFFFF00, 1);
            g.fillCircle(offset + 4, offset + 10, 2);
            g.fillStyle(0xFFFFFF, 0.8);
            g.fillCircle(offset + 3, offset + 9, 1);
            g.fillStyle(0x000000, 1);
            g.fillCircle(offset + 4, offset + 10, 1);
            g.fillStyle(0xFF4400, 0.9);
            g.fillRect(offset - 5, offset + 9, 5, 3);
            g.fillStyle(0xFF8800, 0.8);
            g.fillRect(offset - 4, offset + 9, 4, 3);
            g.fillStyle(0xFFFF00, 0.9);
            g.fillRect(offset - 3, offset + 9, 3, 3);
            g.fillStyle(0x770000, 1);
            g.fillRect(offset + size - 4, offset + 12, 4, 4);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 10, offset + 6, 2, 4);
            g.fillRect(offset + 14, offset + 7, 2, 3);
        } else if (type === 'HERO') {
            g.fillStyle(dark, 1);
            g.fillRect(offset + 4, offset + 10, size - 8, size - 12);
            g.fillStyle(primary, 1);
            g.fillRect(offset + 5, offset + 10, size - 10, size - 14);
            g.fillStyle(primary, 1);
            g.fillRect(offset + 6, offset + 8, size - 12, 10);
            g.fillStyle(this.lighten(primary, 20), 1);
            g.fillRect(offset + 7, offset + 9, size - 14, 4);
            g.fillStyle(secondary, 1);
            g.fillRect(cx - 2, offset + 10, 4, 6);
            g.fillStyle(0xFFFFFF, 0.6);
            g.fillRect(cx - 1, offset + 11, 2, 2);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + 6, offset + 2, size - 12, 6);
            g.fillStyle(0xFFE44D, 1);
            g.fillRect(offset + 7, offset + 3, size - 14, 3);
            g.fillRect(offset + 4, offset - 2, 3, 5);
            g.fillRect(cx - 1, offset - 4, 3, 6);
            g.fillRect(offset + size - 7, offset - 2, 3, 5);
            g.fillStyle(0xFFCCAA, 1);
            g.fillCircle(cx, offset + 7, 4);
            g.fillStyle(0xE8B89A, 1);
            g.fillCircle(cx + 1, offset + 8, 2);
            g.fillStyle(0x000000, 1);
            g.fillRect(cx - 2, offset + 6, 1, 2);
            g.fillRect(cx + 1, offset + 6, 1, 2);
            g.fillStyle(0xA0A0A0, 1);
            g.fillRect(offset + size - 6, offset + 6, 4, 12);
            g.fillStyle(0xE0E0E0, 1);
            g.fillRect(offset + size - 5, offset + 6, 2, 12);
            g.fillStyle(secondary, 1);
            g.fillRect(offset + size - 7, offset + 6, 6, 3);
            g.fillStyle(0xFFE44D, 1);
            g.fillRect(offset + size - 6, offset + 6, 4, 2);
            g.fillRect(offset + size - 6, offset + 2, 4, 4);
            g.fillStyle(0x333333, 1);
            g.fillCircle(offset + 6, offset + 14, 5);
            g.fillStyle(primary, 1);
            g.fillCircle(offset + 6, offset + 14, 4);
            g.fillStyle(secondary, 1);
            g.fillCircle(offset + 6, offset + 14, 2);
        }
    }

    /**
     * Generate city textures
     */
    generateCityTextures() {
        ['small', 'medium', 'large'].forEach(size => {
            COLORS.playerSchemes.forEach((scheme, idx) => {
                this.renderer.createTexture(`city_${size}_${idx}`, (g) => {
                    this.drawCitySprite(g, size, scheme);
                });
            });
            const neutralScheme = {
                primary: COLORS.neutral,
                secondary: COLORS.neutralSecondary,
                dark: COLORS.neutralDark
            };
            this.renderer.createTexture(`city_${size}_neutral`, (g) => {
                this.drawCitySprite(g, size, neutralScheme);
            });
        });
    }

    /**
     * Draw a city sprite
     */
    drawCitySprite(g, size, scheme) {
        const primary = scheme.primary;
        const secondary = scheme.secondary || 0xFFD700;
        const dark = this.darken(primary, 30);

        const drawFlag = (fx, fy) => {
            g.fillStyle(0x6B4423, 1);
            g.fillRect(fx, fy, 2, 14);
            g.fillStyle(primary, 1);
            g.fillRect(fx + 2, fy, 10, 7);
            g.fillStyle(secondary, 1);
            g.fillRect(fx + 2, fy + 2, 10, 3);
            g.fillStyle(0xFFFFFF, 0.4);
            g.fillRect(fx + 3, fy + 1, 3, 2);
        };

        if (size === 'small') {
            const ox = (CONFIG.TILE_SIZE - 36) / 2;
            const oy = (CONFIG.TILE_SIZE - 28) / 2 + 4;

            g.fillStyle(0x4A3A2A, 1);
            g.fillRect(ox + 1, oy + 21, 36, 7);
            g.fillStyle(0x5A4A3A, 1);
            g.fillRect(ox, oy + 20, 36, 8);

            g.fillStyle(dark, 1);
            g.fillRect(ox + 6, oy + 10, 24, 14);
            g.fillStyle(primary, 1);
            g.fillRect(ox + 6, oy + 10, 22, 12);
            g.fillStyle(this.lighten(primary, 15), 0.5);
            g.fillRect(ox + 8, oy + 11, 18, 3);

            g.fillStyle(0x3A3A3A, 1);
            g.fillTriangle(ox, oy + 10, ox + 18, ox - 2, ox + 36, oy + 10);
            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox + 2, oy + 10, ox + 18, ox, ox + 34, oy + 10);
            g.fillStyle(0x5A5A5A, 1);
            g.fillTriangle(ox + 8, oy + 10, ox + 18, oy + 2, ox + 28, oy + 10);

            g.fillStyle(0x2D1F0F, 1);
            g.fillRect(ox + 14, oy + 16, 8, 8);
            g.fillStyle(0x3D2817, 1);
            g.fillRect(ox + 14, oy + 16, 8, 7);
            g.fillStyle(0x5A4A3A, 1);
            g.fillRect(ox + 13, oy + 15, 10, 1);
            g.fillRect(ox + 13, oy + 15, 1, 9);
            g.fillRect(ox + 22, oy + 15, 1, 9);

            g.fillStyle(0xFFD700, 1);
            g.fillRect(ox + 10, oy + 12, 4, 4);
            g.fillRect(ox + 22, oy + 12, 4, 4);
            g.fillStyle(0x87CEEB, 0.7);
            g.fillRect(ox + 11, oy + 13, 2, 2);
            g.fillRect(ox + 23, oy + 13, 2, 2);
            g.fillStyle(0x2C1810, 1);
            g.fillRect(ox + 11, oy + 13, 2, 2);
            g.fillRect(ox + 23, oy + 13, 2, 2);

            g.fillStyle(0x3A3A3A, 1);
            g.fillRect(ox + 26, oy + 4, 4, 8);
            g.fillStyle(0x888888, 0.4);
            g.fillCircle(ox + 29, oy - 2, 4);
            g.fillStyle(0xAAAAAA, 0.5);
            g.fillCircle(ox + 28, oy, 3);
            g.fillStyle(0xCCCCCC, 0.6);
            g.fillCircle(ox + 30, oy - 3, 2);

            drawFlag(ox + 28, oy - 12);
        } else if (size === 'medium') {
            const ox = (CONFIG.TILE_SIZE - 44) / 2;
            const oy = (CONFIG.TILE_SIZE - 36) / 2 + 2;

            g.fillStyle(0x4A4A4A, 1);
            g.fillRect(ox, oy + 24, 44, 8);
            g.fillStyle(0x5A5A5A, 1);
            g.fillRect(ox + 2, oy + 24, 40, 6);

            g.fillStyle(dark, 1);
            g.fillRect(ox + 6, oy + 8, 32, 18);
            g.fillStyle(primary, 1);
            g.fillRect(ox + 8, oy + 8, 28, 16);
            g.fillStyle(this.lighten(primary, 10), 0.5);
            g.fillRect(ox + 10, oy + 10, 24, 4);

            g.fillStyle(0x3A3A3A, 1);
            g.fillRect(ox + 4, oy + 4, 6, 20);
            g.fillRect(ox + 34, oy + 4, 6, 20);
            g.fillRect(ox + 2, oy, 40, 6);

            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox, oy + 4, ox + 10, oy - 8, ox + 20, oy + 4);
            g.fillStyle(0x5A5A5A, 1);
            g.fillTriangle(ox + 4, oy + 4, ox + 10, oy - 4, ox + 16, oy + 4);

            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox + 24, oy + 4, ox + 34, oy - 8, ox + 44, oy + 4);
            g.fillStyle(0x5A5A5A, 1);
            g.fillTriangle(ox + 28, oy + 4, ox + 34, oy - 4, ox + 40, oy + 4);

            g.fillStyle(0x2D1F0F, 1);
            g.fillRect(ox + 16, oy + 16, 12, 10);
            g.fillStyle(0x3D2817, 1);
            g.fillRect(ox + 17, oy + 17, 10, 8);

            g.fillStyle(0xFFD700, 1);
            g.fillRect(ox + 10, oy + 12, 5, 5);
            g.fillRect(ox + 29, oy + 12, 5, 5);
            g.fillStyle(0x87CEEB, 0.7);
            g.fillRect(ox + 11, oy + 13, 3, 3);
            g.fillRect(ox + 30, oy + 13, 3, 3);

            g.fillStyle(0x3A3A3A, 1);
            g.fillRect(ox + 12, oy - 4, 4, 8);
            g.fillRect(ox + 28, oy - 4, 4, 8);
            g.fillStyle(0x888888, 0.4);
            g.fillCircle(ox + 15, oy - 8, 4);
            g.fillCircle(ox + 31, oy - 8, 4);
            g.fillStyle(0xAAAAAA, 0.5);
            g.fillCircle(ox + 14, oy - 6, 3);
            g.fillCircle(ox + 30, oy - 6, 3);

            drawFlag(ox + 10, oy - 16);
            drawFlag(ox + 30, oy - 16);
        } else if (size === 'large') {
            const ox = (CONFIG.TILE_SIZE - 52) / 2;
            const oy = (CONFIG.TILE_SIZE - 44) / 2;

            g.fillStyle(0x4A4A4A, 1);
            g.fillRect(ox, oy + 30, 52, 10);
            g.fillStyle(0x5A5A5A, 1);
            g.fillRect(ox + 2, oy + 30, 48, 8);

            g.fillStyle(dark, 1);
            g.fillRect(ox + 6, oy + 8, 40, 24);
            g.fillStyle(primary, 1);
            g.fillRect(ox + 8, oy + 8, 36, 22);
            g.fillStyle(this.lighten(primary, 10), 0.5);
            g.fillRect(ox + 10, oy + 10, 32, 5);

            g.fillStyle(0x3A3A3A, 1);
            g.fillRect(ox + 2, oy + 4, 8, 28);
            g.fillRect(ox + 42, oy + 4, 8, 28);
            g.fillRect(ox, oy, 52, 8);

            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox - 2, oy + 4, ox + 10, oy - 12, ox + 22, oy + 4);
            g.fillStyle(0x5A5A5A, 1);
            g.fillTriangle(ox + 2, oy + 4, ox + 10, oy - 6, ox + 18, oy + 4);

            g.fillStyle(0x4A4A4A, 1);
            g.fillTriangle(ox + 30, oy + 4, ox + 42, oy - 12, ox + 54, oy + 4);
            g.fillStyle(0x5A5A5A, 1);
            g.fillTriangle(ox + 34, oy + 4, ox + 42, oy - 6, ox + 50, oy + 4);

            g.fillStyle(0x2D1F0F, 1);
            g.fillRect(ox + 20, oy + 18, 12, 14);
            g.fillStyle(0x3D2817, 1);
            g.fillRect(ox + 21, oy + 19, 10, 12);

            g.fillStyle(0xFFD700, 1);
            g.fillRect(ox + 10, oy + 12, 5, 5);
            g.fillRect(ox + 37, oy + 12, 5, 5);
            g.fillRect(ox + 10, oy + 22, 5, 5);
            g.fillRect(ox + 37, oy + 22, 5, 5);
            g.fillStyle(0x87CEEB, 0.7);
            g.fillRect(ox + 11, oy + 13, 3, 3);
            g.fillRect(ox + 38, oy + 13, 3, 3);
            g.fillRect(ox + 11, oy + 23, 3, 3);
            g.fillRect(ox + 38, oy + 23, 3, 3);

            g.fillStyle(0x3A3A3A, 1);
            g.fillRect(ox + 8, oy - 4, 4, 10);
            g.fillRect(ox + 24, oy - 6, 4, 12);
            g.fillRect(ox + 40, oy - 4, 4, 10);
            g.fillStyle(0x888888, 0.4);
            g.fillCircle(ox + 11, oy - 8, 4);
            g.fillCircle(ox + 27, oy - 10, 4);
            g.fillCircle(ox + 43, oy - 8, 4);
            g.fillStyle(0xAAAAAA, 0.5);
            g.fillCircle(ox + 10, oy - 6, 3);
            g.fillCircle(ox + 26, oy - 8, 3);
            g.fillCircle(ox + 42, oy - 6, 3);

            drawFlag(ox + 8, oy - 20);
            drawFlag(ox + 24, oy - 22);
            drawFlag(ox + 40, oy - 20);
        }
    }

    /**
     * Generate highlight textures
     */
    generateHighlightTextures() {
        this.renderer.createTexture('highlight_move', (g) => {
            g.fillStyle(COLORS.highlightMove, 0.25);
            g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            g.lineStyle(3, COLORS.highlightMove, 1);
            g.beginPath();
            g.moveTo(4, 16);
            g.lineTo(4, 4);
            g.lineTo(16, 4);
            g.moveTo(CONFIG.TILE_SIZE - 4, 16);
            g.lineTo(CONFIG.TILE_SIZE - 4, 4);
            g.lineTo(CONFIG.TILE_SIZE - 16, 4);
            g.moveTo(4, CONFIG.TILE_SIZE - 16);
            g.lineTo(4, CONFIG.TILE_SIZE - 4);
            g.lineTo(16, CONFIG.TILE_SIZE - 4);
            g.moveTo(CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 16);
            g.lineTo(CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);
            g.lineTo(CONFIG.TILE_SIZE - 16, CONFIG.TILE_SIZE - 4);
            g.strokePath();
            g.fillStyle(COLORS.highlightMove, 0.8);
            g.fillTriangle(32, 20, 28, 26, 36, 26);
            g.fillTriangle(32, 44, 28, 38, 36, 38);
        });

        this.renderer.createTexture('highlight_attack', (g) => {
            g.fillStyle(COLORS.highlightAttack, 0.3);
            g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            g.lineStyle(4, COLORS.highlightAttack, 0.9);
            g.beginPath();
            g.moveTo(12, 12);
            g.lineTo(CONFIG.TILE_SIZE - 12, CONFIG.TILE_SIZE - 12);
            g.moveTo(CONFIG.TILE_SIZE - 12, 12);
            g.lineTo(12, CONFIG.TILE_SIZE - 12);
            g.strokePath();
            g.lineStyle(3, 0xFFFFFF, 0.8);
            g.beginPath();
            g.moveTo(28, 28);
            g.lineTo(36, 36);
            g.strokePath();
            g.lineStyle(2, COLORS.highlightAttack, 0.6);
            g.strokeCircle(32, 32, 26);
        });

        this.renderer.createTexture('highlight_ranged', (g) => {
            g.fillStyle(COLORS.highlightRanged, 0.3);
            g.fillRect(0, 0, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            g.lineStyle(2, COLORS.highlightRanged, 0.9);
            g.strokeCircle(32, 32, 20);
            g.lineStyle(2, 0xFFFFFF, 0.7);
            g.strokeCircle(32, 32, 12);
            g.fillStyle(0xFFFFFF, 0.8);
            g.fillRect(30, 10, 4, 12);
            g.fillRect(30, 42, 4, 12);
            g.fillRect(10, 30, 12, 4);
            g.fillRect(42, 30, 12, 4);
            g.fillCircle(32, 32, 4);
        });

        this.renderer.createTexture('highlight_select', (g) => {
            g.lineStyle(4, 0x00FF00, 1);
            g.beginPath();
            g.moveTo(2, 20);
            g.lineTo(2, 2);
            g.lineTo(20, 2);
            g.moveTo(CONFIG.TILE_SIZE - 2, 20);
            g.lineTo(CONFIG.TILE_SIZE - 2, 2);
            g.lineTo(CONFIG.TILE_SIZE - 20, 2);
            g.moveTo(2, CONFIG.TILE_SIZE - 20);
            g.lineTo(2, CONFIG.TILE_SIZE - 2);
            g.lineTo(20, CONFIG.TILE_SIZE - 2);
            g.moveTo(CONFIG.TILE_SIZE - 2, CONFIG.TILE_SIZE - 20);
            g.lineTo(CONFIG.TILE_SIZE - 2, CONFIG.TILE_SIZE - 2);
            g.lineTo(CONFIG.TILE_SIZE - 20, CONFIG.TILE_SIZE - 2);
            g.strokePath();
            g.lineStyle(2, 0x00FF00, 0.5);
            g.strokeRect(6, 6, CONFIG.TILE_SIZE - 12, CONFIG.TILE_SIZE - 12);
        });

        this.renderer.createTexture('tile_hover', (g) => {
            g.lineStyle(2, 0xFFFFFF, 0.6);
            g.strokeRect(2, 2, CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);
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
}
