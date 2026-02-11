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

        while (queue.length > 0) {
            const current = queue.shift();

            [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
                const nx = current.x + dx;
                const ny = current.y + dy;
                const key = `${nx},${ny}`;

                if (!gameMap.isValid(nx, ny) || visited.has(key)) return;

                const cost = gameMap.getMovementCost(nx, ny, unit.type);
                if (cost === Infinity) return;

                // Zone of Control logic:
                // If starting in ZOC, can only move to adjacent tiles (cost 1)
                // Cannot move through or past enemy units
                if (startsInZOC) {
                    // Can only move 1 tile when in ZOC
                    if (current.cost >= 1) return;
                } else {
                    // Check if entering ZOC - if so, can only move 1 more tile
                    const enteringZOC = this.isInZoneOfControl(nx, ny, unit, gameMap);
                    if (enteringZOC && current.cost >= unit.effectiveMovement - 1) {
                        // Can move into ZOC only if we have exactly 1 movement left
                        // (effectively stopping after 1 tile in ZOC)
                    }
                }

                const totalCost = current.cost + cost;
                if (totalCost > unit.effectiveMovement) return;

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
                    return;
                }

                // Check if trying to stop on a friendly unit (1 unit per tile limit)
                // Units can pass through friendly tiles but cannot stop there
                if (targetStack && targetStack.owner === unit.owner) {
                    // Can pass through but not stop - don't add to result as a valid stop
                    // Still need to continue BFS for paths through this tile
                    visited.set(key, totalCost);
                    queue.push({ x: nx, y: ny, cost: totalCost });
                    return;
                }

                // If entering Zone of Control, mark it
                const isEnteringZOC = !startsInZOC && this.isInZoneOfControl(nx, ny, unit, gameMap);

                visited.set(key, totalCost);
                queue.push({ x: nx, y: ny, cost: totalCost });

                result.push({ x: nx, y: ny, cost: totalCost, isEnemy: false, isZOC: isEnteringZOC });
            });
        }

        return result;
    }

    /**
     * Get attack targets within range (for after movement)
     */
    static getAttackTargets(unit, gameMap) {
        const targets = [];

        for (let y = 0; y < gameMap.height; y++) {
            for (let x = 0; x < gameMap.width; x++) {
                // Use Chebyshev distance for attacks (allows diagonal attacks)
                const dist = Utils.chebyshevDistance(unit.x, unit.y, x, y);
                if (dist <= unit.range && dist > 0) {
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
