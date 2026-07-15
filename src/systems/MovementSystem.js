import { Utils } from '../utils.js';

export class MovementSystem {
    /**
     * Check if position is adjacent to an enemy unit (Zone of Control)
     */
    static isInZoneOfControl(x, y, unit, gameMap) {
        const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            const stack = gameMap.getStack(nx, ny);
            if (stack && stack.owner !== unit.owner) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get all adjacent enemy positions
     */
    static getAdjacentEnemies(x, y, unit, gameMap) {
        const enemies = [];
        const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            const stack = gameMap.getStack(nx, ny);
            if (stack && stack.owner !== unit.owner) {
                enemies.push({ x: nx, y: ny });
            }
        }
        return enemies;
    }

    static getReachableTiles(unit, gameMap) {
        const visited = new Map();
        const queue = [{ x: unit.x, y: unit.y, cost: 0 }];
        visited.set(`${unit.x},${unit.y}`, 0);

        const result = [];

        // Check if starting position is in Zone of Control
        const startsInZOC = this.isInZoneOfControl(unit.x, unit.y, unit, gameMap);

        // Pre-compute ZOC for all tiles that could be reached (bounded exploration)
        const maxRange = unit.effectiveMovement;
        const zocCache = new Map();

        const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];

        while (queue.length > 0) {
            const current = queue.shift();

            for (const [dx, dy] of directions) {
                const nx = current.x + dx;
                const ny = current.y + dy;
                const key = `${nx},${ny}`;

                if (!gameMap.isValid(nx, ny) || visited.has(key)) continue;

                const cost = gameMap.getMovementCost(nx, ny, unit.type);
                if (cost === Infinity) continue;

                // Zone of Control logic:
                // If starting in ZOC, can only move to adjacent tiles (cost 1)
                // Cannot move through or past enemy units
                if (startsInZOC) {
                    // Can only move 1 tile when in ZOC
                    if (current.cost >= 1) continue;
                } else {
                    // Check if entering ZOC - compute once and cache
                    if (!zocCache.has(key)) {
                        zocCache.set(key, this.isInZoneOfControl(nx, ny, unit, gameMap));
                    }
                    const enteringZOC = zocCache.get(key);
                    if (enteringZOC && current.cost >= unit.effectiveMovement - 1) {
                        // Can move into ZOC only if we have exactly 1 movement left
                    }
                }

                const totalCost = current.cost + cost;
                if (totalCost > unit.effectiveMovement) continue;

                // Check if trying to move past an enemy (cannot move through ZOC tiles)
                const targetStack = gameMap.getStack(nx, ny);
                if (targetStack && targetStack.owner !== unit.owner) {
                    // Check if enemy is within attack range (using Chebyshev for 8-direction)
                    const distToEnemy = Utils.chebyshevDistance(unit.x, unit.y, nx, ny);
                    if (distToEnemy <= unit.range) {
                        // Enemy is attackable - show as attack target
                        result.push({ x: nx, y: ny, cost: totalCost, isEnemy: true });
                    }
                    // Cannot move past enemy tiles regardless
                    continue;
                }

                // Check if trying to stop on a friendly unit (1 unit per tile limit)
                // Units can pass through friendly tiles but cannot stop there
                if (targetStack && targetStack.owner === unit.owner) {
                    // Can pass through but not stop - don't add to result as a valid stop
                    // Still need to continue BFS for paths through this tile
                    visited.set(key, totalCost);
                    queue.push({ x: nx, y: ny, cost: totalCost });
                    continue;
                }

                // If entering Zone of Control, mark it (use cached value)
                const isEnteringZOC = !startsInZOC && (zocCache.get(key) || false);

                visited.set(key, totalCost);
                queue.push({ x: nx, y: ny, cost: totalCost });

                result.push({ x: nx, y: ny, cost: totalCost, isEnemy: false, isZOC: isEnteringZOC });
            }
        }

        return result;
    }

    /**
     * Get attack targets within range (for after movement)
     * Optimized: only search within range instead of entire map
     */
    static getAttackTargets(unit, gameMap) {
        const targets = [];
        const range = unit.range;

        // Only search tiles within attack range (bounding box optimization)
        const minX = Math.max(0, unit.x - range);
        const maxX = Math.min(gameMap.width - 1, unit.x + range);
        const minY = Math.max(0, unit.y - range);
        const maxY = Math.min(gameMap.height - 1, unit.y + range);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                // Use Chebyshev distance for attacks (allows diagonal attacks)
                const dist = Utils.chebyshevDistance(unit.x, unit.y, x, y);
                if (dist <= range && dist > 0) {
                    const stack = gameMap.getStack(x, y);
                    if (stack && stack.owner !== unit.owner) {
                        targets.push({ x, y, isEnemy: true, isRanged: dist > 1 });
                    }
                }
            }
        }

        return targets;
    }
}
