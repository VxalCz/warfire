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
            // Check if city is blockaded - cannot produce if enemy adjacent
            if (this.map.isCityBlockaded(city, player.id)) {
                Events.emit('ai:blockaded', { player, city });
                continue; // Skip this city, it's under siege
            }

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
        // Get available targets from current position (no move required)
        const currentAttackTargets = MovementSystem.getAttackTargets(unit, this.map);

        // Find best attack target that doesn't require movement
        let bestCurrentAttack = null;
        if (currentAttackTargets.length > 0 && !unit.hasAttacked) {
            let bestScore = -Infinity;
            for (const target of currentAttackTargets) {
                const enemyStack = this.map.getStack(target.x, target.y);
                if (enemyStack) {
                    const score = this.evaluateAttackTarget(unit, enemyStack, target.x, target.y);
                    if (score > bestScore) {
                        bestScore = score;
                        bestCurrentAttack = { target, enemyStack, score };
                    }
                }
            }
        }

        // Decide: attack from current position OR move then attack
        if (bestCurrentAttack && !unit.hasAttacked) {
            // Attack without moving
            const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestCurrentAttack.target.x, bestCurrentAttack.target.y) > 1;
            this.game.performAttack(unit, bestCurrentAttack.enemyStack, isRanged);
            await this.delay(400);
            return;
        }

        // No good attack from current position - try to move and attack
        if (!unit.hasMoved) {
            const reachable = MovementSystem.getReachableTiles(unit, this.map);
            const moveTarget = this.findBestMoveTarget(unit, reachable, player);

            if (moveTarget) {
                // Move to target position
                this.game.moveUnit(unit, moveTarget.x, moveTarget.y);
                await this.delay(300);

                // After moving, check for attack targets from new position
                if (!unit.hasAttacked) {
                    const newAttackTargets = MovementSystem.getAttackTargets(unit, this.map);
                    let bestPostMoveAttack = null;
                    let bestScore = -Infinity;

                    for (const target of newAttackTargets) {
                        const enemyStack = this.map.getStack(target.x, target.y);
                        if (enemyStack) {
                            const score = this.evaluateAttackTarget(unit, enemyStack, target.x, target.y);
                            if (score > bestScore) {
                                bestScore = score;
                                bestPostMoveAttack = { target, enemyStack };
                            }
                        }
                    }

                    if (bestPostMoveAttack) {
                        const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestPostMoveAttack.target.x, bestPostMoveAttack.target.y) > 1;
                        this.game.performAttack(unit, bestPostMoveAttack.enemyStack, isRanged);
                        await this.delay(400);
                    }
                }
            }
        }
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
            .filter(t => {
                // 1 unit per tile limit: can't stop on a tile with a friendly unit
                const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
                return !existingUnit;
            })
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

        // Filter out tiles occupied by friendly units (1 unit per tile limit)
        const validMoves = reachable.filter(t => {
            const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
            return !existingUnit;
        });

        // Priority 1: Explore ruins
        const ruin = validMoves.find(t => this.map.getRuin(t.x, t.y));
        if (ruin) {
            this.game.moveUnit(hero, ruin.x, ruin.y);
            await this.delay(300);
            return;
        }

        // Priority 2: Capture undefended cities
        const cityTile = validMoves.find(t => {
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
