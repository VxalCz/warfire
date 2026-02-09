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
    }

    /**
     * Set camera position with bounds checking
     */
    setCamera(x, y) {
        const maxX = Math.max(0, this.mapWidth - VIEWPORT_WIDTH);
        const maxY = Math.max(0, this.mapHeight - VIEWPORT_HEIGHT);

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
        const x = tx * CONFIG.TILE_SIZE - VIEWPORT_WIDTH / 2 + CONFIG.TILE_SIZE / 2;
        const y = ty * CONFIG.TILE_SIZE - VIEWPORT_HEIGHT / 2 + CONFIG.TILE_SIZE / 2;
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
        this.camera.x = (worldX * newZoom - screenX) / newZoom;
        this.camera.y = (worldY * newZoom - screenY) / newZoom;

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

    renderMap(gameMap) {
        this.containers.map.removeAll(true);

        // Store map dimensions for camera bounds
        this.mapWidth = gameMap.width * CONFIG.TILE_SIZE;
        this.mapHeight = gameMap.height * CONFIG.TILE_SIZE;

        // Render terrain
        const terrainNames = ['plains', 'forest', 'mountains', 'water'];
        for (let y = 0; y < gameMap.height; y++) {
            for (let x = 0; x < gameMap.width; x++) {
                const terrain = gameMap.getTerrain(x, y);
                const tile = this.scene.add.image(x * CONFIG.TILE_SIZE, y * CONFIG.TILE_SIZE, terrainNames[terrain]);
                tile.setOrigin(0, 0);
                this.containers.map.add(tile);
            }
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

        // Render cities
        gameMap.cities.forEach(city => {
            const colorIdx = city.owner !== null ? city.owner : 'neutral';
            const sprite = this.scene.add.image(
                city.x * CONFIG.TILE_SIZE,
                city.y * CONFIG.TILE_SIZE,
                `city_${city.size}_${colorIdx}`
            );
            sprite.setOrigin(0, 0);
            this.containers.map.add(sprite);

            if (city.owner !== null) {
                const text = this.scene.add.text(
                    city.x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
                    city.y * CONFIG.TILE_SIZE - 10,
                    `+${city.income}g`,
                    { fontFamily: 'Press Start 2P', fontSize: '10px', color: '#FFD700' }
                );
                text.setOrigin(0.5, 0.5);
                this.containers.map.add(text);
            }
        });
    }

    renderUnits(units, selectedUnit = null) {
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

            // Status icons for top unit (text-based for compatibility)
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

            // Stack counter
            if (groupUnits.length > 1) {
                const bg = this.scene.add.graphics();
                bg.fillStyle(0x000000, 0.8);
                bg.fillCircle(px + CONFIG.TILE_SIZE - 10, py + 10, 10);
                this.containers.units.add(bg);

                const text = this.scene.add.text(
                    px + CONFIG.TILE_SIZE - 10,
                    py + 10,
                    groupUnits.length.toString(),
                    { fontFamily: 'Press Start 2P', fontSize: '10px', color: '#FFFFFF' }
                );
                text.setOrigin(0.5, 0.5);
                this.containers.units.add(text);
            }

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
        this.containers.highlights.removeAll(true);
    }
}
