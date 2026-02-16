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
import { TextureGenerator } from '../systems/TextureGenerator.js';
import { MapGenerator } from '../systems/MapGenerator.js';

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

        // Generate textures using TextureGenerator
        const textureGenerator = new TextureGenerator(this.renderer);
        textureGenerator.generateAll();

        this.map = new GameMap(mapWidth, mapHeight);

        // Create players first (needed for map generation)
        this.createPlayers(playerConfigs);

        // Generate map using MapGenerator
        this.mapGenerator = new MapGenerator(this);
        this.mapGenerator.generate(mapWidth, mapHeight, { numCities, numRuins });

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
     * Create player instances from config
     */
    createPlayers(playerConfigs) {
        this.players = playerConfigs.map((config, index) => {
            return new Player(index, COLORS.players[index], config.name, config.isAI);
        });
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
                    // Build city on the ruin location
                    // Unit stays here as garrison (city and unit can coexist)
                    const sizes = ['small', 'medium'];
                    const randomSize = sizes[Utils.randomInt(0, sizes.length - 1)];

                    const newCity = new City(x, y, randomSize, unit.owner);
                    this.map.addCity(newCity);
                    player.cities.push(newCity);

                    this.ui.showMessage(`Ruin found: New ${randomSize} city established!`);
                }
                break;
            }
        }

        // Re-render map to remove the explored ruin visually
        this.renderer.renderMap(this.map, this.getBlockadedCities());
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
