import { Utils } from '../utils.js';

export class MovementSystem {
    static getReachableTiles(unit, gameMap) {
        const visited = new Map();
        const queue = [{ x: unit.x, y: unit.y, cost: 0 }];
        visited.set(`${unit.x},${unit.y}`, 0);

        const result = [];

        while (queue.length > 0) {
            const current = queue.shift();

            [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
                const nx = current.x + dx;
                const ny = current.y + dy;
                const key = `${nx},${ny}`;

                if (!gameMap.isValid(nx, ny) || visited.has(key)) return;

                const cost = gameMap.getMovementCost(nx, ny, unit.type);
                if (cost === Infinity) return;

                const totalCost = current.cost + cost;
                if (totalCost > unit.effectiveMovement) return;

                visited.set(key, totalCost);
                queue.push({ x: nx, y: ny, cost: totalCost });

                const stack = gameMap.getStack(nx, ny);
                const isEnemy = stack && stack.owner !== unit.owner;
                result.push({ x: nx, y: ny, cost: totalCost, isEnemy });
            });
        }

        return result;
    }
}
