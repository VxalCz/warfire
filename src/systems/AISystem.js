import { Utils, Events } from '../utils.js';
import { MovementSystem } from './MovementSystem.js';
import { CombatSystem } from './CombatSystem.js';
import { UNIT_DEFINITIONS, CITY_INCOME } from '../constants.js';

/**
 * AI system for controlling bot players
 * Implements turn-based strategy with tactical decisions
 */
export class AISystem {
    constructor(game) {
        this.game = game;
        this.map = game.map;
        this.players = game.players;
        this.isRunning = false;
        this.thinkDelay = 500; // Delay between AI actions for visibility
    }

    /**
     * Execute AI turn for the current player
     */
    async playTurn() {
        if (this.isRunning) return;
        this.isRunning = true;

        const player = this.players[this.game.state.currentPlayerIndex];
        if (!player.isAI || !player.isAlive) {
            this.isRunning = false;
            return;
        }

        Events.emit('ai:turnStarted', { player });

        try {
            // Phase 1: Handle city production
            await this.handleProduction(player);

            // Phase 2: Move and attack with units
            await this.handleUnitActions(player);

            // Phase 3: Hero actions (explore ruins, capture cities)
            await this.handleHeroActions(player);

            // Small delay before ending turn
            await this.delay(this.thinkDelay);

        } catch (error) {
            console.error('AI error:', error);
        }

        this.isRunning = false;
        Events.emit('ai:turnEnded', { player });

        // End turn
        this.game.endTurn();
    }

    /**
     * Handle city production decisions
     */
    async handleProduction(player) {
        for (const city of player.cities) {
            // Decide what to build based on needs
            const unitType = this.decideProduction(player);
            const cost = UNIT_DEFINITIONS[unitType].cost;

            if (player.gold >= cost) {
                Events.emit('ai:producing', { player, city, unitType });
                this.game.produceUnit(city, unitType);
                await this.delay(300);
            }
        }
    }

    /**
     * Decide which unit to produce based on current army composition
     */
    decideProduction(player) {
        const units = player.units;
        const gold = player.gold;

        // Count unit types
        const counts = {};
        for (const type of Object.keys(UNIT_DEFINITIONS)) {
            counts[type] = units.filter(u => u.type === type && u.hp > 0).length;
        }

        // Priority: Hero replacement if dead
        if (counts.HERO === 0 && gold >= 50) {
            // Can't produce hero, focus on strong units
            if (gold >= 40) return 'CATAPULT';
            if (gold >= 30) return 'DRAGON';
        }

        // Need cheap units for expansion
        if (counts.LIGHT_INFANTRY < 3 && gold >= 10) {
            return 'LIGHT_INFANTRY';
        }

        // Balanced army composition
        if (counts.CAVALRY < 2 && gold >= 30) {
            return 'CAVALRY';
        }

        if (counts.ARCHER < 2 && gold >= 15) {
            return 'ARCHER';
        }

        if (counts.HEAVY_INFANTRY < 2 && gold >= 20) {
            return 'HEAVY_INFANTRY';
        }

        // Late game - expensive units if we have money
        if (gold >= 100) return 'DRAGON';
        if (gold >= 40) return 'CATAPULT';
        if (gold >= 30) return 'CAVALRY';
        if (gold >= 20) return 'HEAVY_INFANTRY';
        if (gold >= 15) return 'ARCHER';

        return 'LIGHT_INFANTRY';
    }

    /**
     * Handle all unit movements and attacks
     */
    async handleUnitActions(player) {
        const units = player.units
            .filter(u => u.hp > 0 && !u.isHero)
            .sort((a, b) => this.prioritizeUnit(b) - this.prioritizeUnit(a));

        for (const unit of units) {
            if (unit.hasMoved && unit.hasAttacked) continue;

            await this.handleSingleUnit(unit, player);
            await this.delay(200);
        }
    }

    /**
     * Prioritize units for action order (stronger units first)
     */
    prioritizeUnit(unit) {
        const def = UNIT_DEFINITIONS[unit.type];
        return def.attack + def.defense + def.hp / 10;
    }

