import { CONFIG, COLORS, VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from '../constants.js';

export class RenderSystem {
    constructor(scene) {
        this.scene = scene;
        this.containers = {
            map: null,
            highlights: null,
            units: null,
            ui: null
        };
        this.pools = {
            tiles: [],
            highlights: [],
            unitSprites: new Map()
        };
        // Camera position
        this.camera = { x: 0, y: 0 };
        this.mapWidth = 0;
        this.mapHeight = 0;
        // Zoom level (1.0 = 100%)
        this.zoom = 1.0;
        this.minZoom = 0.5;
        this.maxZoom = 2.0;
    }

    initialize() {
        // World containers - these will be scrolled by camera
        this.containers.map = this.scene.add.container(0, 0);
        this.containers.highlights = this.scene.add.container(0, 0);
        this.containers.units = this.scene.add.container(0, 0);
        this.containers.hover = this.scene.add.container(0, 0);

        // UI container - stays fixed on screen
        this.containers.ui = this.scene.add.container(0, 0);
        this.containers.ui.setDepth(1000); // Always on top

        // Create mask to clip map to viewport (not under UI)
        this.createViewportMask();
    }

    /**
     * Create a mask to clip game world to viewport area only
     * Prevents map from being visible under UI sidebar
     */
    createViewportMask() {
        // Create graphics for mask shape (viewport area)
        const maskGraphics = this.scene.make.graphics();
        maskGraphics.fillStyle(0xffffff);
        maskGraphics.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

        // Create geometry mask from graphics
        const mask = maskGraphics.createGeometryMask();

        // Apply mask to all world containers
        this.containers.map.setMask(mask);
        this.containers.highlights.setMask(mask);
        this.containers.units.setMask(mask);
        this.containers.hover.setMask(mask);

        // Store mask for cleanup
        this.viewportMask = mask;
    }

    /**
     * Set camera position with bounds checking
     * Accounts for zoom - keeps map within the viewport area
     */
    setCamera(x, y) {
        // Calculate effective map dimensions with zoom
        const zoomedMapWidth = this.mapWidth * this.zoom;
        const zoomedMapHeight = this.mapHeight * this.zoom;

        // Max camera position: when the right/bottom edge of zoomed map
        // aligns with the right/bottom edge of viewport
        const maxX = Math.max(0, zoomedMapWidth - VIEWPORT_WIDTH) / this.zoom;
        const maxY = Math.max(0, zoomedMapHeight - VIEWPORT_HEIGHT) / this.zoom;

        this.camera.x = Phaser.Math.Clamp(x, 0, maxX);
        this.camera.y = Phaser.Math.Clamp(y, 0, maxY);

        this.updateCameraTransform();
    }

    /**
     * Move camera by delta
     */
    moveCamera(dx, dy) {
        this.setCamera(this.camera.x + dx, this.camera.y + dy);
    }

    /**
     * Center camera on a tile
     */
    centerOnTile(tx, ty) {
        const tileWorldX = tx * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
        const tileWorldY = ty * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;

        // Calculate camera position to center the tile in viewport
        const x = tileWorldX - VIEWPORT_WIDTH / (2 * this.zoom);
        const y = tileWorldY - VIEWPORT_HEIGHT / (2 * this.zoom);

        this.setCamera(x, y);
    }

    /**
     * Apply camera transform to world containers
     */
    updateCameraTransform() {
        // Update container positions with zoom
        const scale = this.zoom;
        this.containers.map.setPosition(-this.camera.x * scale, -this.camera.y * scale);
        this.containers.map.setScale(scale);
        this.containers.highlights.setPosition(-this.camera.x * scale, -this.camera.y * scale);
        this.containers.highlights.setScale(scale);
        this.containers.units.setPosition(-this.camera.x * scale, -this.camera.y * scale);
        this.containers.units.setScale(scale);
        this.containers.hover.setPosition(-this.camera.x * scale, -this.camera.y * scale);
        this.containers.hover.setScale(scale);
    }

    /**
     * Set zoom level
     */
    setZoom(zoom) {
        this.zoom = Phaser.Math.Clamp(zoom, this.minZoom, this.maxZoom);
        this.updateCameraTransform();
    }

    /**
     * Zoom at specific screen position (for pinch zoom)
     */
    zoomAt(zoom, screenX, screenY) {
        const oldZoom = this.zoom;
        const newZoom = Phaser.Math.Clamp(zoom, this.minZoom, this.maxZoom);

        // Calculate world point before and after zoom
        const worldX = (screenX + this.camera.x * oldZoom) / oldZoom;
        const worldY = (screenY + this.camera.y * oldZoom) / oldZoom;

        // Adjust camera to keep the point under cursor/fingers stable
        let newX = (worldX * newZoom - screenX) / newZoom;
        let newY = (worldY * newZoom - screenY) / newZoom;

        // Apply bounds checking with new zoom level
        const zoomedMapWidth = this.mapWidth * newZoom;
        const zoomedMapHeight = this.mapHeight * newZoom;
        const maxX = Math.max(0, zoomedMapWidth - VIEWPORT_WIDTH) / newZoom;
        const maxY = Math.max(0, zoomedMapHeight - VIEWPORT_HEIGHT) / newZoom;

        this.camera.x = Phaser.Math.Clamp(newX, 0, maxX);
        this.camera.y = Phaser.Math.Clamp(newY, 0, maxY);
        this.zoom = newZoom;
        this.updateCameraTransform();
    }

    /**
     * Show hover highlight on a tile
     */
    showHover(x, y) {
        this.containers.hover.removeAll(true);

        const hover = this.scene.add.image(
            x * CONFIG.TILE_SIZE,
            y * CONFIG.TILE_SIZE,
            'tile_hover'
        );
        hover.setOrigin(0, 0);
        this.containers.hover.add(hover);
    }

    /**
     * Clear hover highlight
     */
    clearHover() {
        this.containers.hover.removeAll(true);
    }

    /**
     * Convert screen coordinates to world tile coordinates
     */
    screenToTile(screenX, screenY) {
        const worldX = (screenX + this.camera.x * this.zoom) / this.zoom;
        const worldY = (screenY + this.camera.y * this.zoom) / this.zoom;
        return {
            x: Math.floor(worldX / CONFIG.TILE_SIZE),
            y: Math.floor(worldY / CONFIG.TILE_SIZE)
        };
    }

    /**
     * Check if point is within viewport (not UI area)
     */
    isInViewport(screenX, screenY) {
        return screenX < VIEWPORT_WIDTH && screenY < VIEWPORT_HEIGHT;
    }

    createTexture(name, creatorFn) {
        if (this.scene.textures.exists(name)) return;
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
        creatorFn(graphics);
        graphics.generateTexture(name, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
    }

    renderMap(gameMap, blockadedCities = []) {
        // Stop all tweens on map objects before removing them
        this.containers.map.list.forEach(obj => this.scene.tweens.killTweensOf(obj));
        this.containers.map.removeAll(true);

        // Store map dimensions for camera bounds
        this.mapWidth = gameMap.width * CONFIG.TILE_SIZE;
        this.mapHeight = gameMap.height * CONFIG.TILE_SIZE;

        // Store blockaded cities for rendering indicators
        this.blockadedCities = new Set(blockadedCities.map(c => `${c.x},${c.y}`));

        // Render terrain with variants (deterministic based on position)
        const terrainNames = ['plains', 'forest', 'mountains', 'water'];
        for (let y = 0; y < gameMap.height; y++) {
            for (let x = 0; x < gameMap.width; x++) {
                const terrain = gameMap.getTerrain(x, y);
                // Deterministic variant based on position (not random)
                const variant = ((x * 17) + (y * 31)) % 4;
                const tile = this.scene.add.image(x * CONFIG.TILE_SIZE, y * CONFIG.TILE_SIZE,
                    `${terrainNames[terrain]}_${variant}`);
                tile.setOrigin(0, 0);
                this.containers.map.add(tile);
            }
        }

        // Render decorative elements
        if (gameMap.decorations) {
            gameMap.decorations.forEach(dec => {
                const dx = dec.x * CONFIG.TILE_SIZE;
                const dy = dec.y * CONFIG.TILE_SIZE;
                const g = this.scene.add.graphics();

                switch (dec.type) {
                    case 'rock':
                        // Small rock on ground
                        const rockColors = [0x7A7A7A, 0x6A6A6A, 0x8A8A8A];
                        g.fillStyle(rockColors[dec.variant % 3], 0.7);
                        const rx = dx + 15 + (dec.variant * 8) % 34;
                        const ry = dy + 18 + (dec.variant * 12) % 28;
                        g.fillCircle(rx, ry, 3 + dec.variant);
                        g.fillStyle(0x999999, 0.5);
                        g.fillCircle(rx - 1, ry - 1, 1);
                        break;

                    case 'flowers':
                        // Flower patch
                        const flowerColors = [0xFFD700, 0xFF6B6B, 0x87CEEB, 0xDDA0DD];
                        const color = flowerColors[dec.variant % 4];
                        for (let i = 0; i < 3; i++) {
                            const fx = dx + 12 + i * 18 + (dec.variant * 5) % 10;
                            const fy = dy + 15 + (i % 2) * 12;
                            g.fillStyle(0x228B22, 1);
                            g.fillRect(fx, fy + 3, 2, 4);
                            g.fillStyle(color, 0.9);
                            g.fillCircle(fx + 1, fy, 3);
                            g.fillStyle(0xFFFFFF, 0.6);
                            g.fillCircle(fx + 1, fy, 1);
                        }
                        break;

                    case 'hillock':
                        // Small grassy mound
                        g.fillStyle(0x6ABF40, 0.6);
                        g.fillEllipse(dx + 32, dy + 45, 24, 12);
                        g.fillStyle(0x7EC850, 0.5);
                        g.fillEllipse(dx + 32, dy + 43, 18, 8);
                        break;

                    case 'log':
                        // Fallen log
                        g.fillStyle(0x5D4037, 1);
                        if (dec.variant === 0) {
                            g.fillRect(dx + 10, dy + 45, 44, 10);
                            g.fillStyle(0x4A3728, 1);
                            g.fillRect(dx + 8, dy + 47, 4, 6);
                            g.fillRect(dx + 50, dy + 47, 4, 6);
                        } else {
                            g.fillRect(dx + 15, dy + 40, 10, 20);
                            g.fillStyle(0x4A3728, 1);
                            g.fillRect(dx + 17, dy + 38, 6, 4);
                            g.fillRect(dx + 17, dy + 58, 6, 4);
                        }
                        break;

                    case 'mushrooms':
                        // Mushroom cluster
                        const mushColors = [0xFFFFFF, 0xFFDD88, 0xFFB6C1];
                        const mc = mushColors[dec.variant % 3];
                        for (let i = 0; i < 2 + dec.variant; i++) {
                            const mx = dx + 20 + i * 12;
                            const my = dy + 48 - i * 3;
                            g.fillStyle(0x8B4513, 1);
                            g.fillRect(mx, my + 3, 2, 5);
                            g.fillStyle(mc, 0.9);
                            g.fillCircle(mx + 1, my + 2, 4);
                            g.fillStyle(0xFFFFFF, 0.4);
                            g.fillCircle(mx, my + 1, 2);
                        }
                        break;

                    case 'lily':
                        // Water lily
                        const lx = dx + 20 + dec.variant * 20;
                        const ly = dy + 20 + dec.variant * 15;
                        g.fillStyle(0x228B22, 0.8);
                        g.fillCircle(lx, ly, 8);
                        g.fillStyle(0xFFFFFF, 0.9);
                        g.fillCircle(lx, ly, 4);
                        g.fillStyle(0xFFD700, 0.8);
                        g.fillCircle(lx, ly, 2);
                        break;

                    case 'water_rock':
                        // Rock in water
                        g.fillStyle(0x5A5A5A, 0.8);
                        g.fillCircle(dx + 32, dy + 32, 5);
                        g.fillStyle(0x6A6A6A, 0.5);
                        g.fillCircle(dx + 31, dy + 31, 3);
                        break;
                }

                this.containers.map.add(g);
            });
        }

        // Render ruins
        gameMap.ruins.forEach(ruin => {
            if (!ruin.explored) {
                const g = this.scene.add.graphics();
                const bx = ruin.x * CONFIG.TILE_SIZE;
                const by = ruin.y * CONFIG.TILE_SIZE;
                const cx = bx + CONFIG.TILE_SIZE / 2;
                const cy = by + CONFIG.TILE_SIZE / 2;

                // Base ground with overgrown grass
                g.fillStyle(0x5D4E37, 0.3); // Dark dirt base
                g.fillCircle(cx, cy, 22);

                // Scattered grass tufts
                g.fillStyle(0x4A7C2A, 0.7);
                g.fillRect(bx + 12, by + 18, 4, 3);
                g.fillRect(bx + 45, by + 25, 5, 4);
                g.fillRect(bx + 20, by + 42, 4, 3);
                g.fillRect(bx + 38, by + 12, 3, 4);

                // Broken pillar 1 (left)
                g.fillStyle(0x8B7355, 1);
                g.fillRect(bx + 8, by + 14, 10, 20);
                // Pillar top (broken)
                g.fillStyle(0x6B5344, 1);
                g.fillRect(bx + 6, by + 12, 14, 4);
                // Pillar detail
                g.fillStyle(0x5A4A3A, 0.5);
                g.fillRect(bx + 11, by + 18, 4, 12);

                // Broken pillar 2 (right, shorter)
                g.fillStyle(0x8B7355, 1);
                g.fillRect(bx + 42, by + 24, 10, 16);
                g.fillStyle(0x6B5344, 1);
                g.fillRect(bx + 40, by + 22, 14, 4);
                // Cracks on pillar
                g.fillStyle(0x4A3A2A, 1);
                g.fillRect(bx + 44, by + 28, 2, 6);

                // Fallen column piece
                g.fillStyle(0x7B6344, 1);
                g.fillRect(bx + 18, by + 38, 18, 8);
                g.fillStyle(0x5A4A3A, 1);
                g.fillRect(bx + 20, by + 36, 14, 3);

                // Scattered stones/debris
                const stones = [
                    { x: 28, y: 12, s: 4 },
                    { x: 36, y: 18, s: 3 },
                    { x: 18, y: 34, s: 3 },
                    { x: 50, y: 40, s: 4 },
                    { x: 14, y: 42, s: 3 },
                    { x: 34, y: 46, s: 3 }
                ];
                stones.forEach(stone => {
                    g.fillStyle(0x7A6A5A, 1);
                    g.fillRect(bx + stone.x, by + stone.y, stone.s, stone.s);
                    g.fillStyle(0x5A4A3A, 0.6);
                    g.fillRect(bx + stone.x + 1, by + stone.y + 1, stone.s - 2, stone.s - 2);
                });

                // Ancient tablet fragment (hint at treasure)
                g.fillStyle(0x6B5B4B, 1);
                g.fillRect(bx + 30, by + 30, 8, 10);
                // Mysterious symbol
                g.fillStyle(0x4A3A2A, 0.8);
                g.fillRect(bx + 32, by + 33, 4, 2);
                g.fillRect(bx + 33, by + 35, 2, 4);

                // Vines growing on ruins
                g.fillStyle(0x3D6B2A, 0.8);
                g.fillRect(bx + 7, by + 22, 3, 8);
                g.fillRect(bx + 8, by + 26, 4, 3);
                g.fillRect(bx + 41, by + 28, 3, 6);

                this.containers.map.add(g);
            }
        });

        // Render cities with animated elements
        this.cityAnimations = []; // Store references to animated elements
        gameMap.cities.forEach(city => {
            const colorIdx = city.owner !== null ? city.owner : 'neutral';
            const cx = city.x * CONFIG.TILE_SIZE;
            const cy = city.y * CONFIG.TILE_SIZE;

            const sprite = this.scene.add.image(cx, cy, `city_${city.size}_${colorIdx}`);
            sprite.setOrigin(0, 0);
            this.containers.map.add(sprite);

            // Animated smoke from chimneys (for small/medium cities)
            if (city.size !== 'large' || Math.random() > 0.5) {
                const smokeX = cx + 28;
                const smokeY = cy + 4;
                for (let i = 0; i < 3; i++) {
                    const smoke = this.scene.add.circle(smokeX + i * 2, smokeY - i * 3, 3 - i * 0.5, 0xAAAAAA, 0.6 - i * 0.15);
                    this.containers.map.add(smoke);
                    // Rising and fading animation
                    this.scene.tweens.add({
                        targets: smoke,
                        y: smokeY - 15 - i * 5,
                        alpha: 0,
                        scale: 1.5,
                        duration: 2500,
                        delay: i * 400,
                        repeat: -1,
                        ease: 'Sine.easeOut'
                    });
                }
            }

            // Animated flag waving effect
            if (city.owner !== null) {
                const flagCount = city.size === 'large' ? 2 : city.size === 'medium' ? 2 : 1;
                const flagPositions = city.size === 'large'
                    ? [{ x: cx + 6, y: cy - 8 }, { x: cx + 44, y: cy - 8 }]
                    : city.size === 'medium'
                        ? [{ x: cx + 8, y: cy }, { x: cx + 34, y: cy - 2 }]
                        : [{ x: cx + 28, y: cy - 12 }];

                flagPositions.slice(0, flagCount).forEach((pos, idx) => {
                    // Create flag cloth as small rectangle
                    const flag = this.scene.add.rectangle(pos.x + 7, pos.y + 3, 10, 7,
                        COLORS.playerSchemes ? COLORS.playerSchemes[city.owner].primary : COLORS.players[city.owner]);
                    flag.setOrigin(0.5, 0.5);
                    this.containers.map.add(flag);

                    // Waving animation
                    this.scene.tweens.add({
                        targets: flag,
                        scaleX: { from: 1, to: 0.85 },
                        skewX: { from: 0, to: 5 },
                        duration: 600 + idx * 100,
                        yoyo: true,
                        repeat: -1,
                        ease: 'Sine.easeInOut'
                    });
                });
            }

            if (city.owner !== null) {
                const text = this.scene.add.text(
                    cx + CONFIG.TILE_SIZE / 2,
                    cy - 10,
                    `+${city.income}g`,
                    { fontFamily: 'Press Start 2P', fontSize: '10px', color: '#FFD700' }
                );
                text.setOrigin(0.5, 0.5);
                this.containers.map.add(text);
            }

            // Blockade indicator - red border around city
            const cityKey = `${city.x},${city.y}`;
            if (this.blockadedCities && this.blockadedCities.has(cityKey)) {
                const blockadeBorder = this.scene.add.graphics();
                blockadeBorder.lineStyle(4, 0xFF0000, 0.8); // Red border
                blockadeBorder.strokeRect(cx + 2, cy + 2, CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);

                // Animated pulsing effect for blockade
                blockadeBorder.lineStyle(2, 0xFF0000, 1);
                blockadeBorder.strokeRect(cx + 6, cy + 6, CONFIG.TILE_SIZE - 12, CONFIG.TILE_SIZE - 12);

                this.containers.map.add(blockadeBorder);

                // Blockade icon
                const blockadeIcon = this.scene.add.text(
                    cx + CONFIG.TILE_SIZE / 2,
                    cy + CONFIG.TILE_SIZE / 2,
                    '⚔', // Crossed swords or similar
                    { fontFamily: 'Press Start 2P', fontSize: '16px', color: '#FF0000' }
                );
                blockadeIcon.setOrigin(0.5, 0.5);
                this.containers.map.add(blockadeIcon);

                // Pulsing animation
                this.scene.tweens.add({
                    targets: [blockadeIcon],
                    scale: { from: 1, to: 1.2 },
                    alpha: { from: 1, to: 0.6 },
                    duration: 800,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
            }
        });
    }

    renderUnits(units, selectedUnit = null) {
        // Stop all tweens on unit objects before removing them
        this.containers.units.list.forEach(obj => this.scene.tweens.killTweensOf(obj));
        // Clear old unit sprites
        this.pools.unitSprites.forEach(sprite => sprite.destroy());
        this.pools.unitSprites.clear();
        this.containers.units.removeAll(true);

        // Group by position
        const groups = new Map();
        units.filter(u => u.hp > 0).forEach(unit => {
            const key = `${unit.x},${unit.y}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(unit);
        });

        // Render groups
        groups.forEach((groupUnits, key) => {
            const [x, y] = key.split(',').map(Number);
            const topUnit = groupUnits[0];
            const px = x * CONFIG.TILE_SIZE;
            const py = y * CONFIG.TILE_SIZE;

            const sprite = this.scene.add.image(
                px,
                py,
                `${topUnit.type}_${topUnit.owner}`
            );
            sprite.setOrigin(0, 0);
            this.containers.units.add(sprite);
            this.pools.unitSprites.set(topUnit.id, sprite);

            // Idle animation for unselected units (gentle floating)
            if (!selectedUnit || !groupUnits.includes(selectedUnit)) {
                // Stagger animations so units don't bob in sync
                const delay = ((x * 17) + (y * 31)) % 1000;
                this.scene.tweens.add({
                    targets: sprite,
                    y: py - 3,
                    duration: 1500,
                    delay: delay,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });

                // Dragon special animation - pulsing wings (scale effect)
                if (topUnit.type === 'DRAGON') {
                    this.scene.tweens.add({
                        targets: sprite,
                        scaleX: 1.02,
                        duration: 800,
                        delay: delay,
                        yoyo: true,
                        repeat: -1,
                        ease: 'Sine.easeInOut'
                    });
                }
            }

            // HP Bar above unit
            if (topUnit.hp < topUnit.maxHp) {
                const barWidth = 24;
                const barHeight = 4;
                const barX = px + (CONFIG.TILE_SIZE - barWidth) / 2;
                const barY = py - 6;

                // Background
                const bg = this.scene.add.graphics();
                bg.fillStyle(0x000000, 0.7);
                bg.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
                this.containers.units.add(bg);

                // Health color based on percentage
                const hpPercent = topUnit.hp / topUnit.maxHp;
                const hpColor = hpPercent > 0.6 ? 0x00FF00 : hpPercent > 0.3 ? 0xFFFF00 : 0xFF0000;

                const hpBar = this.scene.add.graphics();
                hpBar.fillStyle(hpColor, 1);
                hpBar.fillRect(barX, barY, barWidth * hpPercent, barHeight);
                this.containers.units.add(hpBar);
            }

            // Status icons for unit (text-based for compatibility)
            const statusX = px + 4;
            let statusY = py + 4;

            if (topUnit.isHero) {
                const crown = this.scene.add.text(statusX, statusY, 'H', {
                    fontSize: '10px',
                    fontFamily: 'Press Start 2P',
                    color: '#FFD700',
                    backgroundColor: '#000000'
                }).setOrigin(0, 0);
                this.containers.units.add(crown);
                statusY += 14;
            }

            if (topUnit.hasMoved) {
                const moved = this.scene.add.text(statusX, statusY, 'M', {
                    fontSize: '9px',
                    fontFamily: 'Press Start 2P',
                    color: '#FFFF00',
                    backgroundColor: '#000000'
                }).setOrigin(0, 0);
                this.containers.units.add(moved);
                statusY += 12;
            }

            if (topUnit.hasAttacked) {
                const attacked = this.scene.add.text(statusX, statusY, 'A', {
                    fontSize: '9px',
                    fontFamily: 'Press Start 2P',
                    color: '#FF6B6B',
                    backgroundColor: '#000000'
                }).setOrigin(0, 0);
                this.containers.units.add(attacked);
            }

            // Note: Stack counter removed - 1 unit per tile limit

            // Selection highlight with hop animation
            if (selectedUnit && groupUnits.includes(selectedUnit)) {
                const highlight = this.scene.add.image(
                    px,
                    py,
                    'highlight_select'
                );
                highlight.setOrigin(0, 0);
                this.containers.units.add(highlight);

                // Hop animation for selected unit
                const originalY = sprite.y;
                this.scene.tweens.add({
                    targets: sprite,
                    y: originalY - 8,
                    duration: 200,
                    yoyo: true,
                    ease: 'Quad.easeOut'
                });

                // Animate highlight to pulse
                this.scene.tweens.add({
                    targets: highlight,
                    alpha: { from: 1, to: 0.5 },
                    duration: 500,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
            }
        });
    }

    highlightTiles(tiles) {
        // Stop all tweens on highlight objects before removing them
        this.containers.highlights.list.forEach(obj => this.scene.tweens.killTweensOf(obj));
        this.containers.highlights.removeAll(true);

        tiles.forEach(tile => {
            const texture = tile.isEnemy ? 'highlight_attack' :
                tile.isRanged ? 'highlight_ranged' : 'highlight_move';
            const img = this.scene.add.image(
                tile.x * CONFIG.TILE_SIZE,
                tile.y * CONFIG.TILE_SIZE,
                texture
            );
            img.setOrigin(0, 0);
            img.setAlpha(0.8);
            this.containers.highlights.add(img);

            // Add pulsing animation
            this.scene.tweens.add({
                targets: img,
                alpha: { from: 0.8, to: 0.4 },
                duration: 800,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });

            // Add subtle scale pulse for attack highlights
            if (tile.isEnemy) {
                this.scene.tweens.add({
                    targets: img,
                    scaleX: { from: 1, to: 1.05 },
                    scaleY: { from: 1, to: 1.05 },
                    duration: 600,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut'
                });
            }
        });
    }

    clearHighlights() {
        // Stop all tweens on highlight objects before removing them
        this.containers.highlights.list.forEach(obj => this.scene.tweens.killTweensOf(obj));
        this.containers.highlights.removeAll(true);
    }

    /**
     * Create particle effect for combat/attacks
     * @param {number} x - Tile X coordinate
     * @param {number} y - Tile Y coordinate
     * @param {string} type - Effect type: 'hit', 'ranged', 'catapult', 'dragon'
     * @param {number} color - Primary color for particles
     */
    createParticleEffect(x, y, type, color = 0xFF0000) {
        const px = x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
        const py = y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2;
        const container = this.scene.add.container(px, py);
        this.containers.units.add(container);

        const createParticle = (angle, speed, size, color, duration) => {
            const p = this.scene.add.circle(0, 0, size, color);
            container.add(p);
            return { sprite: p, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
        };

        if (type === 'hit' || type === 'melee') {
            // Blood/debris spray
            const particles = [];
            const particleCount = 8;
            for (let i = 0; i < particleCount; i++) {
                const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.5;
                const speed = 2 + Math.random() * 3;
                particles.push(createParticle(angle, speed, 2 + Math.random() * 2, color || 0xCC0000, 600));
            }

            // Animate particles
            this.scene.tweens.add({
                targets: container,
                alpha: 0,
                duration: 600,
                onUpdate: () => {
                    particles.forEach(p => {
                        p.sprite.x += p.vx;
                        p.sprite.y += p.vy;
                        p.vy += 0.3; // gravity
                    });
                },
                onComplete: () => container.destroy()
            });

            // Impact flash
            const flash = this.scene.add.circle(px, py, 20, 0xFFFFFF, 0.8);
            this.containers.units.add(flash);
            this.scene.tweens.add({
                targets: flash,
                scale: 2,
                alpha: 0,
                duration: 200,
                onComplete: () => flash.destroy()
            });

        } else if (type === 'ranged' || type === 'arrow') {
            // Arrow impact with dust
            const particles = [];
            for (let i = 0; i < 5; i++) {
                const angle = (Math.PI * i) / 2.5 - Math.PI / 2;
                particles.push(createParticle(angle, 1.5, 2, 0x8B7355, 400));
            }

            this.scene.tweens.add({
                targets: container,
                alpha: 0,
                duration: 400,
                onUpdate: () => {
                    particles.forEach(p => {
                        p.sprite.x += p.vx;
                        p.sprite.y += p.vy;
                    });
                },
                onComplete: () => container.destroy()
            });

        } else if (type === 'catapult') {
            // Explosion effect
            const particles = [];
            for (let i = 0; i < 12; i++) {
                const angle = (Math.PI * 2 * i) / 12;
                const speed = 3 + Math.random() * 4;
                const colors = [0x333333, 0x555555, 0x777777, 0x8B4513];
                particles.push(createParticle(angle, speed, 3 + Math.random() * 3, colors[i % 4], 800));
            }

            // Explosion flash
            const flash = this.scene.add.circle(px, py, 30, 0xFF6600, 0.7);
            this.containers.units.add(flash);

            this.scene.tweens.add({
                targets: container,
                alpha: 0,
                duration: 800,
                onUpdate: () => {
                    particles.forEach(p => {
                        p.sprite.x += p.vx;
                        p.sprite.y += p.vy;
                        p.vy += 0.25;
                    });
                },
                onComplete: () => {
                    container.destroy();
                    flash.destroy();
                }
            });

            this.scene.tweens.add({
                targets: flash,
                scale: 1.5,
                alpha: 0,
                duration: 300
            });

        } else if (type === 'dragon') {
            // Fire breath effect
            const particles = [];
            for (let i = 0; i < 15; i++) {
                const angle = Math.PI + (Math.random() - 0.5) * 0.5; // Leftward cone
                const speed = 4 + Math.random() * 3;
                const colors = [0xFF0000, 0xFF6600, 0xFFAA00, 0xFFFF00];
                particles.push(createParticle(angle, speed, 4 + Math.random() * 3, colors[i % 4], 500));
            }

            this.scene.tweens.add({
                targets: container,
                alpha: 0,
                duration: 500,
                onUpdate: () => {
                    particles.forEach(p => {
                        p.sprite.x += p.vx;
                        p.sprite.y += p.vy;
                        p.vx *= 0.95; // drag
                        p.vy *= 0.95;
                    });
                },
                onComplete: () => container.destroy()
            });

            // Fire glow
            const glow = this.scene.add.circle(px - 20, py, 25, 0xFF6600, 0.4);
            this.containers.units.add(glow);
            this.scene.tweens.add({
                targets: glow,
                alpha: 0,
                scale: 1.5,
                duration: 400,
                onComplete: () => glow.destroy()
            });
        }
    }
}
