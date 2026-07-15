import { Utils, Events } from '../utils.js';
import { MovementSystem } from './MovementSystem.js';
import { CombatSystem } from './CombatSystem.js';
import { GameState } from './GameState.js';
import { StrategyPlanner } from './StrategyPlanner.js';
import { InfluenceMap } from './InfluenceMap.js';
import { UNIT_DEFINITIONS, CITY_INCOME, TERRAIN } from '../constants.js';

/**
 * AI system for controlling bot players
 * Implements turn-based strategy with tactical decisions
 * Uses StrategyPlanner for high-level coordination and InfluenceMap for positioning
 */
export class AISystem {
    constructor(game) {
        this.game = game;
        this.map = game.map;
        this.players = game.players;
        this.isRunning = false;
        this.thinkDelay = 200; // Delay between AI actions for visibility
        // Key of the last fully played turn ("turnNumber:playerIndex") - prevents
        // background ticks from replaying a turn that is waiting for its scheduled endTurn
        this.lastCompletedTurnKey = null;

        // Strategic planner for coordinated decisions
        this.strategyPlanner = new StrategyPlanner(game);
        this.currentPlan = null;

        // Influence map for threat/safety assessment
        this.influenceMap = new InfluenceMap(game.map, game.players);

        // Track which units attacked which targets this turn (for focus fire)
        this.focusFireMemory = new Map();

        // Per-turn cache of BFS distance fields for objective navigation
        this.distanceFieldCache = new Map();
    }

    /**
     * BFS distance field (tile count over passable terrain) from a target tile.
     * Cached per target + unit type for the duration of one AI turn.
     */
    getDistanceField(targetX, targetY, unitType) {
        const key = `${targetX},${targetY}:${unitType}`;
        let field = this.distanceFieldCache.get(key);
        if (field) return field;

        const width = this.map.width;
        const height = this.map.height;
        field = new Int32Array(width * height).fill(-1);

        const queue = [targetY * width + targetX];
        field[queue[0]] = 0;

        for (let head = 0; head < queue.length; head++) {
            const index = queue[head];
            const x = index % width;
            const y = (index / width) | 0;
            const dist = field[index];

            // 4-directional, matching MovementSystem
            for (const [nx, ny] of [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]]) {
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                const ni = ny * width + nx;
                if (field[ni] !== -1) continue;
                if (this.map.getMovementCost(nx, ny, unitType) === Infinity) continue;
                field[ni] = dist + 1;
                queue.push(ni);
            }
        }

