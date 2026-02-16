import { CONFIG, TERRAIN, CITY_INCOME, RUIN_REWARD_TYPES } from '../constants.js';
import { Utils } from '../utils.js';
import { City } from '../models/City.js';
import { Unit } from '../models/Unit.js';

/**
 * MapGenerator - handles map initialization, terrain generation, and placement of cities/ruins
 */
export class MapGenerator {
    constructor(game) {
        this.game = game;
        this.map = game.map;
        this.players = game.players;
    }

    /**
     * Generate complete map with terrain, cities, and ruins
     */
    generate(mapWidth, mapHeight, gameConfig = {}) {
        const { numCities, numRuins } = gameConfig;

        this.generateTerrain(mapWidth, mapHeight);
        this.balanceTerrainForFairness(mapWidth, mapHeight);
        this.setupInitialPositions(mapWidth, mapHeight);
        this.setupNeutralCities(mapWidth, mapHeight, numCities);
        this.setupRuins(mapWidth, mapHeight, numRuins);
    }

    /**
     * Generate base terrain using cellular automata
     */
    generateTerrain(mapWidth, mapHeight) {
        // Initialize with random terrain
        for (let y = 0; y < mapHeight; y++) {
            for (let x = 0; x < mapWidth; x++) {
                // Edge tiles more likely to be water
                const isEdge = x < 2 || x >= mapWidth - 2 || y < 2 || y >= mapHeight - 2;
                const waterChance = isEdge ? 0.4 : 0.1;
                const mountainChance = isEdge ? 0.1 : 0.15;

                if (Math.random() < waterChance) {
                    this.map.terrain[y][x] = TERRAIN.WATER;
                } else if (Math.random() < mountainChance) {
                    this.map.terrain[y][x] = TERRAIN.MOUNTAINS;
                } else if (Math.random() < 0.3) {
                    this.map.terrain[y][x] = TERRAIN.FOREST;
                } else {
                    this.map.terrain[y][x] = TERRAIN.PLAINS;
                }
            }
        }

        // Smooth terrain using cellular automata
        for (let i = 0; i < 4; i++) {
            this.smoothTerrain();
        }
    }

    /**
     * Smooth terrain by applying cellular automata rules
     */
    smoothTerrain() {
        const newTerrain = this.map.terrain.map(row => [...row]);

        for (let y = 0; y < this.map.height; y++) {
            for (let x = 0; x < this.map.width; x++) {
                const counts = this.countNeighbors(x, y);

                if (this.map.terrain[y][x] === TERRAIN.WATER) {
                    if (counts.water < 3) newTerrain[y][x] = TERRAIN.PLAINS;
                } else if (this.map.terrain[y][x] === TERRAIN.PLAINS) {
                    if (counts.water >= 5) newTerrain[y][x] = TERRAIN.WATER;
                    else if (counts.forest >= 4) newTerrain[y][x] = TERRAIN.FOREST;
                    else if (counts.mountains >= 5) newTerrain[y][x] = TERRAIN.MOUNTAINS;
                } else if (this.map.terrain[y][x] === TERRAIN.FOREST) {
                    if (counts.water >= 4) newTerrain[y][x] = TERRAIN.PLAINS;
                } else if (this.map.terrain[y][x] === TERRAIN.MOUNTAINS) {
                    if (counts.water >= 5) newTerrain[y][x] = TERRAIN.PLAINS;
                }
            }
        }

        this.map.terrain = newTerrain;
    }