    /**
     * Handle a single unit's turn
     */
    async handleSingleUnit(unit, player) {
        const reachable = MovementSystem.getReachableTiles(unit, this.map);

        // Find best attack target
        const attackTarget = this.findBestAttackTarget(unit, reachable, player);

        if (attackTarget && !unit.hasAttacked) {
            // Attack!
            if (attackTarget.requiresMove) {
                // Move first, then attack
                this.game.moveUnit(unit, attackTarget.moveX, attackTarget.moveY);
                await this.delay(300);
            }

            const enemyStack = this.map.getStack(attackTarget.targetX, attackTarget.targetY);
            if (enemyStack) {
                const isRanged = Utils.manhattanDistance(unit.x, unit.y, attackTarget.targetX, attackTarget.targetY) > 1;
                this.game.performAttack(unit, enemyStack, isRanged);
                await this.delay(400);
            }
            return;
        }

        // No attack target - move strategically
        if (!unit.hasMoved) {
            const moveTarget = this.findBestMoveTarget(unit, reachable, player);
            if (moveTarget) {
                this.game.moveUnit(unit, moveTarget.x, moveTarget.y);
                await this.delay(300);

                // Try to attack after moving
                const newReachable = MovementSystem.getReachableTiles(unit, this.map);
                const newAttack = this.findBestAttackTarget(unit, newReachable, player);
                if (newAttack && !unit.hasAttacked) {
                    const enemyStack = this.map.getStack(newAttack.targetX, newAttack.targetY);
                    if (enemyStack) {
                        this.game.performAttack(unit, enemyStack, false);
                        await this.delay(400);
                    }
                }
            }
        }
    }

    /**
     * Find the best attack target for a unit
     */
    findBestAttackTarget(unit, reachable, player) {
        const targets = [];

        // Check melee attacks (adjacent after move)
        for (const tile of reachable) {
            if (tile.isEnemy) {
                const enemyStack = this.map.getStack(tile.x, tile.y);
                if (enemyStack) {
                    const score = this.evaluateAttackTarget(unit, enemyStack, tile.x, tile.y);
                    targets.push({
                        targetX: tile.x,
                        targetY: tile.y,
                        moveX: tile.x,
                        moveY: tile.y,
                        requiresMove: tile.cost > 0,
                        score,
                        isRanged: false
                    });
                }
            }
        }

        // Check ranged attacks
        if (unit.range > 1 && !unit.hasAttacked) {
            for (let y = 0; y < this.map.height; y++) {
                for (let x = 0; x < this.map.width; x++) {
                    const dist = Utils.manhattanDistance(unit.x, unit.y, x, y);
                    if (dist <= unit.range && dist > 0) {
                        const enemyStack = this.map.getStack(x, y);
                        if (enemyStack && enemyStack.owner !== unit.owner) {
                            const score = this.evaluateAttackTarget(unit, enemyStack, x, y) * 0.9; // Slight penalty for ranged
                            targets.push({
                                targetX: x,
                                targetY: y,
                                moveX: unit.x,
                                moveY: unit.y,
                                requiresMove: false,
                                score,
                                isRanged: true
                            });
                        }
                    }
                }
            }
        }

        if (targets.length === 0) return null;

        // Sort by score descending
        targets.sort((a, b) => b.score - a.score);
        return targets[0];
    }

    /**
     * Evaluate an attack target (higher score = better target)
     */
    evaluateAttackTarget(unit, enemyStack, targetX, targetY) {
        const enemy = enemyStack.getCombatUnit();
        if (!enemy) return -1000;

        let score = 0;
        const enemyDef = UNIT_DEFINITIONS[enemy.type];

        // Priority based on enemy value
        if (enemy.isHero) score += 100;
        if (enemy.type === 'CATAPULT') score += 50;
        if (enemy.type === 'DRAGON') score += 80;

        // Prefer damaged enemies (easier kills)
        const damagePercent = 1 - (enemy.hp / enemyDef.hp);
        score += damagePercent * 30;

        // Check if we can kill it
        const terrainBonus = this.map.getDefenseBonus(targetX, targetY);
        const damage = CombatSystem.calculateDamage(unit, enemy, terrainBonus);
        if (damage >= enemy.hp) {
            score += 50; // Kill bonus
        }

        // Consider counter-attack damage
        const returnDamage = Math.ceil(damage / 2);
        if (returnDamage >= unit.hp) {
            score -= 100; // Don't suicide unless it's a hero
            if (enemy.isHero) score += 50;
        }

        // City capture bonus
        const city = this.map.getCity(targetX, targetY);
        if (city && city.owner !== unit.owner) {
            score += 40;
        }

        return score;
    }

