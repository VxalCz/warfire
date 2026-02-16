import { CONFIG, TERRAIN, TERRAIN_DEFENSE, UNIT_DEFINITIONS, RUIN_REWARD_TYPES } from '../constants.js';
import { Utils, Events } from '../utils.js';
import { City } from '../models/City.js';
import { Stack } from '../models/Stack.js';

export class GameMap {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.terrain = [];
        this.cities = [];
        this.ruins = [];
        this.units = [];
        this.decorations = []; // Visual-only decorative elements

        // Spatial index for O(1) lookups (instead of O(n) find/filter)
        this.cityGrid = [];
        this.ruinGrid = [];
        this.unitGrid = [];

        this.generate();
    }

    generate() {
        // Initialize terrain
        for (let y = 0; y < this.height; y++) {
            this.terrain[y] = [];
            for (let x = 0; x < this.width; x++) {
                this.terrain[y][x] = TERRAIN.PLAINS;
            }
        }

        // Initialize spatial grids
        for (let y = 0; y < this.height; y++) {
            this.cityGrid[y] = [];
            this.ruinGrid[y] = [];
            this.unitGrid[y] = [];
            for (let x = 0; x < this.width; x++) {
                this.cityGrid[y][x] = null;
                this.ruinGrid[y][x] = null;
                this.unitGrid[y][x] = [];
            }
        }

        this.addPatches(TERRAIN.FOREST, 0.2);
        this.addPatches(TERRAIN.MOUNTAINS, 0.15);
        this.addPatches(TERRAIN.WATER, 0.05);
        this.generateDecorations();
    }

    generateDecorations() {
        // Add decorative elements that don't affect gameplay
        const seededRandom = (seed) => {
            let x = Math.sin(seed) * 10000;
            return x - Math.floor(x);
        };

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const terrain = this.terrain[y][x];
                const seed = x * 37 + y * 73;

                // Skip if there's a city or ruin here (use O(1) grid lookup)
                if (this.cityGrid[y][x] || this.ruinGrid[y][x]) continue;

                if (terrain === TERRAIN.PLAINS) {
                    // Rocks on plains (10% chance)
                    if (seededRandom(seed) < 0.1) {
                        this.decorations.push({ x, y, type: 'rock', variant: Math.floor(seededRandom(seed + 1) * 3) });
                    }
                    // Flower patches (8% chance)
                    else if (seededRandom(seed + 2) < 0.08) {
                        this.decorations.push({ x, y, type: 'flowers', variant: Math.floor(seededRandom(seed + 3) * 4) });
                    }
                    // Small hillock (5% chance)
                    else if (seededRandom(seed + 4) < 0.05) {
                        this.decorations.push({ x, y, type: 'hillock', variant: 0 });
                    }
                } else if (terrain === TERRAIN.FOREST) {
                    // Fallen log (5% chance)
                    if (seededRandom(seed + 5) < 0.05) {
                        this.decorations.push({ x, y, type: 'log', variant: Math.floor(seededRandom(seed + 6) * 2) });
                    }
                    // Mushroom cluster (4% chance)
                    else if (seededRandom(seed + 7) < 0.04) {
                        this.decorations.push({ x, y, type: 'mushrooms', variant: Math.floor(seededRandom(seed + 8) * 3) });
                    }
                } else if (terrain === TERRAIN.WATER) {
                    // Water lily (8% chance)
                    if (seededRandom(seed + 9) < 0.08) {
                        this.decorations.push({ x, y, type: 'lily', variant: Math.floor(seededRandom(seed + 10) * 2) });
                    }
                    // Small rock in water (3% chance)
                    else if (seededRandom(seed + 11) < 0.03) {
                        this.decorations.push({ x, y, type: 'water_rock', variant: 0 });
                    }
                }
            }
        }
    }

    addPatches(type, ratio) {
        const target = Math.floor(this.width * this.height * ratio);
        let placed = 0;
        while (placed < target) {
            const x = Utils.randomInt(0, this.width - 1);
            const y = Utils.randomInt(0, this.height - 1);
            if (this.terrain[y][x] === TERRAIN.PLAINS) {
                this.terrain[y][x] = type;
                placed++;
                this.getNeighbors(x, y).forEach(n => {
                    if (Math.random() < 0.5 && placed < target && this.terrain[n.y][n.x] === TERRAIN.PLAINS) {
                        this.terrain[n.y][n.x] = type;
                        placed++;
                    }
                });
            }
        }
    }

    getNeighbors(x, y) {
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        return dirs.map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
            .filter(p => this.isValid(p.x, p.y));
    }

    isValid(x, y) {
        return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }

    getTerrain(x, y) {
        return this.isValid(x, y) ? this.terrain[y][x] : null;
    }

    getDefenseBonus(x, y) {
        return TERRAIN_DEFENSE[this.getTerrain(x, y)] || 0;
    }

    getMovementCost(x, y, unitType) {
        const terrain = this.getTerrain(x, y);
        const def = UNIT_DEFINITIONS[unitType];
        if (!def.canEnter.includes(terrain)) return Infinity;
        return terrain === TERRAIN.MOUNTAINS ? 2 : 1;
    }

    // O(1) lookup using spatial grid
    getCity(x, y) {
        if (!this.isValid(x, y)) return null;
        return this.cityGrid[y][x];
    }

    // O(1) lookup using spatial grid (only unexplored ruins)
    getRuin(x, y) {
        if (!this.isValid(x, y)) return null;
        const ruin = this.ruinGrid[y][x];
        return ruin && !ruin.explored ? ruin : null;
    }

    // O(1) lookup using spatial grid
    getUnitsAt(x, y) {
        if (!this.isValid(x, y)) return [];
        return this.unitGrid[y][x].filter(u => u.hp > 0);
    }

    getStack(x, y) {
        const units = this.getUnitsAt(x, y);
        return units.length > 0 ? Stack.fromUnits(units, x, y) : null;
    }

    moveUnit(unit, x, y) {
        Utils.assert(this.isValid(x, y), 'Invalid coordinates');

        // Remove from old position in unit grid
        if (this.isValid(unit.x, unit.y)) {
            const oldIdx = this.unitGrid[unit.y][unit.x].indexOf(unit);
            if (oldIdx > -1) {
                this.unitGrid[unit.y][unit.x].splice(oldIdx, 1);
            }
        }

        // Update unit position
        const oldX = unit.x;
        const oldY = unit.y;
        unit.x = x;
        unit.y = y;
        unit.hasMoved = true;

        // Add to new position in unit grid
        this.unitGrid[y][x].push(unit);

        Events.emit('unit:moved', { unit, fromX: oldX, fromY: oldY, toX: x, toY: y });
    }

    addCity(city) {
        this.cities.push(city);
        // Add to spatial grid
        if (this.isValid(city.x, city.y)) {
            this.cityGrid[city.y][city.x] = city;
        }
    }

    /**
     * Add a unit to the map (includes grid update)
     */
    addUnit(unit) {
        this.units.push(unit);
        if (this.isValid(unit.x, unit.y)) {
            this.unitGrid[unit.y][unit.x].push(unit);
        }
    }

    /**
     * Remove a unit from the map (includes grid update)
     */
    removeUnit(unit) {
        const idx = this.units.indexOf(unit);
        if (idx > -1) {
            this.units.splice(idx, 1);
        }
        // Remove from grid
        if (this.isValid(unit.x, unit.y)) {
            const gridIdx = this.unitGrid[unit.y][unit.x].indexOf(unit);
            if (gridIdx > -1) {
                this.unitGrid[unit.y][unit.x].splice(gridIdx, 1);
            }
        }
        Events.emit('unit:removed', { unit });
    }

    addRuin(x, y) {
        const ruin = { x, y, explored: false };
        this.ruins.push(ruin);
        // Add to spatial grid
        if (this.isValid(x, y)) {
            this.ruinGrid[y][x] = ruin;
        }
    }

    /**
     * Get random ruin reward type
     * @returns {string} RUIN_REWARD_TYPES value
     */
    getRandomRuinReward() {
        const types = Object.values(RUIN_REWARD_TYPES);
        return types[Utils.randomInt(0, types.length - 1)];
    }

    /**
     * Find adjacent free tiles for spawning unit/city
     * @param {number} x - center x
     * @param {number} y - center y
     * @param {number} owner - player id
     * @returns {Array<{x: number, y: number}>} array of free adjacent tiles
     */
    getAdjacentFreeTiles(x, y, owner) {
        const directions = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        const freeTiles = [];

        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;

            if (!this.isValid(nx, ny)) continue;
            if (this.cityGrid[ny][nx]) continue; // O(1) lookup
            if (this.terrain[ny][nx] === TERRAIN.WATER) continue;

            // Check if tile has any unit (O(1) lookup)
            if (this.unitGrid[ny][nx].length === 0) {
                freeTiles.push({ x: nx, y: ny });
            }
        }

        return freeTiles;
    }

    /**
     * Remove a ruin from the map permanently
     * @param {number} x
     * @param {number} y
     */
    removeRuin(x, y) {
        const idx = this.ruins.findIndex(r => r.x === x && r.y === y);
        if (idx > -1) {
            this.ruins.splice(idx, 1);
            // Remove from grid
            if (this.isValid(x, y)) {
                this.ruinGrid[y][x] = null;
            }
            Events.emit('ruin:removed', { x, y });
        }
    }

    /**
     * Explore a ruin and return the reward type
     * The ruin is removed after exploration
     * @param {number} x
     * @param {number} y
     * @returns {string|null} RUIN_REWARD_TYPES value or null if already explored/removed
     */
    exploreRuin(x, y) {
        const ruin = this.ruinGrid[y][x]; // O(1) lookup
        if (!ruin) return null;

        const rewardType = this.getRandomRuinReward();
        Events.emit('ruin:explored', { x, y, rewardType });

        // Remove the ruin permanently
        this.removeRuin(x, y);

        return rewardType;
    }

    healUnitsInCities() {
        this.cities.forEach(city => {
            if (city.owner === null) return;
            const units = this.getUnitsAt(city.x, city.y).filter(u => u.owner === city.owner);
            units.forEach(u => {
                const healed = u.heal(Math.floor(u.maxHp * 0.2));
                if (healed > 0) {
                    Events.emit('city:healedUnit', { city, unit: u, amount: healed });
                }
            });
        });
    }

    /**
     * Check if a city is blockaded (adjacent to enemy unit)
     * Returns true if city cannot produce due to enemy presence
     */
    isCityBlockaded(city, ownerId) {
        const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of directions) {
            const nx = city.x + dx;
            const ny = city.y + dy;
            if (!this.isValid(nx, ny)) continue;
            // O(1) lookup instead of filter
            const units = this.unitGrid[ny][nx];
            if (units && units.some(u => u.hp > 0 && u.owner !== ownerId)) {
                return true; // Enemy adjacent - city is blockaded
            }
        }
        return false;
    }

    /**
     * Rebuild spatial grids from existing data (used after deserialization)
     */
    rebuildGrids() {
        // Clear grids
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                this.cityGrid[y][x] = null;
                this.ruinGrid[y][x] = null;
                this.unitGrid[y][x] = [];
            }
        }
        // Rebuild city grid
        this.cities.forEach(city => {
            if (this.isValid(city.x, city.y)) {
                this.cityGrid[city.y][city.x] = city;
            }
        });
        // Rebuild ruin grid
        this.ruins.forEach(ruin => {
            if (this.isValid(ruin.x, ruin.y)) {
                this.ruinGrid[ruin.y][ruin.x] = ruin;
            }
        });
        // Rebuild unit grid
        this.units.forEach(unit => {
            if (this.isValid(unit.x, unit.y)) {
                this.unitGrid[unit.y][unit.x].push(unit);
            }
        });
    }

    serialize() {
        return {
            width: this.width,
            height: this.height,
            terrain: this.terrain.map(row => [...row]),
            cities: this.cities.map(c => c.serialize()),
            ruins: this.ruins.map(r => ({ ...r })),
            units: this.units.map(u => u.serialize())
        };
    }
}