        this.distanceFieldCache.set(key, field);
        return field;
    }

    /**
     * True path distance from (x, y) to an objective. Falls back to manhattan
     * when the objective is unreachable for this unit type (e.g. across water),
     * so units don't get stuck oscillating behind impassable terrain.
     */
    getObjectiveDistance(x, y, objective, unitType) {
        const field = this.getDistanceField(objective.x, objective.y, unitType);
        const d = field[y * this.map.width + x];
        return d >= 0 ? d : Utils.manhattanDistance(x, y, objective.x, objective.y);
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

        const turnKey = `${this.game.state.turnNumber}:${this.game.state.currentPlayerIndex}`;

        // Reset per-turn state (focus fire tracking, pathfinding cache)
        this.focusFireMemory.clear();
        this.distanceFieldCache.clear();

        // Update influence map for strategic positioning
        this.influenceMap.update(player.id, this.game.state.turnNumber || 1);

        // Generate strategic plan for this turn
        this.currentPlan = this.strategyPlanner.generatePlan(player);
        console.log(`[AI] Plan for ${player.name}: phase=${this.currentPlan.phase}, objectives=${this.currentPlan.objectives.length}, assignments=${this.currentPlan.assignments.size}, production=${this.currentPlan.productionPlan.size}`);

        Events.emit('ai:turnStarted', { player });

        try {
            await this.handleRetreats(player);
            await this.handleUnitActions(player);
            await this.handleHeroActions(player);
            await this.handleProduction(player);
            await this.delay(this.thinkDelay);
        } catch (error) {
            console.error('AI error:', error);
        }

        console.log(`[AI] Turn complete for ${player.name}, isSpectator=${this.game.isSpectatorMode}, currentPlayer=${this.game.state.currentPlayerIndex}`);

        // Ensure game state is clean before ending turn
        this.game.state.selectedEntity = null;
        if (this.game.state.phase !== GameState.PHASES.IDLE) {
            this.game.state.phase = GameState.PHASES.IDLE;
        }

        // Mark the turn as played BEFORE releasing isRunning so nothing can replay it
        this.lastCompletedTurnKey = turnKey;
        this.isRunning = false;
        Events.emit('ai:turnEnded', { player });

        // End turn (unless in spectator mode - scheduler handles that)
        if (!this.game.isSpectatorMode) {
            this.game.endTurn();
        }
    }

    /**
     * Handle city production decisions with context-aware strategy
     * Now uses StrategyPlanner's production plan when available
     */
    async handleProduction(player) {
        // Calculate economic situation
        const income = this.calculateIncome(player);

        // Spend gold in the plan's urgency order (front-line cities first);
        // cities without a plan entry follow, ordered by front-line priority
        const planOrder = this.currentPlan?.productionPlan
            ? [...this.currentPlan.productionPlan.keys()]
            : [];
        const cities = [...player.cities].sort((a, b) => {
            const ia = planOrder.indexOf(a.id);
            const ib = planOrder.indexOf(b.id);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return this.getCityProductionPriority(b, player) - this.getCityProductionPriority(a, player);
        });

        for (const city of cities) {
            // Check if city is blockaded - cannot produce if enemy adjacent
            if (this.map.isCityBlockaded(city, player.id)) {
                Events.emit('ai:blockaded', { player, city });
                continue; // Skip this city, it's under siege
            }

            // Use strategic plan for production when available
            let unitType = null;
            if (this.currentPlan && this.currentPlan.productionPlan) {
                unitType = this.currentPlan.productionPlan.get(city.id);
            }

            // Fallback to legacy production logic
            if (!unitType) {
                const enemyComposition = this.analyzeEnemyComposition(player);
                const mapHasWater = this.analyzeMapTerrain();
                const isLateGame = (this.game.state.turnNumber || 1) > 20;
                unitType = this.decideProduction(player, income, isLateGame, enemyComposition, mapHasWater, city);
            }

            // Skip if no unit type selected (not enough gold)
            if (!unitType) continue;

            const cost = UNIT_DEFINITIONS[unitType].cost;

            if (player.gold >= cost) {
                Events.emit('ai:producing', { player, city, unitType });
                this.game.produceUnit(city, unitType);
                await this.delay(300);
            }
        }
    }

    /**
     * Calculate player's income per turn
     */
    calculateIncome(player) {
        let income = 0;
        for (const city of player.cities) {
            const size = city.population >= 20 ? 'large' : city.population >= 10 ? 'medium' : 'small';
            income += CITY_INCOME[size];
        }
        return income;
    }

    /**
     * Analyze enemy army composition across all opponents
     */
    analyzeEnemyComposition(player) {
        const composition = {};
        for (const type of Object.keys(UNIT_DEFINITIONS)) {
            composition[type] = 0;
        }

        for (const otherUnit of this.map.units) {
            if (otherUnit.owner !== player.id && otherUnit.hp > 0 && !otherUnit.isHero) {
                composition[otherUnit.type] = (composition[otherUnit.type] || 0) + 1;
            }
        }

        return composition;
    }

    /**
     * Analyze if map has significant water areas
     */
    analyzeMapTerrain() {
        let waterTiles = 0;
        for (let y = 0; y < this.map.height; y++) {
            for (let x = 0; x < this.map.width; x++) {
                if (this.map.getTerrain(x, y) === TERRAIN.WATER) {
                    waterTiles++;
                }
            }
        }
        const totalTiles = this.map.width * this.map.height;
        return waterTiles / totalTiles > 0.15; // More than 15% water
    }

    /**
     * Decide which unit to produce based on comprehensive strategic analysis
     */
    /**
     * Calculate production priority for a city based on front-line proximity
     * Cities near enemies get higher priority for unit production
     */
    getCityProductionPriority(city, player) {
        let priority = 0;

        // Distance to nearest enemy unit
        let nearestEnemyDist = Infinity;
        for (const unit of this.map.units) {
            if (unit.owner !== player.id && unit.hp > 0) {
                const dist = Utils.manhattanDistance(city.x, city.y, unit.x, unit.y);
                if (dist < nearestEnemyDist) nearestEnemyDist = dist;
            }
        }

        // Distance to nearest enemy/neutral city
        let nearestTargetDist = Infinity;
        for (const targetCity of this.map.cities) {
            if (targetCity.owner !== player.id) {
                const dist = Utils.manhattanDistance(city.x, city.y, targetCity.x, targetCity.y);
                if (dist < nearestTargetDist) nearestTargetDist = dist;
            }
        }

        // Higher priority for cities close to front line
        if (nearestEnemyDist <= 5) priority += 50;
        else if (nearestEnemyDist <= 8) priority += 30;
        else if (nearestEnemyDist <= 12) priority += 10;

        // Bonus for cities near neutral/enemy cities (expansion bases)
        if (nearestTargetDist <= 6) priority += 20;

        // Penalty for cities very far from any action (internal production)
        if (nearestEnemyDist > 15 && nearestTargetDist > 10) priority -= 20;

        return priority;
    }

    decideProduction(player, income, isLateGame, enemyComposition, mapHasWater, city) {
        const gold = player.gold;

        // Always build if we have gold - no limits, just prioritize needs
        if (gold < 10) return null;

        // Priority 0: Buy hero if we don't have one
        const hero = player.getHero();
        if (!hero && gold >= 50) {
            return 'HERO';
        }

        // Get enemy composition
        const enemyCavalry = enemyComposition.CAVALRY || 0;
        const enemyHeavy = enemyComposition.HEAVY_INFANTRY || 0;
        const enemyDragons = enemyComposition.DRAGON || 0;

        // Priority 1: Counter enemy cavalry with heavy infantry
        if (enemyCavalry >= 2 && gold >= 20) {
            return 'HEAVY_INFANTRY';
        }

        // Priority 2: Counter enemy heavy infantry with archers
        if (enemyHeavy >= 2 && gold >= 15) {
            return 'ARCHER';
        }

        // Priority 3: Counter dragons with catapults
        if (enemyDragons >= 1 && gold >= 40) {
            return 'CATAPULT';
        }

        // Priority 4: Early game - prioritize cheap units for expansion
        // But still build some variety based on gold amount
        if (!isLateGame) {
            if (gold >= 30) return 'CAVALRY';
            if (gold >= 20) return 'HEAVY_INFANTRY';
            if (gold >= 15) return 'ARCHER';
            return 'LIGHT_INFANTRY';
        }

        // Priority 5: Late game - prioritize stronger units
        if (isLateGame) {
            if (gold >= 100) return 'DRAGON';
            if (gold >= 40) return 'CATAPULT';
            if (gold >= 30) return 'CAVALRY';
            if (gold >= 20) return 'HEAVY_INFANTRY';
            if (gold >= 15) return 'ARCHER';
        }

        // Fallback: always build something cheap
        return 'LIGHT_INFANTRY';
    }

    /**
     * Handle retreats for damaged units before combat
     */
    async handleRetreats(player) {
        const damagedUnits = player.units.filter(u => {
            if (u.hp <= 0 || u.isHero) return false;
            const def = UNIT_DEFINITIONS[u.type];
            const healthPercent = u.hp / def.hp;
            return healthPercent < 0.3 && !u.hasMoved; // Less than 30% HP
        });

        for (const unit of damagedUnits) {
            // Find safe retreat position
            const retreatTarget = this.findRetreatTarget(unit, player);
            if (retreatTarget) {
                await this.game.moveUnit(unit, retreatTarget.x, retreatTarget.y);
                await this.delay(300);
            }
        }
    }

    /**
     * Find safe position to retreat to (towards own cities, away from enemies)
     * Now uses influence map for better safety assessment
     */
    findRetreatTarget(unit, player) {
        const reachable = MovementSystem.getReachableTiles(unit, this.map);

        // Filter valid retreat positions
        const validMoves = reachable.filter(t => {
            // Can't stop on friendly units
            const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
            if (existingUnit) return false;

            // Don't retreat into enemies
            if (t.isEnemy) return false;

            return true;
        });

        if (validMoves.length === 0) return null;

        // Find nearest owned city for safety
        let nearestCity = null;
        let minCityDist = Infinity;
        for (const city of player.cities) {
            const dist = Utils.manhattanDistance(unit.x, unit.y, city.x, city.y);
            if (dist < minCityDist) {
                minCityDist = dist;
                nearestCity = city;
            }
        }

        // Score retreat positions
        const scoredMoves = validMoves.map(tile => {
            let score = 0;

            // Prefer movement towards own cities
            if (nearestCity) {
                const distBefore = Utils.manhattanDistance(unit.x, unit.y, nearestCity.x, nearestCity.y);
                const distAfter = Utils.manhattanDistance(tile.x, tile.y, nearestCity.x, nearestCity.y);
                if (distAfter < distBefore) {
                    score += 50; // Strong bonus for moving towards safety
                }
            }

            // Influence map: avoid high-threat areas, prefer safe zones
            const threat = this.influenceMap.getThreatLevel(tile.x, tile.y);
            const friendly = this.influenceMap.getFriendlyInfluence(tile.x, tile.y);
            score -= threat * 15; // Heavy penalty for retreating into danger
            score += friendly * 5; // Bonus for retreating toward friendly territory

            // Still check immediate adjacency for enemies (fast local check)
            for (const otherUnit of this.map.units) {
                if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                    const enemyDist = Utils.chebyshevDistance(tile.x, tile.y, otherUnit.x, otherUnit.y);
                    if (enemyDist <= 1) {
                        score -= 100; // Heavy penalty for adjacency
                    }
                }
            }

            // Prefer defensive terrain
            const terrain = this.map.getTerrain(tile.x, tile.y);
            if (terrain === TERRAIN.MOUNTAINS) score += 20;
            if (terrain === TERRAIN.FOREST) score += 10;

            return { ...tile, score };
        });

        scoredMoves.sort((a, b) => b.score - a.score);
        return scoredMoves[0];
    }

    /**
     * Handle all unit movements and attacks with tactical priority
     * Now uses strategic plan for coordinated action order
     */
    async handleUnitActions(player) {
        // Get current turn number for early game expansion prioritization
        const turnNumber = this.game.state?.turnNumber || 1;

        // Sort units by tactical priority for action order
        const units = player.units
            .filter(u => u.hp > 0 && !u.isHero)
            .sort((a, b) => this.prioritizeUnitForAction(b, player, turnNumber) - this.prioritizeUnitForAction(a, player, turnNumber));

        for (const unit of units) {
            if (unit.hasMoved && unit.hasAttacked) continue;

            // Check if unit has a strategic objective assignment
            const assignment = this.currentPlan?.assignments?.get(unit.id);

            if (assignment) {
                await this.executeWithObjective(unit, player, assignment);
            } else {
                await this.handleSingleUnit(unit, player);
            }
            await this.delay(200);
        }
    }

    /**
     * Execute a unit's turn with a strategic objective in mind
     * Moves toward the objective, but still handles tactical combat opportunities
     */
    async executeWithObjective(unit, player, assignment) {
        const def = UNIT_DEFINITIONS[unit.type];
        const objective = assignment.objective;
        const role = assignment.role;

        // Garrison/defense duty: when standing on the objective, hold the position -
        // attack adjacent enemies in place instead of moving out of the city
        if (objective.type === 'DEFEND_CITY' && unit.x === objective.x && unit.y === objective.y) {
            if (!unit.hasAttacked) {
                const targets = MovementSystem.getAttackTargets(unit, this.map);
                let bestDefense = null;
                let bestDefenseScore = -Infinity;
                for (const target of targets) {
                    const enemyStack = this.map.getStack(target.x, target.y);
                    if (enemyStack) {
                        const score = this.evaluateAttackTarget(unit, enemyStack, target.x, target.y, player);
                        if (score > bestDefenseScore) {
                            bestDefenseScore = score;
                            bestDefense = { target, enemyStack };
                        }
                    }
                }
                if (bestDefense) {
                    const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestDefense.target.x, bestDefense.target.y) > 1;
                    this.performTrackedAttack(unit, bestDefense.enemyStack, isRanged);
                    await this.delay(400);
                }
            }
            return;
        }

        // 1. Check for immediate attack opportunities from current position (tactical override)
        const currentAttackTargets = MovementSystem.getAttackTargets(unit, this.map);
        if (currentAttackTargets.length > 0 && !unit.hasAttacked) {
            let bestAttack = null;
            let bestScore = -Infinity;

            for (const target of currentAttackTargets) {
                const enemyStack = this.map.getStack(target.x, target.y);
                if (enemyStack) {
                    const score = this.evaluateAttackTarget(unit, enemyStack, target.x, target.y, player);
                    if (score > bestScore) {
                        bestScore = score;
                        bestAttack = { target, enemyStack, score };
                    }
                }
            }

            // Only take the attack if it's a good trade or aligns with objective
            if (bestAttack && bestScore > 50) {
                const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestAttack.target.x, bestAttack.target.y) > 1;

                if (isRanged && def.range > 1) {
                    // Ranged attack ends the unit's turn (attacking sets hasMoved)
                    this.performTrackedAttack(unit, bestAttack.enemyStack, true);
                    await this.delay(400);
                    return;
                } else if (!isRanged) {
                    // Melee: check if attack advances our objective
                    const distToObjBefore = this.getObjectiveDistance(unit.x, unit.y, objective, unit.type);
                    const distToObjAfter = this.getObjectiveDistance(bestAttack.target.x, bestAttack.target.y, objective, unit.type);
                    const advancesObjective = distToObjAfter < distToObjBefore;

                    // Always attack if it's a kill or great trade
                    if (bestScore >= 80 || advancesObjective) {
                        // Melee attack via moveUnit
                        await this.game.moveUnit(unit, bestAttack.target.x, bestAttack.target.y);
                        await this.delay(300);
                        return;
                    }
                }
            }
        }

        // 2. Move toward objective
        if (!unit.hasMoved) {
            const reachable = MovementSystem.getReachableTiles(unit, this.map);
            const validMoves = reachable.filter(t => {
                const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
                return !existingUnit && !t.isEnemy;
            });

            if (validMoves.length > 0) {
                // Find the move that gets us closest to our objective
                let bestMove = null;
                let bestScore = -Infinity;
                const priorityTarget = this.findPriorityTarget(unit, player);
                // Path distance (BFS over passable terrain) so units route around
                // water and mountains instead of hugging the straight line
                const distBefore = this.getObjectiveDistance(unit.x, unit.y, objective, unit.type);

                for (const tile of validMoves) {
                    let score = 0;

                    // Primary: move toward objective
                    const distAfter = this.getObjectiveDistance(tile.x, tile.y, objective, unit.type);
                    const progress = distBefore - distAfter;
                    score += progress * 50; // Strong weight for approaching objective

                    // Reaching the objective is extremely valuable
                    if (distAfter === 0) {
                        score += 500;
                    } else if (distAfter <= 1) {
                        score += 200;
                    }

                    // Role-specific positioning
                    if (role === 'RANGED_SUPPORT' || role === 'RANGED_ATTACK') {
                        // Ranged units: prefer to be at range from objective, not adjacent
                        if (distAfter <= def.range && distAfter > 1) {
                            score += 80;
                        }
                        if (distAfter <= 1) {
                            score -= 30; // Don't want ranged units in melee
                        }
                    }

                    if (role === 'FLANKER') {
                        // Flankers: prefer approaching from different angle than other units
                        const otherAssignedUnits = objective.assignedUnits || [];
                        for (const other of otherAssignedUnits) {
                            if (other.id === unit.id) continue;
                            const otherDist = Utils.manhattanDistance(other.x, other.y, objective.x, objective.y);
                            if (otherDist <= 3) {
                                // Bonus for being on opposite side
                                const myAngle = Math.atan2(tile.y - objective.y, tile.x - objective.x);
                                const otherAngle = Math.atan2(other.y - objective.y, other.x - objective.x);
                                const angleDiff = Math.abs(myAngle - otherAngle);
                                if (angleDiff > Math.PI / 3) { // > 60 degrees apart
                                    score += 30;
                                }
                            }
                        }
                    }

                    // Use existing strategic move evaluation as a tiebreaker
                    score += this.evaluateStrategicMove(unit, tile.x, tile.y, player, def.range > 1, def.movement >= 4, priorityTarget) * 0.3;

                    // Prefer closer moves (less wasted movement)
                    score -= tile.cost * 2;

                    if (score > bestScore) {
                        bestScore = score;
                        bestMove = tile;
                    }
                }

                // Only move when it actually helps - a negative score means every
                // reachable tile is worse than standing ground (e.g. at the objective)
                if (bestMove && bestScore > 0) {
                    await this.game.moveUnit(unit, bestMove.x, bestMove.y);
                    await this.delay(300);

                    // After moving, check for attack targets from new position
                    if (!unit.hasAttacked) {
                        const newAttackTargets = MovementSystem.getAttackTargets(unit, this.map);
                        let bestPostAttack = null;
                        let bestPostScore = -Infinity;

                        for (const target of newAttackTargets) {
                            const enemyStack = this.map.getStack(target.x, target.y);
                            if (enemyStack) {
                                const score = this.evaluateAttackTarget(unit, enemyStack, target.x, target.y, player);
                                if (score > bestPostScore) {
                                    bestPostScore = score;
                                    bestPostAttack = { target, enemyStack };
                                }
                            }
                        }

                        if (bestPostAttack && bestPostScore > 0) {
                            const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestPostAttack.target.x, bestPostAttack.target.y) > 1;
                            this.performTrackedAttack(unit, bestPostAttack.enemyStack, isRanged);
                            await this.delay(400);
                        }
                    }
                }
            }
        }
    }

    /**
     * Prioritize units for action order
     * Ranged units first (to position safely), then fast units, then strong units
     */
    prioritizeUnitForAction(unit, player, turnCount = 0) {
        const def = UNIT_DEFINITIONS[unit.type];
        let priority = def.attack + def.defense + def.hp / 10;

        // Ranged units act first to get into position
        if (def.range > 1) priority += 50;

        // Fast units act early for flanking AND expansion
        if (def.movement >= 4) priority += 30; // Increased from 20

        // ALL units with movement >= 3 get bonus for early game expansion
        // This ensures Light Infantry (move 3) also prioritize expansion
        if (def.movement >= 3) priority += 15;

        // Early game: prioritize fast movers even more for expansion (turns 1-5)
        if (turnCount <= 5 && def.movement >= 3) {
            priority += 25; // Extra bonus for expansion units in early game
        }

        // Damaged units act later (let healthy ones engage first)
        const healthPercent = unit.hp / def.hp;
        priority -= (1 - healthPercent) * 30;

        return priority;
    }

    /**
     * Handle a single unit's turn with advanced tactics
     */
    async handleSingleUnit(unit, player) {
        const def = UNIT_DEFINITIONS[unit.type];
        const isRangedUnit = def.range > 1;

        // Get available targets from current position
        const currentAttackTargets = MovementSystem.getAttackTargets(unit, this.map);

        // Find best attack target considering damage efficiency
        let bestCurrentAttack = null;
        if (currentAttackTargets.length > 0 && !unit.hasAttacked) {
            let bestScore = -Infinity;
            for (const target of currentAttackTargets) {
                const enemyStack = this.map.getStack(target.x, target.y);
                if (enemyStack) {
                    const score = this.evaluateAttackTarget(unit, enemyStack, target.x, target.y, player);
                    if (score > bestScore) {
                        bestScore = score;
                        bestCurrentAttack = { target, enemyStack, score };
                    }
                }
            }
        }

        // Attack from current position when there's a worthwhile target
        // (attacking ends the unit's turn - move-then-attack is handled below)
        if (bestCurrentAttack && !unit.hasAttacked && (isRangedUnit || bestCurrentAttack.score > 0)) {
            const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestCurrentAttack.target.x, bestCurrentAttack.target.y) > 1;
            this.performTrackedAttack(unit, bestCurrentAttack.enemyStack, isRanged);
            await this.delay(400);
            return;
        }

        // No good attack from current position - try to move and attack
        if (!unit.hasMoved) {
            const reachable = MovementSystem.getReachableTiles(unit, this.map);

            // Filter valid moves (respect 1 unit per tile)
            const validMoves = reachable.filter(t => {
                const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
                return !existingUnit && !t.isEnemy;
            });

            // OPPORTUNITY ATTACK: Before moving, check if we can attack a valuable target on the way
            // Sometimes it's better to attack an enemy unit than just move past it
            if (!unit.hasAttacked && validMoves.length > 0) {
                let bestOpportunityAttack = null;
                let bestOpportunityScore = -Infinity;

                // Context that does not depend on the candidate tile - compute once
                const targetCity = this.findPriorityTarget(unit, player);
                const economicAdv = this.calculateEconomicAdvantage(player);
                const isEconomicallyDominant = economicAdv.cityRatio >= 1.5 || economicAdv.incomeRatio >= 1.5;
                const isModeratelyAhead = economicAdv.cityRatio >= 1.2 || economicAdv.incomeRatio >= 1.3;

                // Check all reachable positions for enemies we could attack from there
                for (const moveTile of validMoves) {
                    const enemiesAtTile = this.map.getUnitsAt(moveTile.x, moveTile.y).filter(u => u.owner !== player.id && u.hp > 0);

                    for (const enemy of enemiesAtTile) {
                        // Can we win this fight?
                        const myDamage = CombatSystem.calculateDamage(unit, enemy, 0).damage;
                        const enemyDamage = CombatSystem.calculateDamage(enemy, unit, this.map.getDefenseBonus(moveTile.x, moveTile.y)).damage;

                        let opportunityScore = 0;

                        // Calculate if this trade is economically favorable
                        const enemyDef = UNIT_DEFINITIONS[enemy.type];
                        const myDef = UNIT_DEFINITIONS[unit.type];
                        const enemyValue = enemyDef ? enemyDef.cost : 20;
                        const myValue = myDef ? myDef.cost : 20;

                        // High priority for kills
                        if (myDamage >= enemy.hp) {
                            opportunityScore += 100;
                            // Extra bonus for killing strong units
                            if (enemy.isHero) opportunityScore += 150;
                            if (enemy.type === 'DRAGON') opportunityScore += 80;
                            if (enemy.type === 'CATAPULT') opportunityScore += 50;

                            // Economic advantage: even trades are fine when ahead
                            if (isEconomicallyDominant && myDamage >= enemy.hp) {
                                opportunityScore += 40; // Bonus for any kill when economically ahead
                            }
                        }
                        // Favorable trades are good too
                        else if (myDamage > enemyDamage * 1.5) {
                            opportunityScore += 50;
                        }
                        // When economically ahead, accept even or slightly unfavorable trades
                        else if (isEconomicallyDominant && myDamage >= enemyDamage * 0.8) {
                            if (enemyValue >= myValue) {
                                opportunityScore += 60; // Trading up or even is good
                            } else {
                                opportunityScore += 25; // Acceptable to maintain pressure
                            }
                        }
                        else if (isModeratelyAhead && myDamage >= enemyDamage && enemyValue >= myValue) {
                            opportunityScore += 35; // Moderate advantage: accept even trades for valuable units
                        }
                        // Even unfavorable trade might be worth it if enemy is key target
                        else if (enemy.isHero || enemy.type === 'DRAGON') {
                            opportunityScore += 30; // Some value in damaging key units
                            if (isEconomicallyDominant) {
                                opportunityScore += 25; // Even more willing when ahead
                            }
                        }

                        // Check if this move also progresses us toward our goal
                        if (targetCity) {
                            const distBefore = Utils.manhattanDistance(unit.x, unit.y, targetCity.x, targetCity.y);
                            const distAfter = Utils.manhattanDistance(moveTile.x, moveTile.y, targetCity.x, targetCity.y);
                            if (distAfter < distBefore) {
                                opportunityScore += 20; // Bonus for killing while progressing
                            }
                        }

                        if (opportunityScore > bestOpportunityScore && opportunityScore > 0) {
                            bestOpportunityScore = opportunityScore;
                            bestOpportunityAttack = { tile: moveTile, enemy };
                        }
                    }
                }

                // If we found a good opportunity attack, do it
                if (bestOpportunityAttack && bestOpportunityScore >= 50) {
                    // Move to the tile (this will trigger combat)
                    const enemyStack = this.map.getStack(bestOpportunityAttack.tile.x, bestOpportunityAttack.tile.y);
                    if (enemyStack) {
                        await this.game.moveUnit(unit, bestOpportunityAttack.tile.x, bestOpportunityAttack.tile.y);
                        await this.delay(300);

                        // Attack from new position (or melee combat happens automatically)
                        const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestOpportunityAttack.enemy.x, bestOpportunityAttack.enemy.y) > 1;
                        if (!isRanged && unit.x === bestOpportunityAttack.enemy.x && unit.y === bestOpportunityAttack.enemy.y) {
                            // Melee combat - already resolved by moveUnit
                            await this.delay(200);
                        } else if (!unit.hasAttacked) {
                            // Ranged attack from new position
                            this.performTrackedAttack(unit, enemyStack, true);
                            await this.delay(400);
                        }
                        return; // Done with this unit's turn
                    }
                }
            }

            // DEFENSE PRIORITY: Check if any of our cities are blockaded and we can help
            const blockadedCityDefended = await this.tryDefendBlockadedCity(unit, player, validMoves);
            if (blockadedCityDefended) {
                return; // Unit was used for defense, done with this unit
            }

            // Find best move considering tactical situation
            const moveTarget = this.findBestMoveTarget(unit, validMoves, player, isRangedUnit);

            if (moveTarget) {
                await this.game.moveUnit(unit, moveTarget.x, moveTarget.y);
                await this.delay(300);

                // After moving, check for attack targets from new position
                if (!unit.hasAttacked) {
                    const newAttackTargets = MovementSystem.getAttackTargets(unit, this.map);
                    let bestPostMoveAttack = null;
                    let bestScore = -Infinity;

                    for (const target of newAttackTargets) {
                        const enemyStack = this.map.getStack(target.x, target.y);
                        if (enemyStack) {
                            const score = this.evaluateAttackTarget(unit, enemyStack, target.x, target.y, player);
                            if (score > bestScore) {
                                bestScore = score;
                                bestPostMoveAttack = { target, enemyStack };
                            }
                        }
                    }

                    if (bestPostMoveAttack && bestScore > 0) {
                        const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestPostMoveAttack.target.x, bestPostMoveAttack.target.y) > 1;
                        this.performTrackedAttack(unit, bestPostMoveAttack.enemyStack, isRanged);
                        await this.delay(400);
                    }
                }
            }
        }
    }

    /**
     * Try to defend a blockaded city - high priority defense action
     * Returns true if unit was used for defense
     */
    async tryDefendBlockadedCity(unit, player, validMoves) {
        // Find all our blockaded cities
        const blockadedCities = player.cities.filter(city =>
            this.map.isCityBlockaded(city, player.id)
        );

        if (blockadedCities.length === 0) return false;

        // Sort by distance to unit
        const sortedCities = blockadedCities.map(city => ({
            city,
            dist: Utils.manhattanDistance(unit.x, unit.y, city.x, city.y)
        })).sort((a, b) => a.dist - b.dist);

        for (const { city, dist } of sortedCities) {
            // If we're already in the blockaded city, attack the blockers
            if (unit.x === city.x && unit.y === city.y) {
                const adjacentEnemies = this.getAdjacentEnemies(city.x, city.y, player);

                if (adjacentEnemies.length > 0 && !unit.hasAttacked) {
                    // Find the best enemy to attack
                    let bestEnemy = null;
                    let bestScore = -Infinity;

                    for (const enemy of adjacentEnemies) {
                        const myDamage = CombatSystem.calculateDamage(unit, enemy, 0).damage;
                        const enemyDamage = CombatSystem.calculateDamage(enemy, unit, this.map.getDefenseBonus(city.x, city.y)).damage;

                        let score = 0;
                        if (myDamage >= enemy.hp) {
                            score = 200; // Can kill - excellent!
                            if (enemy.isHero) score += 100;
                        } else if (myDamage > enemyDamage) {
                            score = 100; // Favorable trade
                        } else {
                            score = 50; // At least damage them
                        }

                        if (score > bestScore) {
                            bestScore = score;
                            bestEnemy = enemy;
                        }
                    }

                    if (bestEnemy) {
                        const enemyStack = this.map.getStack(bestEnemy.x, bestEnemy.y);
                        if (enemyStack) {
                            const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestEnemy.x, bestEnemy.y) > 1;
                            this.performTrackedAttack(unit, enemyStack, isRanged);
                            await this.delay(400);
                            return true;
                        }
                    }
                }
                // Can't attack, but we're defending - stay here
                return true;
            }

            // If we're adjacent to the blockaded city, move in to defend
            if (dist === 1) {
                const moveToCity = validMoves.find(t => t.x === city.x && t.y === city.y);
                if (moveToCity) {
                    await this.game.moveUnit(unit, city.x, city.y);
                    await this.delay(300);

                    // Try to attack immediately after moving in
                    const adjacentEnemies = this.getAdjacentEnemies(city.x, city.y, player);
                    if (adjacentEnemies.length > 0 && !unit.hasAttacked) {
                        const enemyStack = this.map.getStack(adjacentEnemies[0].x, adjacentEnemies[0].y);
                        if (enemyStack) {
                            const isRanged = Utils.chebyshevDistance(unit.x, unit.y, adjacentEnemies[0].x, adjacentEnemies[0].y) > 1;
                            this.performTrackedAttack(unit, enemyStack, isRanged);
                            await this.delay(400);
                        }
                    }
                    return true;
                }
            }

            // If we're within movement range, move toward the blockaded city
            if (dist <= 5) {
                const moveTowardCity = validMoves.find(t => {
                    const newDist = Utils.manhattanDistance(t.x, t.y, city.x, city.y);
                    return newDist < dist; // Moving closer
                });

                if (moveTowardCity) {
                    await this.game.moveUnit(unit, moveTowardCity.x, moveTowardCity.y);
                    await this.delay(300);
                    return true;
                }
            }
        }

        return false; // No defense action taken
    }

    /**
     * Evaluate an attack target with advanced scoring (higher score = better target)
     * Now includes economic advantage and coordinated attack assessment
     */
    evaluateAttackTarget(unit, enemyStack, targetX, targetY, player) {
        const enemy = enemyStack.getCombatUnit();
        if (!enemy) return -1000;

        let score = 0;
        const enemyDef = UNIT_DEFINITIONS[enemy.type];
        const myDef = UNIT_DEFINITIONS[unit.type];

        // Get economic context
        const economicAdvantage = this.calculateEconomicAdvantage(player);
        const isEconomicallyDominant = economicAdvantage.cityRatio >= 1.5 || economicAdvantage.incomeRatio >= 1.5;

        // Priority based on enemy value (high-value targets)
        if (enemy.isHero) score += 100;
        if (enemy.type === 'CATAPULT') score += 50;
        if (enemy.type === 'DRAGON') score += 80;

        // Focus fire: bonus for damaged enemies (easier kills)
        const damagePercent = 1 - (enemy.hp / enemyDef.hp);
        score += damagePercent * 40;

        // Check if we can kill it
        const terrainBonus = this.map.getDefenseBonus(targetX, targetY);
        const damage = CombatSystem.calculateDamage(unit, enemy, terrainBonus).damage;
        const canKill = damage >= enemy.hp;
        if (canKill) {
            score += 100; // Kill bonus - very high, attacking is always worth it
        }

        // Add bonus for any damage dealt - attacking is always beneficial since there's no retaliation!
        // (In this game, attackers deal damage without taking damage in return)
        score += Math.min(damage, enemy.hp) * 1.5; // Partial credit for non-lethal damage

        // CITY CAPTURE BONUS with coordinated attack assessment
        const city = this.map.getCity(targetX, targetY);
        if (city && city.owner !== unit.owner) {
            const enemyOwner = this.players[city.owner];

            // Check if we can actually capture (kill all defenders)
            if (canKill) {
                const remaining = this.map.getUnitsAt(targetX, targetY).filter(u => u.owner !== unit.owner && u.hp > 0);
                if (remaining.length <= 1) {
                    score += 100; // Capture bonus - very high priority

                    // Extra bonus for capturing cities of weak enemies
                    if (enemyOwner && enemyOwner.cities.length <= 2) {
                        score += 150; // Finish them off!
                    }
                }
            }

            // Last city bonus - capturing this eliminates the player!
            if (enemyOwner && enemyOwner.isAlive && enemyOwner.cities.length === 1) {
                score += 300; // This wins the game!
            }
        }

        // Range efficiency: for ranged units, prefer staying at range
        const distance = Utils.chebyshevDistance(unit.x, unit.y, targetX, targetY);
        if (myDef.range > 1) {
            if (distance > 1 && distance <= myDef.range) {
                score += 25; // Bonus for ranged attacks
            }
            if (distance === 1) {
                score -= 30; // Penalty for melee with ranged unit
            }
        }

        // Focus fire coordination: bonus if other units already attacked this enemy
        const enemyKey = `${targetX},${targetY}`;
        const focusCount = this.focusFireMemory.get(enemyKey) || 0;
        if (focusCount > 0) {
            score += 15 * Math.min(focusCount, 3); // Bonus for focusing fire
        }

        return score;
    }

    /**
     * Perform an attack and record the target for focus-fire coordination
     * (recording happens only on actual attacks, not during target evaluation)
     */
    performTrackedAttack(unit, enemyStack, isRanged) {
        const enemyKey = `${enemyStack.x},${enemyStack.y}`;
        this.focusFireMemory.set(enemyKey, (this.focusFireMemory.get(enemyKey) || 0) + 1);
        this.game.performAttack(unit, enemyStack, isRanged);
    }

    /**
     * Find the best strategic move when no immediate attacks available
     */
    findBestMoveTarget(unit, validMoves, player, isRangedUnit) {
        if (validMoves.length === 0) return null;

        const def = UNIT_DEFINITIONS[unit.type];
        const isFastUnit = def.movement >= 4;
        const priorityTarget = this.findPriorityTarget(unit, player);

        const scoredMoves = validMoves.map(tile => {
            let score = this.evaluateStrategicMove(unit, tile.x, tile.y, player, isRangedUnit, isFastUnit, priorityTarget);
            // Prefer closer moves (less wasted movement)
            score -= tile.cost * 1.5;
            return { ...tile, score };
        });

        scoredMoves.sort((a, b) => b.score - a.score);
        return scoredMoves[0];
    }

    /**
     * Calculate total attack potential of all friendly units that can reach this city
     * Used for coordinated attack assessment
     */
    calculateCoordinatedAttackPotential(city, player, thisUnit) {
        const defenders = this.map.getUnitsAt(city.x, city.y).filter(u => u.owner !== player.id && u.hp > 0);
        if (defenders.length === 0) return { canCapture: true, isCoordinated: false };

        const totalDefenseHp = defenders.reduce((sum, d) => sum + d.hp, 0);
        const totalDefensePower = defenders.reduce((sum, d) => sum + d.effectiveAttack + d.effectiveDefense, 0);

        // Find all friendly units that can reach this city
        let totalAttackPower = 0;
        let unitsInRange = 0;
        let pendingDamage = 0;

        for (const unit of player.units) {
            if (unit.hp <= 0 || unit === thisUnit) continue;
            if (unit.hasMoved && unit.hasAttacked) continue;

            const dist = Utils.manhattanDistance(unit.x, unit.y, city.x, city.y);
            const unitDef = UNIT_DEFINITIONS[unit.type];
            const maxRange = unitDef.movement + unitDef.range;

            if (dist <= maxRange) {
                unitsInRange++;
                // Estimate damage this unit could deal
                const terrainBonus = this.map.getDefenseBonus(city.x, city.y);
                const damage = CombatSystem.calculateDamage(unit, defenders[0], terrainBonus).damage;
                pendingDamage += damage;
                totalAttackPower += unit.effectiveAttack + unit.hp;
            }
        }

        // Add this unit's contribution
        const thisUnitDamage = CombatSystem.calculateDamage(thisUnit, defenders[0], 0).damage;
        pendingDamage += thisUnitDamage;
        totalAttackPower += thisUnit.effectiveAttack + thisUnit.hp;
        unitsInRange++;

        // Can we win through coordinated attacks?
        const canWinCoordinated = pendingDamage >= totalDefenseHp && unitsInRange >= defenders.length;
        const individualWinChance = totalAttackPower > totalDefensePower * 0.8;

        return {
            canCapture: canWinCoordinated || individualWinChance,
            isCoordinated: canWinCoordinated && unitsInRange > 1,
            unitsInRange,
            defendersCount: defenders.length,
            pendingDamage,
            totalDefenseHp,
            // For sacrifice calculation: how much HP would we lose vs gain (city value)
            isSacrificeWorthwhile: pendingDamage >= totalDefenseHp && unitsInRange <= defenders.length + 1
        };
    }

    /**
     * Calculate economic power ratio compared to weakest enemy
     * Used to adjust aggression based on economic advantage
     */
    calculateEconomicAdvantage(player) {
        const myIncome = this.calculateIncome(player);
        const myCities = player.cities.length;

        // Find weakest enemy
        let minEnemyIncome = Infinity;
        let minEnemyCities = Infinity;

        for (const other of this.players) {
            if (other.id === player.id || !other.isAlive) continue;

            const otherIncome = this.calculateIncome(other);
            const otherCities = other.cities.length;

            minEnemyIncome = Math.min(minEnemyIncome, otherIncome);
            minEnemyCities = Math.min(minEnemyCities, otherCities);
        }

        if (minEnemyIncome === Infinity) return { incomeRatio: 1, cityRatio: 1 };

        return {
            incomeRatio: myIncome / minEnemyIncome,
            cityRatio: myCities / minEnemyCities
        };
    }

    /**
     * Find the best strategic target for a unit based on priority:
     * 1. Neutral empty cities (easiest to capture, expand territory)
     * 2. Enemy empty cities (weaken opponent)
     * 3. Ruins (one-time bonus)
     * 4. Enemy defended cities (conquest - with coordinated attack assessment)
     * @param {Unit} unit - the unit looking for a target
     * @param {Player} player - the player owning the unit
     * @param {number} fromX - optional x position to search from (defaults to unit.x)
     * @param {number} fromY - optional y position to search from (defaults to unit.y)
     * @returns {Object|null} Target with type and coordinates
     */
    findPriorityTarget(unit, player, fromX = null, fromY = null) {
        let bestTarget = null;
        let bestScore = -Infinity;
        const maxDistance = unit.movement * 3;
        const startX = fromX !== null ? fromX : unit.x;
        const startY = fromY !== null ? fromY : unit.y;

        // Get economic context for aggression adjustment
        const economicAdvantage = this.calculateEconomicAdvantage(player);
        const isEconomicallyDominant = economicAdvantage.cityRatio >= 1.5 || economicAdvantage.incomeRatio >= 1.5;
        const isNearingEndgame = player.cities.length >= 6; // Late game = more aggressive

        // 1. NEUTRAL EMPTY CITIES - highest priority for expansion
        for (const city of this.map.cities) {
            if (city.owner !== null) continue;

            const dist = Utils.manhattanDistance(startX, startY, city.x, city.y);
            if (dist > maxDistance * 2) continue;

            const defenders = this.map.getUnitsAt(city.x, city.y).filter(u => u.hp > 0);
            let score = 0;

            if (defenders.length === 0) {
                // Empty neutral city - highest priority! Higher score for closer cities
                score = 1000 - dist * 2; // Very low distance penalty so all neutral cities are attractive
            }

            if (score > bestScore) {
                bestScore = score;
                bestTarget = { type: 'neutral_city', x: city.x, y: city.y, city, priority: 1, distance: dist };
            }
        }

        // 2. ENEMY EMPTY CITIES - second priority
        for (const city of this.map.cities) {
            if (city.owner === null || city.owner === player.id) continue;

            const dist = Utils.manhattanDistance(startX, startY, city.x, city.y);
            if (dist > maxDistance * 2) continue;

            const defenders = this.map.getUnitsAt(city.x, city.y).filter(u => u.owner !== player.id && u.hp > 0);
            let score = 0;

            if (defenders.length === 0) {
                // Empty enemy city - high priority
                score = 800 - dist * 5;
                // Higher priority for cities of economically weak enemies (finish them off)
                if (isEconomicallyDominant) {
                    score += 200; // Extra bonus when we're ahead - finish the game!
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestTarget = { type: 'enemy_empty_city', x: city.x, y: city.y, city, priority: 2, distance: dist };
            }
        }

        // 3. RUINS - third priority for bonuses
        for (const ruin of this.map.ruins) {
            const dist = Utils.manhattanDistance(startX, startY, ruin.x, ruin.y);
            if (dist > maxDistance * 2) continue;

            let score = 600 - dist * 8;

            if (score > bestScore) {
                bestScore = score;
                bestTarget = { type: 'ruin', x: ruin.x, y: ruin.y, ruin, priority: 3, distance: dist };
            }
        }

        // 4. ENEMY DEFENDED CITIES - fourth priority (with coordinated attack assessment)
        for (const city of this.map.cities) {
            if (city.owner === null || city.owner === player.id) continue;

            const dist = Utils.manhattanDistance(startX, startY, city.x, city.y);
            if (dist > maxDistance) continue;

            const defenders = this.map.getUnitsAt(city.x, city.y).filter(u => u.owner !== player.id && u.hp > 0);

            if (defenders.length > 0) {
                // Check individual strength (old logic)
                const defenseStrength = defenders.reduce((sum, d) => sum + d.effectiveDefense + d.hp, 0);
                const ourStrength = unit.effectiveAttack + unit.hp;

                // Check coordinated attack potential
                const coordinated = this.calculateCoordinatedAttackPotential(city, player, unit);

                // Determine if we should attack
                let shouldAttack = false;
                let isSacrificePlay = false;

                if (ourStrength > defenseStrength * 0.8) {
                    // Can win individually
                    shouldAttack = true;
                } else if (coordinated.canCapture) {
                    // Can win through coordinated attacks
                    shouldAttack = true;
                    isSacrificePlay = coordinated.isSacrificeWorthwhile;
                } else if (isEconomicallyDominant && coordinated.unitsInRange >= defenders.length) {
                    // Economic advantage: willing to trade units to capture city
                    // Even if we lose this unit, we can replace it faster
                    shouldAttack = true;
                    isSacrificePlay = true;
                } else if (isNearingEndgame && coordinated.unitsInRange >= 2) {
                    // Late game: more willing to sacrifice for progress
                    shouldAttack = true;
                    isSacrificePlay = true;
                }

                // FALLBACK: Always add defended city as target (even if can't win)
                // This ensures units move toward enemy cities even when outmatched
                let score;
                if (shouldAttack) {
                    score = 400 - dist * 6;

                    // Bonus for coordinated attacks (team play)
                    if (coordinated.isCoordinated) {
                        score += 100;
                    }

                    // When economically dominant, prioritize finishing off enemies
                    if (isEconomicallyDominant) {
                        const enemy = this.players[city.owner];
                        if (enemy && enemy.cities.length <= 2) {
                            // This could eliminate a player! High priority
                            score += 300;
                        } else {
                            score += 100; // General bonus for aggressive expansion when ahead
                        }
                    }

                    // Sacrifice plays get bonus when economically justified
                    if (isSacrificePlay && isEconomicallyDominant) {
                        score += 150; // Worth it to trade units for cities when we produce faster
                    }

                    // Check if this is the enemy's last city - EXTREMELY high priority
                    const enemy = this.players[city.owner];
                    if (enemy && enemy.isAlive && enemy.cities.length === 1) {
                        score += 500; // This could win the game!
                    }
                } else {
                    // Even if can't capture, still approach - can still attack nearby enemies
                    score = 200 - dist * 8;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = {
                        type: 'enemy_defended_city',
                        x: city.x,
                        y: city.y,
                        city,
                        defenders,
                        priority: shouldAttack ? 4 : 5,
                        distance: dist,
                        isCoordinated: coordinated.isCoordinated,
                        isSacrificePlay
                    };
                }
            }
        }

        // Fallback: If no city/ruin target found, find nearest enemy unit as target
        // This ensures units always have a goal even when they can't capture cities
        if (!bestTarget) {
            let nearestEnemyUnit = null;
            let minEnemyDist = Infinity;

            for (const unit of this.map.units) {
                if (unit.owner !== player.id && unit.hp > 0) {
                    const dist = Utils.manhattanDistance(startX, startY, unit.x, unit.y);
                    if (dist < minEnemyDist && dist <= maxDistance * 2) {
                        minEnemyDist = dist;
                        nearestEnemyUnit = unit;
                    }
                }
            }

            if (nearestEnemyUnit) {
                bestTarget = {
                    type: 'enemy_unit',
                    x: nearestEnemyUnit.x,
                    y: nearestEnemyUnit.y,
                    unit: nearestEnemyUnit,
                    priority: 5,
                    distance: minEnemyDist
                };
            }
        }

        return bestTarget;
    }

    /**
     * Check if a position is near the front line (close to enemy units/cities)
     */
    isNearFrontLine(x, y, player) {
        for (const unit of this.map.units) {
            if (unit.owner !== player.id && unit.hp > 0) {
                const dist = Utils.chebyshevDistance(x, y, unit.x, unit.y);
                if (dist <= 3) return true;
            }
        }
        for (const city of this.map.cities) {
            if (city.owner !== null && city.owner !== player.id) {
                const dist = Utils.chebyshevDistance(x, y, city.x, city.y);
                if (dist <= 4) return true;
            }
        }
        return false;
    }

    /**
     * Find nearest friendly city to a position
     */
    findNearestFriendlyCity(x, y, player) {
        let nearest = null;
        let minDist = Infinity;
        for (const city of player.cities) {
            const dist = Utils.manhattanDistance(x, y, city.x, city.y);
            if (dist < minDist) {
                minDist = dist;
                nearest = city;
            }
        }
        return nearest;
    }

    /**
     * Evaluate strategic value of a position with improved priorities
     */
    evaluateStrategicMove(unit, x, y, player, isRangedUnit, isFastUnit, priorityTarget = null) {
        let score = 0;
        const def = UNIT_DEFINITIONS[unit.type];

        // 1. CITY DEFENSE: Protect own cities - ESPECIALLY blockaded ones
        for (const city of player.cities) {
            const distToCity = Utils.manhattanDistance(x, y, city.x, city.y);

            // Check if city is blockaded (cannot produce - CRITICAL situation)
            const isBlockaded = this.map.isCityBlockaded(city, player.id);
            const hasEnemyAdjacent = this.hasEnemyAdjacent(city.x, city.y, player);
            const hasEnemyNearby = this.hasEnemyNear(city.x, city.y, player);

            // CRITICAL: Blockaded city needs immediate defense
            if (isBlockaded) {
                if (distToCity === 0) {
                    // We're IN the blockaded city - stay and defend!
                    score += 200; // Massive bonus for defending from inside

                    // If there are enemies adjacent, we can attack - even better
                    const adjacentEnemies = this.getAdjacentEnemies(city.x, city.y, player);
                    if (adjacentEnemies.length > 0 && !unit.hasAttacked) {
                        // Can we win against them?
                        for (const enemy of adjacentEnemies) {
                            const myDamage = CombatSystem.calculateDamage(unit, enemy, 0).damage;
                            if (myDamage >= enemy.hp) {
                                score += 150; // Huge bonus - we can kill the blocker!
                            } else {
                                score += 50; // Still good to damage them
                            }
                        }
                    }
                } else if (distToCity <= 1) {
                    // Adjacent to blockaded city - move in to defend
                    score += 120; // Very high priority to enter the city
                } else if (distToCity <= 3) {
                    // Within range - approach to help
                    score += 80; // High priority to approach blockaded city
                }
            }
            // Threatened but not blockaded
            else if (hasEnemyAdjacent) {
                if (distToCity <= 1) {
                    score += 100; // High priority - enemy is at the gates
                } else if (distToCity <= 2) {
                    score += 60;
                }
            }
            // General city defense (no immediate threat)
            else if (hasEnemyNearby && distToCity <= 2) {
                score += 40; // Moderate priority for general defense
            }
            else if (distToCity <= 1) {
                score += 15; // Small bonus for staying near owned city
            }
        }

        // 2. PRIORITY TARGET SYSTEM: Follow the priority list
        // Target is computed once per unit by the caller - it does not depend on the candidate tile
        const priorityTargetFromCurrent = priorityTarget;

        if (priorityTargetFromCurrent) {
            const distToTarget = Utils.manhattanDistance(x, y, priorityTargetFromCurrent.x, priorityTargetFromCurrent.y);
            const distBefore = priorityTargetFromCurrent.distance;

            // Big bonus for reaching the target
            if (distToTarget === 0) {
                switch (priorityTargetFromCurrent.priority) {
                    case 1: score += 300; break; // Neutral city - massive bonus
                    case 2: score += 250; break; // Enemy empty city
                    case 3: score += 200; break; // Ruin
                    case 4: score += 150; break; // Enemy defended city
                }
            } else if (distToTarget < distBefore) {
                // INCREASED bonuses for getting closer to priority target - higher than movement cost
                switch (priorityTargetFromCurrent.priority) {
                    case 1: score += 80; break;  // Neutral city - very high priority
                    case 2: score += 70; break;  // Enemy empty city
                    case 3: score += 60; break;  // Ruin
                    case 4: score += 50; break;  // Enemy defended city
                }
            }
        }

        // 3. RUIN EXPLORATION - any unit can now explore ruins
        const ruin = this.map.getRuin(x, y);
        if (ruin) {
            score += 90; // High priority for ruins
        }

        // 4. ENHANCED CITY CAPTURE: Different priorities for city types
        const city = this.map.getCity(x, y);
        if (city && city.owner !== player.id) {
            const defenders = this.map.getUnitsAt(city.x, city.y).filter(u => u.owner !== player.id && u.hp > 0);

            if (city.owner === null && defenders.length === 0) {
                // NEUTRAL EMPTY - highest priority
                score += 150;
            } else if (city.owner !== null && defenders.length === 0) {
                // ENEMY EMPTY - high priority
                score += 120;
            } else if (defenders.length > 0) {
                // Defended city - always worth approaching since attacks are free (no retaliation)
                // No penalty - attacking is always beneficial
                score += 30;
            }
        }

        // Also consider approaching cities
        for (const targetCity of this.map.cities) {
            if (targetCity.owner === player.id) continue;

            const distToCity = Utils.manhattanDistance(x, y, targetCity.x, targetCity.y);
            const distBefore = Utils.manhattanDistance(unit.x, unit.y, targetCity.x, targetCity.y);
            const defenders = this.map.getUnitsAt(targetCity.x, targetCity.y).filter(u => u.owner !== player.id && u.hp > 0);

            if (defenders.length === 0 && distToCity < distBefore) {
                // Higher bonus for approaching neutral cities
                if (targetCity.owner === null) {
                    score += 50;
                } else {
                    score += 40;
                }
            }
        }

        // 5. FLANKING: Fast units should flank enemies
        if (isFastUnit) {
            const nearestEnemy = this.findNearestEnemy(unit, player);
            if (nearestEnemy) {
                const distBefore = Utils.manhattanDistance(unit.x, unit.y, nearestEnemy.x, nearestEnemy.y);
                const distAfter = Utils.manhattanDistance(x, y, nearestEnemy.x, nearestEnemy.y);

                // Fast units want to approach from behind/side (get closer but not necessarily adjacent)
                if (distAfter < distBefore && distAfter > 1) {
                    score += 20;
                }

                // Bonus for getting behind enemy lines (near their cities)
                if (nearestEnemy.owner !== null) {
                    const enemyCities = this.map.cities.filter(c => c.owner === nearestEnemy.owner);
                    for (const enemyCity of enemyCities) {
                        const distToEnemyCity = Utils.manhattanDistance(x, y, enemyCity.x, enemyCity.y);
                        if (distToEnemyCity < Utils.manhattanDistance(unit.x, unit.y, enemyCity.x, enemyCity.y)) {
                            score += 15; // Approaching enemy territory
                        }
                    }
                }
            }
        }

        // 4. RANGED POSITIONING: Ranged units want line of sight to enemies
        if (isRangedUnit) {
            for (const otherUnit of this.map.units) {
                if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                    const dist = Utils.chebyshevDistance(x, y, otherUnit.x, otherUnit.y);
                    if (dist <= def.range && dist > 1) {
                        score += 25; // Can attack from here
                    }
                }
            }

            // Ranged units want to be behind friendly units
            let friendlyUnitsNearby = 0;
            for (const friendly of player.units) {
                if (friendly !== unit && friendly.hp > 0) {
                    const friendlyDist = Utils.chebyshevDistance(x, y, friendly.x, friendly.y);
                    if (friendlyDist <= 2) {
                        friendlyUnitsNearby++;
                    }
                }
            }
            score += friendlyUnitsNearby * 10; // Bonus for being near friendly units
        }

        // 5. DEFENSIVE TERRAIN: Use terrain bonuses effectively
        const terrain = this.map.getTerrain(x, y);
        if (terrain === TERRAIN.MOUNTAINS) {
            score += 12; // Best defensive bonus
        } else if (terrain === TERRAIN.FOREST) {
            score += 8;
        }

        // Ranged units especially like hills (mountains)
        if (isRangedUnit && terrain === TERRAIN.MOUNTAINS) {
            score += 10;
        }

        // 6. AVOID DANGER: Don't move adjacent to strong enemies unless ready to fight
        for (const otherUnit of this.map.units) {
            if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                const enemyDist = Utils.chebyshevDistance(x, y, otherUnit.x, otherUnit.y);
                const enemyDef = UNIT_DEFINITIONS[otherUnit.type];

                if (enemyDist === 1) {
                    // Adjacent to enemy - check if we can win the fight
                    const terrainBonus = this.map.getDefenseBonus(x, y);
                    const myDamage = CombatSystem.calculateDamage(unit, otherUnit, 0).damage; // Enemy terrain bonus handled elsewhere
                    const enemyDamage = CombatSystem.calculateDamage(otherUnit, unit, terrainBonus).damage;

                    // If we'd lose the exchange, penalty
                    if (enemyDamage > myDamage && !unit.isHero) {
                        score -= 30;
                    } else {
                        score += 10; // We can win, good position
                    }
                }
            }
        }

        // 7. FRONT LINE CONSTRUCTION: Bonus for being near front line
        // This encourages building units closer to where they're needed
        if (this.isNearFrontLine(x, y, player)) {
            score += 20; // General bonus for front line presence

            // Extra bonus for defensive units on front line
            if (unit.effectiveDefense >= 4) {
                score += 15;
            }
        }

        // 9. ALWAYS EXPAND: Find nearest neutral city and move toward it
        // This is critical for early game expansion - don't just sit around!
        let nearestNeutralCity = null;
        let minNeutralDist = Infinity;

        for (const city of this.map.cities) {
            if (city.owner !== null) continue; // Only neutral cities for early expansion
            const dist = Utils.manhattanDistance(unit.x, unit.y, city.x, city.y);
            if (dist < minNeutralDist) {
                minNeutralDist = dist;
                nearestNeutralCity = city;
            }
        }

        let targetCity = nearestNeutralCity;

        if (targetCity) {
            const distBefore = Utils.manhattanDistance(unit.x, unit.y, targetCity.x, targetCity.y);
            const distAfter = Utils.manhattanDistance(x, y, targetCity.x, targetCity.y);

            // Strong bonus for moving closer to neutral city - higher than movement cost
            if (distAfter < distBefore) {
                score += 35; // Base bonus for moving closer
            }
            // Extra bonus for each tile closer
            const tilesCloser = distBefore - distAfter;
            if (tilesCloser >= 1) {
                score += tilesCloser * 15; // +15 per tile
            }
            // Massive bonus for reaching the city
            if (distAfter === 0) {
                score += 100;
            }

            // 9b. OPPORTUNITY TARGETS: Check for interesting things along the way
            // (the ruin and city bonuses for the tile itself are handled in sections 3 and 4)

            // Opportunity: Check if we're passing close to another neutral city
            for (const otherCity of this.map.cities) {
                if (otherCity.owner !== null || otherCity === targetCity) continue;

                const distToOtherFromNew = Utils.manhattanDistance(x, y, otherCity.x, otherCity.y);
                const distToOtherFromOld = Utils.manhattanDistance(unit.x, unit.y, otherCity.x, otherCity.y);
                const defenders = this.map.getUnitsAt(otherCity.x, otherCity.y).filter(u => u.hp > 0);

                if (defenders.length === 0 && distToOtherFromNew < distToOtherFromOld && distToOtherFromNew <= 2) {
                    // We're getting closer to another capturable city
                    score += 30; // Bonus for efficient path that captures multiple cities
                }
            }

            // WAYPOINT BONUS: Ruins along the way to main target
            for (const ruin of this.map.ruins) {
                // Check if this move gets us closer to the ruin
                const distToRuinFromNew = Utils.manhattanDistance(x, y, ruin.x, ruin.y);
                const distToRuinFromOld = Utils.manhattanDistance(unit.x, unit.y, ruin.x, ruin.y);

                if (distToRuinFromNew < distToRuinFromOld && distToRuinFromNew <= 3) {
                    // We're approaching a ruin - good side trip
                    score += 25; // Moderate bonus for efficient path
                }
            }

            // WAYPOINT BONUS: Enemy cities along the way (for later conquest)
            for (const enemyCity of this.map.cities) {
                if (enemyCity.owner === null || enemyCity.owner === player.id) continue;

                const distToCityFromNew = Utils.manhattanDistance(x, y, enemyCity.x, enemyCity.y);
                const distToCityFromOld = Utils.manhattanDistance(unit.x, unit.y, enemyCity.x, enemyCity.y);

                if (distToCityFromNew < distToCityFromOld && distToCityFromNew <= 4) {
                    // We're approaching enemy territory
                    const defenders = this.map.getUnitsAt(enemyCity.x, enemyCity.y).filter(u => u.owner !== player.id && u.hp > 0);

                    if (defenders.length === 0) {
                        // Empty enemy city - very good to approach
                        score += 40;
                    } else {
                        // Defended city - some reconnaissance value
                        score += 15;
                    }
                }
            }
        }

        // If no neutral cities, look for enemy cities/units (secondary priority)
        if (!nearestNeutralCity) {
            let nearestEnemyTarget = null;
            let minEnemyDist = Infinity;

            for (const city of this.map.cities) {
                if (city.owner === player.id) continue;
                const dist = Utils.manhattanDistance(unit.x, unit.y, city.x, city.y);
                if (dist < minEnemyDist) {
                    minEnemyDist = dist;
                    nearestEnemyTarget = city;
                }
            }

            for (const otherUnit of this.map.units) {
                if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                    const dist = Utils.manhattanDistance(unit.x, unit.y, otherUnit.x, otherUnit.y);
                    if (dist < minEnemyDist) {
                        minEnemyDist = dist;
                        nearestEnemyTarget = otherUnit;
                    }
                }
            }

            if (nearestEnemyTarget) {
                const distBefore = Utils.manhattanDistance(unit.x, unit.y, nearestEnemyTarget.x, nearestEnemyTarget.y);
                const distAfter = Utils.manhattanDistance(x, y, nearestEnemyTarget.x, nearestEnemyTarget.y);

                if (distAfter < distBefore) {
                    score += 20;
                }
                if (distBefore - distAfter >= 2) {
                    score += 10;
                }
            }
        }

        // 10. INFLUENCE MAP: Use strategic positioning from influence map
        const threat = this.influenceMap.getThreatLevel(x, y);
        const friendly = this.influenceMap.getFriendlyInfluence(x, y);

        // High threat areas are dangerous for damaged units
        if (threat > 5) {
            const healthPercent = unit.hp / def.hp;
            if (healthPercent < 0.5) {
                score -= threat * 3; // Damaged units avoid high-threat areas
            } else if (healthPercent < 0.8) {
                score -= threat * 1.5; // Slightly damaged units are cautious
            }
            // Healthy units can push into threat if attacking
        } else if (threat < -3) {
            // Safe area (friendly dominance)
            score += 5; // Small bonus for safe positioning
        }

        // Ranged units specifically benefit from friendly influence (screened positions)
        if (isRangedUnit && friendly > 3) {
            score += friendly * 2; // Ranged units want friendly support nearby
        }

        // Defensive units want high-threat areas they can hold
        if (def.defense >= 4 && threat > 0 && threat < 5) {
            score += 10; // Tanks can hold contested ground
        }

        return score;
    }

    /**
     * Check if there's an enemy near a position (within 3 tiles)
     */
    hasEnemyNear(x, y, player) {
        for (const unit of this.map.units) {
            if (unit.owner !== player.id && unit.hp > 0) {
                const dist = Utils.manhattanDistance(x, y, unit.x, unit.y);
                if (dist <= 3) return true;
            }
        }
        return false;
    }

    /**
     * Check if there's an enemy adjacent to a position (within 1 tile - Chebyshev)
     */
    hasEnemyAdjacent(x, y, player) {
        for (const unit of this.map.units) {
            if (unit.owner !== player.id && unit.hp > 0) {
                const dist = Utils.chebyshevDistance(x, y, unit.x, unit.y);
                if (dist === 1) return true;
            }
        }
        return false;
    }

    /**
     * Get all enemies adjacent to a position
     */
    getAdjacentEnemies(x, y, player) {
        const enemies = [];
        for (const unit of this.map.units) {
            if (unit.owner !== player.id && unit.hp > 0) {
                const dist = Utils.chebyshevDistance(x, y, unit.x, unit.y);
                if (dist === 1) {
                    enemies.push(unit);
                }
            }
        }
        return enemies;
    }

    /**
     * Handle hero-specific actions with care for survival
     */
    async handleHeroActions(player) {
        const hero = player.getHero();
        if (!hero || hero.hasMoved) return;

        const reachable = MovementSystem.getReachableTiles(hero, this.map);

        // Filter out tiles occupied by friendly units
        const validMoves = reachable.filter(t => {
            const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
            return !existingUnit;
        });

        // Check if hero would be in danger at each position
        const safeMoves = validMoves.filter(t => {
            if (t.isEnemy) return false;

            // Check if moving here would put us adjacent to enemies
            for (const unit of this.map.units) {
                if (unit.owner !== player.id && unit.hp > 0) {
                    const dist = Utils.chebyshevDistance(t.x, t.y, unit.x, unit.y);
                    if (dist === 1) {
                        // Would be adjacent to enemy - check if we could die
                        const terrainBonus = this.map.getDefenseBonus(t.x, t.y);
                        const enemyDamage = CombatSystem.calculateDamage(unit, hero, terrainBonus).damage;
                        if (enemyDamage >= hero.hp) {
                            return false; // Too dangerous
                        }
                    }
                }
            }
            return true;
        });

        // Hero priority targets: 0. Defend blockaded cities, 1. Neutral empty cities, 2. Enemy empty cities, 3. Ruins, 4. Opportunity attacks

        // PRIORITY 0: HERO DEFENSE - Blockaded cities need immediate help!
        // Heroes are strong defenders - use them to break blockades
        const blockadedCities = player.cities.filter(city =>
            this.map.isCityBlockaded(city, player.id)
        );

        for (const blockadedCity of blockadedCities) {
            const dist = Utils.manhattanDistance(hero.x, hero.y, blockadedCity.x, blockadedCity.y);

            // If hero is in the blockaded city, attack the blockers
            if (hero.x === blockadedCity.x && hero.y === blockadedCity.y) {
                const adjacentEnemies = this.getAdjacentEnemies(blockadedCity.x, blockadedCity.y, player);

                if (adjacentEnemies.length > 0 && !hero.hasAttacked) {
                    // Find the best enemy to attack
                    let bestEnemy = null;
                    let bestScore = -Infinity;

                    for (const enemy of adjacentEnemies) {
                        const myDamage = CombatSystem.calculateDamage(hero, enemy, 0).damage;
                        let score = myDamage;
                        if (enemy.isHero) score += 100;
                        if (enemy.type === 'DRAGON') score += 50;

                        if (score > bestScore) {
                            bestScore = score;
                            bestEnemy = enemy;
                        }
                    }

                    if (bestEnemy) {
                        const enemyStack = this.map.getStack(bestEnemy.x, bestEnemy.y);
                        if (enemyStack) {
                            const isRanged = Utils.chebyshevDistance(hero.x, hero.y, bestEnemy.x, bestEnemy.y) > 1;
                            this.performTrackedAttack(hero, enemyStack, isRanged);
                            await this.delay(400);
                            return;
                        }
                    }
                }
                // Can't attack, but we're defending - stay here
                return;
            }

            // If hero is adjacent, move in to defend
            if (dist === 1) {
                const canMoveIn = validMoves.find(t => t.x === blockadedCity.x && t.y === blockadedCity.y);
                if (canMoveIn) {
                    await this.game.moveUnit(hero, blockadedCity.x, blockadedCity.y);
                    await this.delay(300);

                    // Attack immediately after moving in
                    const adjacentEnemies = this.getAdjacentEnemies(blockadedCity.x, blockadedCity.y, player);
                    if (adjacentEnemies.length > 0 && !hero.hasAttacked) {
                        const enemyStack = this.map.getStack(adjacentEnemies[0].x, adjacentEnemies[0].y);
                        if (enemyStack) {
                            this.performTrackedAttack(hero, enemyStack, false);
                            await this.delay(400);
                        }
                    }
                    return;
                }
            }

            // If hero is within 5 tiles, move toward the blockaded city
            if (dist <= 5) {
                const moveToward = validMoves.find(t => {
                    const newDist = Utils.manhattanDistance(t.x, t.y, blockadedCity.x, blockadedCity.y);
                    return newDist < dist;
                });

                if (moveToward) {
                    await this.game.moveUnit(hero, moveToward.x, moveToward.y);
                    await this.delay(300);
                    return;
                }
            }
        }

        // HERO OPPORTUNITY ATTACKS: Check for valuable enemies we can safely attack along the way
        // Heroes are strong - they can pick off enemies while moving toward objectives
        if (!hero.hasAttacked) {
            let bestOpportunity = null;
            let bestOppScore = -Infinity;
            const priorityTarget = this.findPriorityTarget(hero, player);

            for (const moveTile of validMoves) {
                // Check for enemies at this tile
                const enemiesHere = this.map.getUnitsAt(moveTile.x, moveTile.y).filter(u => u.owner !== player.id && u.hp > 0);

                for (const enemy of enemiesHere) {
                    // Calculate combat outcome
                    const myDamage = CombatSystem.calculateDamage(hero, enemy, 0).damage;
                    const enemyDamage = CombatSystem.calculateDamage(enemy, hero, this.map.getDefenseBonus(moveTile.x, moveTile.y)).damage;

                    let oppScore = 0;
                    let safeToAttack = true;

                    // Can we kill them?
                    if (myDamage >= enemy.hp) {
                        oppScore += 100;
                        if (enemy.isHero) oppScore += 200; // Huge bonus for killing enemy hero
                        if (enemy.type === 'DRAGON') oppScore += 100;
                    }
                    // Favorable trade?
                    else if (myDamage > enemyDamage) {
                        oppScore += 50;
                    }
                    // Even if not favorable, might be worth it for key targets
                    else if (enemy.isHero) {
                        oppScore += 75; // Hero vs hero is always interesting
                        if (hero.hp < enemyDamage * 2) safeToAttack = false; // But don't suicide
                    }
                    else if (enemy.type === 'DRAGON' || enemy.type === 'CATAPULT') {
                        oppScore += 40; // Valuable targets
                    }

                    // Check if this move progresses us toward a city
                    if (priorityTarget) {
                        const distBefore = Utils.manhattanDistance(hero.x, hero.y, priorityTarget.x, priorityTarget.y);
                        const distAfter = Utils.manhattanDistance(moveTile.x, moveTile.y, priorityTarget.x, priorityTarget.y);
                        if (distAfter < distBefore) {
                            oppScore += 30; // Good - killing while progressing
                        }
                    }

                    // Ruin on this tile? Even better!
                    const ruinHere = this.map.getRuin(moveTile.x, moveTile.y);
                    if (ruinHere && safeToAttack) {
                        oppScore += 50; // Extra bonus for ruin after combat
                    }

                    if (safeToAttack && oppScore > bestOppScore && oppScore > 0) {
                        bestOppScore = oppScore;
                        bestOpportunity = { tile: moveTile, enemy, ruin: ruinHere };
                    }
                }
            }

            // Execute opportunity attack if it's good enough
            if (bestOpportunity && bestOppScore >= 70) {
                const enemyStack = this.map.getStack(bestOpportunity.tile.x, bestOpportunity.tile.y);
                if (enemyStack) {
                    await this.game.moveUnit(hero, bestOpportunity.tile.x, bestOpportunity.tile.y);
                    await this.delay(300);

                    // If enemy survived and we're in melee range, attack again
                    if (!hero.hasAttacked && hero.x === bestOpportunity.enemy.x && hero.y === bestOpportunity.enemy.y) {
                        // Combat already resolved, but check if enemy stack still exists
                        const remainingStack = this.map.getStack(bestOpportunity.enemy.x, bestOpportunity.enemy.y);
                        if (remainingStack && remainingStack.owner !== player.id) {
                            // Enemy still there - might need another round
                            await this.delay(200);
                        }
                    }
                    return; // Hero's turn is done
                }
            }
        }

        // Priority 1: Capture neutral undefended cities (best for expansion)
        const neutralCityTile = safeMoves.find(t => {
            const city = this.map.getCity(t.x, t.y);
            if (!city || city.owner !== null) return false;
            const defenders = this.map.getUnitsAt(t.x, t.y).filter(u => u.hp > 0);
            return defenders.length === 0;
        });

        if (neutralCityTile) {
            await this.game.moveUnit(hero, neutralCityTile.x, neutralCityTile.y);
            await this.delay(300);
            return;
        }

        // Priority 2: Capture enemy undefended cities
        const enemyCityTile = safeMoves.find(t => {
            const city = this.map.getCity(t.x, t.y);
            if (!city || city.owner === null || city.owner === player.id) return false;
            const defenders = this.map.getUnitsAt(t.x, t.y).filter(u => u.owner !== player.id && u.hp > 0);
            return defenders.length === 0;
        });

        if (enemyCityTile) {
            await this.game.moveUnit(hero, enemyCityTile.x, enemyCityTile.y);
            await this.delay(300);
            return;
        }

        // Priority 3: Explore ruins (if safe)
        const ruin = safeMoves.find(t => this.map.getRuin(t.x, t.y));
        if (ruin) {
            await this.game.moveUnit(hero, ruin.x, ruin.y);
            await this.delay(300);
            return;
        }

        // Priority 4: Stay near friendly units for protection
        const supportiveMove = this.findSupportivePosition(hero, safeMoves, player);
        if (supportiveMove) {
            await this.game.moveUnit(hero, supportiveMove.x, supportiveMove.y);
            await this.delay(300);
            return;
        }

        // Priority 5: Strategic move (only if safe)
        if (safeMoves.length > 0) {
            const moveTarget = this.findBestMoveTarget(hero, safeMoves, player, false);
            if (moveTarget) {
                await this.game.moveUnit(hero, moveTarget.x, moveTarget.y);
                await this.delay(300);
            }
        }
    }

    /**
     * Find position near friendly units for hero support
     */
    findSupportivePosition(hero, validMoves, player) {
        if (validMoves.length === 0) return null;

        const scoredMoves = validMoves.map(tile => {
            let score = 0;

            // Count nearby friendly units
            let friendlyCount = 0;
            for (const unit of player.units) {
                if (unit !== hero && unit.hp > 0) {
                    const dist = Utils.chebyshevDistance(tile.x, tile.y, unit.x, unit.y);
                    if (dist <= 2) {
                        friendlyCount++;
                        score += 20; // Bonus for each nearby friendly unit
                    }
                }
            }

            // Bonus for being near cities
            for (const city of player.cities) {
                const dist = Utils.manhattanDistance(tile.x, tile.y, city.x, city.y);
                if (dist <= 2) {
                    score += 15;
                }
            }

            // Defensive terrain bonus
            const terrain = this.map.getTerrain(tile.x, tile.y);
            if (terrain === TERRAIN.MOUNTAINS) score += 10;
            if (terrain === TERRAIN.FOREST) score += 5;

            return { ...tile, score };
        });

        scoredMoves.sort((a, b) => b.score - a.score);
        return scoredMoves[0];
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
     * Uses 0ms when tab is hidden to avoid browser throttling
     */
    delay(ms) {
        if (document.hidden) {
            // Use MessageChannel to bypass setTimeout throttling in background tabs
            return new Promise(resolve => {
                const ch = new MessageChannel();
                ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
                ch.port2.postMessage(null);
            });
        }
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