    /**
     * Find the best strategic move when no attacks available
     */
    findBestMoveTarget(unit, reachable, player) {
        if (reachable.length === 0) return null;

        const moves = reachable
            .filter(t => !t.isEnemy) // Don't move into enemies
            .map(tile => {
                let score = this.evaluateMoveTarget(unit, tile.x, tile.y, player);
                // Prefer closer moves (less wasted movement)
                score -= tile.cost * 2;
                return { ...tile, score };
            });

        if (moves.length === 0) return null;

        moves.sort((a, b) => b.score - a.score);
        return moves[0];
    }

    /**
     * Evaluate a potential move position
     */
    evaluateMoveTarget(unit, x, y, player) {
        let score = 0;

        // Explore ruins (only heroes can do this, but move towards them)
        const ruin = this.map.getRuin(x, y);
        if (ruin && unit.isHero) {
            score += 60;
        }

        // Capture neutral or enemy cities
        const city = this.map.getCity(x, y);
        if (city) {
            if (city.owner === null) {
                score += 50;
            } else if (city.owner !== player.id) {
                // Check if city is undefended
                const defenders = this.map.getUnitsAt(x, y).filter(u => u.owner !== player.id && u.hp > 0);
                if (defenders.length === 0) {
                    score += 45;
                } else {
                    score += 20; // Still good to approach
                }
            } else {
                score += 5; // Defend own city
            }
        }

        // Move towards enemies
        const nearestEnemy = this.findNearestEnemy(unit, player);
        if (nearestEnemy) {
            const distBefore = Utils.manhattanDistance(unit.x, unit.y, nearestEnemy.x, nearestEnemy.y);
            const distAfter = Utils.manhattanDistance(x, y, nearestEnemy.x, nearestEnemy.y);
            if (distAfter < distBefore) {
                score += 15;
            }
        }

        // Move towards undefended neutral cities
        const nearestNeutralCity = this.findNearestNeutralCity(unit);
        if (nearestNeutralCity) {
            const distBefore = Utils.manhattanDistance(unit.x, unit.y, nearestNeutralCity.x, nearestNeutralCity.y);
            const distAfter = Utils.manhattanDistance(x, y, nearestNeutralCity.x, nearestNeutralCity.y);
            if (distAfter < distBefore) {
                score += 25;
            }
        }

        // Defensive terrain bonus
        const terrain = this.map.getTerrain(x, y);
        if (terrain === 1) score += 5; // Forest
        if (terrain === 2) score += 8; // Mountains

        return score;
    }

    /**
     * Handle hero-specific actions (explore ruins, capture cities)
     */
    async handleHeroActions(player) {
        const hero = player.getHero();
        if (!hero || hero.hasMoved) return;

        const reachable = MovementSystem.getReachableTiles(hero, this.map);

        // Priority 1: Explore ruins
        const ruin = reachable.find(t => this.map.getRuin(t.x, t.y));
        if (ruin) {
            this.game.moveUnit(hero, ruin.x, ruin.y);
            await this.delay(300);
            return;
        }

        // Priority 2: Capture undefended cities
        const cityTile = reachable.find(t => {
            const city = this.map.getCity(t.x, t.y);
            if (!city || city.owner === player.id) return false;
            const defenders = this.map.getUnitsAt(t.x, t.y).filter(u => u.owner !== player.id && u.hp > 0);
            return defenders.length === 0;
        });

        if (cityTile) {
            this.game.moveUnit(hero, cityTile.x, cityTile.y);
            await this.delay(300);
            return;
        }

        // Priority 3: Strategic move
        const moveTarget = this.findBestMoveTarget(hero, reachable, player);
        if (moveTarget) {
            this.game.moveUnit(hero, moveTarget.x, moveTarget.y);
            await this.delay(300);
        }
    }

    /**
     * Find nearest enemy unit
     */
    findNearestEnemy(unit, player) {
        let nearest = null;
        let minDist = Infinity;

        for (const otherUnit of this.map.units) {
            if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                const dist = Utils.manhattanDistance(unit.x, unit.y, otherUnit.x, otherUnit.y);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = otherUnit;
                }
            }
        }

        return nearest;
    }

    /**
     * Find nearest neutral city
     */
    findNearestNeutralCity(unit) {
        let nearest = null;
        let minDist = Infinity;

        for (const city of this.map.cities) {
            if (city.owner === null) {
                const dist = Utils.manhattanDistance(unit.x, unit.y, city.x, city.y);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = city;
                }
            }
        }

        return nearest;
    }

    /**
     * Utility: delay for async operations
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