    /**
     * Count terrain type neighbors
     */
    countNeighbors(x, y) {
        const counts = { water: 0, plains: 0, forest: 0, mountains: 0 };

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (this.map.isValid(nx, ny)) {
                    const t = this.map.terrain[ny][nx];
                    if (t === TERRAIN.WATER) counts.water++;
                    else if (t === TERRAIN.PLAINS) counts.plains++;
                    else if (t === TERRAIN.FOREST) counts.forest++;
                    else if (t === TERRAIN.MOUNTAINS) counts.mountains++;
                }
            }
        }
        return counts;
    }

    /**
     * Ensure fair terrain distribution - give each player reasonable land
     */
    balanceTerrainForFairness(mapWidth, mapHeight) {
        const corners = [
            { x: 1, y: 1 },
            { x: mapWidth - 2, y: mapHeight - 2 },
            { x: 1, y: mapHeight - 2 },
            { x: mapWidth - 2, y: 1 }
        ];

        // Ensure each player corner has mostly flat terrain
        for (let i = 0; i < this.players.length; i++) {
            const corner = corners[i];
            if (!corner) continue;

            for (let dy = -3; dy <= 3; dy++) {
                for (let dx = -3; dx <= 3; dx++) {
                    const x = corner.x + dx;
                    const y = corner.y + dy;
                    if (this.map.isValid(x, y)) {
                        if (this.map.terrain[y][x] === TERRAIN.WATER) {
                            this.map.terrain[y][x] = TERRAIN.PLAINS;
                        }
                    }
                }
            }
        }
    }

    /**
     * Setup initial player positions (cities and starting units)
     */
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

            // Place hero adjacent to city
            const heroX = pos.x + 1;
            const heroY = pos.y;
            const hero = new Unit('HERO', player.id, heroX, heroY);
            this.map.addUnit(hero);
            player.units.push(hero);

            // Place light infantry around the city
            const unitPositions = [
                { x: pos.x - 1, y: pos.y },
                { x: pos.x, y: pos.y + 1 },
                { x: pos.x, y: pos.y - 1 }
            ];

            let unitsPlaced = 0;
            for (const p of unitPositions) {
                if (unitsPlaced >= 2) break;
                if (this.map.isValid(p.x, p.y)) {
                    if (p.x !== heroX || p.y !== heroY) {
                        this.map.terrain[p.y][p.x] = TERRAIN.PLAINS;
                        const li = new Unit('LIGHT_INFANTRY', player.id, p.x, p.y);
                        this.map.addUnit(li);
                        player.units.push(li);
                        unitsPlaced++;
                    }
                }
            }
        });
    }

    /**
     * Setup neutral cities with sector-based placement
     */
    setupNeutralCities(mapWidth, mapHeight, numCities = null) {
        let numNeutral;
        if (numCities !== undefined && numCities !== null) {
            numNeutral = numCities;
        } else {
            const areaRatio = (mapWidth * mapHeight) / (CONFIG.MAP_WIDTH * CONFIG.MAP_HEIGHT);
            numNeutral = Math.floor(Utils.randomInt(10, 16) * areaRatio);
        }

        const numPlayers = this.players.length;
        const sectorCities = Math.floor(numNeutral * 0.6);
        const contestedCities = numNeutral - sectorCities;
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
     * Get sector bounds for a player
     */
    getPlayerSector(playerIdx, mapWidth, mapHeight) {
        const margin = 3;
        const centerX = Math.floor(mapWidth / 2);
        const centerY = Math.floor(mapHeight / 2);

        const sectors = [
            { x1: margin, y1: margin, x2: centerX - 1, y2: centerY - 1 },
            { x1: margin, y1: centerY, x2: centerX - 1, y2: mapHeight - margin - 1 },
            { x1: centerX, y1: centerY, x2: mapWidth - margin - 1, y2: mapHeight - margin - 1 },
            { x1: centerX, y1: margin, x2: mapWidth - margin - 1, y2: centerY - 1 }
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
     * Place cities in a sector
     */
    placeCitiesInSector(sector, count, preferredPlayerIdx, mapWidth, mapHeight) {
        const sizes = ['small', 'medium', 'medium', 'large'];
        const minDistFromStart = 5;
        const minDistBetweenCities = 4;

        for (let i = 0; i < count; i++) {
            let bestPos = null;
            let bestScore = -Infinity;

            for (let attempt = 0; attempt < 50; attempt++) {
                const x = Utils.randomInt(sector.x1, sector.x2);
                const y = Utils.randomInt(sector.y1, sector.y2);

                if (!this.isValidCityPosition(x, y)) continue;

                const score = this.evaluateCityPosition(x, y, preferredPlayerIdx, minDistFromStart, minDistBetweenCities);

                if (score > bestScore) {
                    bestScore = score;
                    bestPos = { x, y };
                }
            }

            if (bestPos && bestScore > 0) {
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
     * Evaluate city position score
     */
    evaluateCityPosition(x, y, preferredPlayerIdx, minDistFromStart, minDistBetweenCities) {
        let score = 100;

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
                if (dist < minDistFromStart) {
                    score -= 200;
                } else if (dist >= 5 && dist <= 10) {
                    score += 50;
                } else if (dist > 10 && dist <= 15) {
                    score += 20;
                } else {
                    score -= 10;
                }
            } else {
                if (dist < minDistFromStart) {
                    score -= 30;
                } else if (dist >= 8) {
                    score += 10;
                }
            }
        }

        for (const city of this.map.cities) {
            const dist = Utils.manhattanDistance(x, y, city.x, city.y);
            if (dist < minDistBetweenCities) {
                score -= 100;
            } else if (dist >= 4 && dist <= 8) {
                score += 15;
            }
        }

        const accessibleTiles = this.countAccessibleTiles(x, y, 3);
        score += accessibleTiles * 3;

        const terrain = this.map.getTerrain(x, y);
        if (terrain === TERRAIN.PLAINS) score += 10;
        if (terrain === TERRAIN.FOREST) score += 5;
        if (terrain === TERRAIN.MOUNTAINS) score -= 5;

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
     * Weighted random selection
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

    /**
     * Setup ruins on the map
     */
    setupRuins(mapWidth, mapHeight, numRuins = null) {
        let actualNumRuins;
        if (numRuins !== undefined && numRuins !== null) {
            actualNumRuins = numRuins;
        } else {
            const areaRatio = (mapWidth * mapHeight) / (CONFIG.MAP_WIDTH * CONFIG.MAP_HEIGHT);
            actualNumRuins = Math.floor(Utils.randomInt(10, 16) * areaRatio);
        }

        const pathRuins = Math.floor(actualNumRuins * 0.5);
        const scatterRuins = actualNumRuins - pathRuins;

        const paths = this.findKeyPaths();
        this.placeRuinsOnPaths(paths, pathRuins);

        this.scatterRuinsEvenly(scatterRuins, mapWidth, mapHeight);
    }

    /**
     * Find key paths between important locations
     */
    findKeyPaths() {
        const paths = [];
        const corners = [
            { x: 1, y: 1 },
            { x: this.map.width - 2, y: this.map.height - 2 },
            { x: 1, y: this.map.height - 2 },
            { x: this.map.width - 2, y: 1 }
        ];

        // Connect all starting corners
        for (let i = 0; i < corners.length; i++) {
            for (let j = i + 1; j < corners.length; j++) {
                const start = corners[i];
                const end = corners[j];
                if (start && end) {
                    paths.push(this.findPath(start.x, start.y, end.x, end.y));
                }
            }
        }

        // Connect corners to neutral cities
        for (const city of this.map.cities) {
            if (!city.owner) {
                for (const corner of corners) {
                    if (corner) {
                        const path = this.findPath(corner.x, corner.y, city.x, city.y);
                        if (path.length > 0) {
                            paths.push(path);
                        }
                    }
                }
            }
        }

        return paths;
    }

    /**
     * Simple pathfinding using BFS
     */
    findPath(startX, startY, endX, endY) {
        const visited = new Set();
        const queue = [{ x: startX, y: startY, path: [] }];
        visited.add(`${startX},${startY}`);

        while (queue.length > 0) {
            const { x, y, path } = queue.shift();

            if (x === endX && y === endY) {
                return path;
            }

            const directions = [
                { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
                { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
            ];

            for (const dir of directions) {
                const nx = x + dir.dx;
                const ny = y + dir.dy;
                const key = `${nx},${ny}`;

                if (this.map.isValid(nx, ny) && !visited.has(key)) {
                    const terrain = this.map.getTerrain(nx, ny);
                    if (terrain !== TERRAIN.WATER) {
                        visited.add(key);
                        queue.push({
                            x: nx, y: ny,
                            path: [...path, { x: nx, y: ny }]
                        });
                    }
                }
            }
        }

        return [];
    }

    /**
     * Place ruins along paths
     */
    placeRuinsOnPaths(paths, count) {
        const allPathTiles = new Set();
        for (const path of paths) {
            for (const tile of path) {
                allPathTiles.add(`${tile.x},${tile.y}`);
            }
        }

        const tiles = Array.from(allPathTiles).map(key => {
            const [x, y] = key.split(',').map(Number);
            return { x, y };
        });

        // Shuffle and pick
        Utils.shuffleArray(tiles);

        for (let i = 0; i < Math.min(count, tiles.length); i++) {
            const tile = tiles[i];
            if (this.isValidRuinPosition(tile.x, tile.y)) {
                this.map.addRuin(tile.x, tile.y, this.generateRuinReward());
            }
        }
    }

    /**
     * Scatter ruins evenly across the map
     */
    scatterRuinsEvenly(count, mapWidth, mapHeight) {
        const margin = 3;
        let placed = 0;
        let attempts = 0;

        while (placed < count && attempts < 500) {
            const x = Utils.randomInt(margin, mapWidth - margin - 1);
            const y = Utils.randomInt(margin, mapHeight - margin - 1);

            if (this.isValidRuinPosition(x, y)) {
                this.map.addRuin(x, y, this.generateRuinReward());
                placed++;
            }
            attempts++;
        }
    }

    /**
     * Check if position is valid for a ruin
     */
    isValidRuinPosition(x, y) {
        if (this.map.getCity(x, y)) return false;
        if (this.map.getRuin(x, y)) return false;
        if (this.map.getTerrain(x, y) === TERRAIN.WATER) return false;
        return true;
    }

    /**
     * Generate random ruin reward
     */
    generateRuinReward() {
        const rand = Math.random();
        if (rand < 0.35) return RUIN_REWARD_TYPES.GOLD_50;
        if (rand < 0.60) return RUIN_REWARD_TYPES.GOLD_100;
        if (rand < 0.85) return RUIN_REWARD_TYPES.RANDOM_UNIT;
        return RUIN_REWARD_TYPES.NEW_CITY;
    }

    /**
     * Check if position is near any starting position
     */
    isNearStartingPosition(x, y, radius = 4) {
        const corners = [
            { x: 1, y: 1 },
            { x: this.map.width - 2, y: this.map.height - 2 },
            { x: 1, y: this.map.height - 2 },
            { x: this.map.width - 2, y: 1 }
        ];

        for (const corner of corners) {
            const dist = Utils.manhattanDistance(x, y, corner.x, corner.y);
            if (dist < radius) return true;
        }
        return false;
    }
}
