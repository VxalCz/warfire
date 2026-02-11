import { Utils, Events } from '../utils.js';
import { MovementSystem } from './MovementSystem.js';
import { CombatSystem } from './CombatSystem.js';
import { UNIT_DEFINITIONS, CITY_INCOME, TERRAIN } from '../constants.js';

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

        // Track which units attacked which targets this turn (for focus fire)
        this.focusFireMemory = new Map();
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

        // Reset focus fire tracking for new turn
        this.focusFireMemory.clear();

        Events.emit('ai:turnStarted', { player });

        try {
            // Phase 1: Handle city production
            await this.handleProduction(player);

            // Phase 2: Retreat damaged units first (before combat)
            await this.handleRetreats(player);

            // Phase 3: Move and attack with units (sorted by tactical priority)
            await this.handleUnitActions(player);

            // Phase 4: Hero actions (explore ruins, capture cities)
            await this.handleHeroActions(player);

            // Small delay before ending turn
            await this.delay(this.thinkDelay);

        } catch (error) {
            console.error('AI error:', error);
        }

        this.isRunning = false;
        Events.emit('ai:turnEnded', { player });

        // End turn (unless in spectator mode - scheduler handles that)
        if (!this.game.isSpectatorMode) {
            this.game.endTurn();
        }
    }

    /**
     * Handle city production decisions with context-aware strategy
     */
    async handleProduction(player) {
        // Calculate economic situation
        const income = this.calculateIncome(player);
        const turn = this.game.turn || 1;
        const isLateGame = turn > 20;

        // Get enemy army composition for counter-strategy
        const enemyComposition = this.analyzeEnemyComposition(player);
        const mapHasWater = this.analyzeMapTerrain();

        for (const city of player.cities) {
            // Check if city is blockaded - cannot produce if enemy adjacent
            if (this.map.isCityBlockaded(city, player.id)) {
                Events.emit('ai:blockaded', { player, city });
                continue; // Skip this city, it's under siege
            }

            // Decide what to build based on comprehensive analysis
            const unitType = this.decideProduction(player, income, isLateGame, enemyComposition, mapHasWater, city);
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
        const units = player.units;
        const gold = player.gold;

        // Count unit types
        const counts = {};
        for (const type of Object.keys(UNIT_DEFINITIONS)) {
            counts[type] = units.filter(u => u.type === type && u.hp > 0).length;
        }

        // Priority 0: Buy hero if we don't have one (heroes are now purchasable)
        const hero = player.getHero();
        if (!hero && gold >= 50) {
            return 'HERO';
        }

        // Check if this city is near front line
        const isFrontLineCity = city ? this.isNearFrontLine(city.x, city.y, player) : false;
        const cityPriority = city ? this.getCityProductionPriority(city, player) : 0;

        // EMERGENCY: Check if we have blockaded cities and this city can produce defenders
        const hasBlockadedCities = player.cities.some(c =>
            this.map.isCityBlockaded(c, player.id) && c !== city
        );

        if (hasBlockadedCities && city && !this.map.isCityBlockaded(city, player.id)) {
            // This city is NOT blockaded but others are - produce fast defenders!
            if (gold >= 30 && counts.CAVALRY < 3) {
                return 'CAVALRY'; // Fast unit to rush to defense
            }
            if (gold >= 10 && counts.LIGHT_INFANTRY < 4) {
                return 'LIGHT_INFANTRY'; // Cheap unit to send help
            }
        }

        // Priority 1: Counter-strategy against enemy composition
        const enemyCavalry = enemyComposition.CAVALRY || 0;
        const enemyArchers = enemyComposition.ARCHER || 0;
        const enemyHeavy = enemyComposition.HEAVY_INFANTRY || 0;
        const enemyDragons = enemyComposition.DRAGON || 0;

        // If enemy has many cavalry (fast but low defense), build heavy infantry
        if (enemyCavalry >= 2 && counts.HEAVY_INFANTRY < 3 && gold >= 20) {
            return 'HEAVY_INFANTRY';
        }

        // If enemy has many heavy infantry, build archers (kite them)
        if (enemyHeavy >= 2 && counts.ARCHER < 3 && gold >= 15) {
            return 'ARCHER';
        }

        // If enemy has dragons, build archers or catapults for ranged damage
        if (enemyDragons >= 1 && gold >= 40) {
            return 'CATAPULT';
        }

        // Priority 2: Map-based decisions
        if (mapHasWater && counts.DRAGON < 1 && gold >= 100) {
            return 'DRAGON'; // Dragons can fly over water
        }

        // Priority 3: Front-line production - build cheap units quickly at front
        if (isFrontLineCity && cityPriority >= 40) {
            // Front line needs units NOW - prioritize cheap and fast
            if (counts.LIGHT_INFANTRY < 4 && gold >= 10) {
                return 'LIGHT_INFANTRY';
            }
            if (counts.CAVALRY < 2 && gold >= 30) {
                return 'CAVALRY'; // Fast response
            }
            if (gold >= 15 && counts.ARCHER < 2) {
                return 'ARCHER'; // Ranged support
            }
        }

        // Priority 4: Early game expansion
        if (!isLateGame) {
            // Need cheap fast units for expansion
            if (counts.LIGHT_INFANTRY < 2 && gold >= 10) {
                return 'LIGHT_INFANTRY';
            }
            if (counts.CAVALRY < 1 && gold >= 30) {
                return 'CAVALRY';
            }
        }

        // Priority 6: Balanced army composition with role-based targets
        // Adjust targets based on city position - front line cities want different units
        let targetRanged = 2;
        let targetCavalry = 2;
        let targetHeavy = 2;

        // Front line cities prefer defensive units
        if (isFrontLineCity) {
            targetHeavy = 3; // More heavy units for defense
            targetRanged = 2;
        }

        const currentRanged = counts.ARCHER + counts.CATAPULT;
        const currentCavalry = counts.CAVALRY;
        const currentHeavy = counts.HEAVY_INFANTRY + counts.DRAGON;

        if (currentRanged < targetRanged && gold >= 15) {
            if (gold >= 40 && counts.CATAPULT < 1) return 'CATAPULT';
            return 'ARCHER';
        }

        if (currentCavalry < targetCavalry && gold >= 30) {
            return 'CAVALRY';
        }

        if (currentHeavy < targetHeavy) {
            if (gold >= 100 && counts.DRAGON < 1) return 'DRAGON';
            if (gold >= 20) return 'HEAVY_INFANTRY';
        }

        // Priority 8: Economic-based late game
        if (isLateGame || income >= 30) {
            if (gold >= 100) return 'DRAGON';
            if (gold >= 40) return 'CATAPULT';
            if (gold >= 30) return 'CAVALRY';
        }

        // Priority 9: Emergency reserves
        if (counts.LIGHT_INFANTRY < 1 && gold >= 10) {
            return 'LIGHT_INFANTRY';
        }

        // Fallback based on available gold
        if (gold >= 40) return 'CATAPULT';
        if (gold >= 30) return 'CAVALRY';
        if (gold >= 20) return 'HEAVY_INFANTRY';
        if (gold >= 15) return 'ARCHER';
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
                this.game.moveUnit(unit, retreatTarget.x, retreatTarget.y);
                await this.delay(300);
            }
        }
    }

    /**
     * Find safe position to retreat to (towards own cities, away from enemies)
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

            // Avoid enemies - penalize tiles near enemies
            for (const otherUnit of this.map.units) {
                if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                    const enemyDist = Utils.manhattanDistance(tile.x, tile.y, otherUnit.x, otherUnit.y);
                    if (enemyDist <= 2) {
                        score -= 30; // Penalty for being near enemies
                    }
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

            await this.handleSingleUnit(unit, player);
            await this.delay(200);
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

        // For ranged units: prioritize kiting (attack from current position, then move away)
        if (isRangedUnit && bestCurrentAttack && !unit.hasAttacked) {
            const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestCurrentAttack.target.x, bestCurrentAttack.target.y) > 1;
            this.game.performAttack(unit, bestCurrentAttack.enemyStack, isRanged);
            await this.delay(400);

            // After ranged attack, try to move to safer position (kiting)
            if (!unit.hasMoved) {
                const kiteTarget = this.findKitePosition(unit, bestCurrentAttack.target, player);
                if (kiteTarget) {
                    this.game.moveUnit(unit, kiteTarget.x, kiteTarget.y);
                    await this.delay(300);
                }
            }
            return;
        }

        // For melee units: attack from current position if good target
        if (bestCurrentAttack && !unit.hasAttacked && bestCurrentAttack.score > 0) {
            const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestCurrentAttack.target.x, bestCurrentAttack.target.y) > 1;
            this.game.performAttack(unit, bestCurrentAttack.enemyStack, isRanged);
            await this.delay(400);

            // After melee attack, limited movement options
            if (!unit.hasMoved) {
                // Can still move if we haven't
                const retreatTarget = this.findRetreatAfterAttack(unit, player);
                if (retreatTarget) {
                    this.game.moveUnit(unit, retreatTarget.x, retreatTarget.y);
                    await this.delay(300);
                }
            }
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

                // Check all reachable positions for enemies we could attack from there
                for (const moveTile of validMoves) {
                    const enemiesAtTile = this.map.getUnitsAt(moveTile.x, moveTile.y).filter(u => u.owner !== player.id && u.hp > 0);

                    for (const enemy of enemiesAtTile) {
                        // Can we win this fight?
                        const myDamage = CombatSystem.calculateDamage(unit, enemy, 0).damage;
                        const enemyDamage = CombatSystem.calculateDamage(enemy, unit, this.map.getDefenseBonus(moveTile.x, moveTile.y)).damage;

                        let opportunityScore = 0;

                        // High priority for kills
                        if (myDamage >= enemy.hp) {
                            opportunityScore += 100;
                            // Extra bonus for killing strong units
                            if (enemy.isHero) opportunityScore += 150;
                            if (enemy.type === 'DRAGON') opportunityScore += 80;
                            if (enemy.type === 'CATAPULT') opportunityScore += 50;
                        }
                        // Favorable trades are good too
                        else if (myDamage > enemyDamage * 1.5) {
                            opportunityScore += 50;
                        }
                        // Even unfavorable trade might be worth it if enemy is key target
                        else if (enemy.isHero || enemy.type === 'DRAGON') {
                            opportunityScore += 30; // Some value in damaging key units
                        }

                        // Check if this move also progresses us toward our goal
                        const targetCity = this.findPriorityTarget(unit, player);
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
                        this.game.moveUnit(unit, bestOpportunityAttack.tile.x, bestOpportunityAttack.tile.y);
                        await this.delay(300);

                        // Attack from new position (or melee combat happens automatically)
                        const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestOpportunityAttack.enemy.x, bestOpportunityAttack.enemy.y) > 1;
                        if (!isRanged && unit.x === bestOpportunityAttack.enemy.x && unit.y === bestOpportunityAttack.enemy.y) {
                            // Melee combat - already resolved by moveUnit
                            await this.delay(200);
                        } else if (!unit.hasAttacked) {
                            // Ranged attack from new position
                            this.game.performAttack(unit, enemyStack, true);
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
                            const score = this.evaluateAttackTarget(unit, enemyStack, target.x, target.y, player);
                            if (score > bestScore) {
                                bestScore = score;
                                bestPostMoveAttack = { target, enemyStack };
                            }
                        }
                    }

                    if (bestPostMoveAttack && bestScore > 0) {
                        const isRanged = Utils.chebyshevDistance(unit.x, unit.y, bestPostMoveAttack.target.x, bestPostMoveAttack.target.y) > 1;
                        this.game.performAttack(unit, bestPostMoveAttack.enemyStack, isRanged);
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
                            this.game.performAttack(unit, enemyStack, isRanged);
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
                    this.game.moveUnit(unit, city.x, city.y);
                    await this.delay(300);

                    // Try to attack immediately after moving in
                    const adjacentEnemies = this.getAdjacentEnemies(city.x, city.y, player);
                    if (adjacentEnemies.length > 0 && !unit.hasAttacked) {
                        const enemyStack = this.map.getStack(adjacentEnemies[0].x, adjacentEnemies[0].y);
                        if (enemyStack) {
                            const isRanged = Utils.chebyshevDistance(unit.x, unit.y, adjacentEnemies[0].x, adjacentEnemies[0].y) > 1;
                            this.game.performAttack(unit, enemyStack, isRanged);
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
                    this.game.moveUnit(unit, moveTowardCity.x, moveTowardCity.y);
                    await this.delay(300);
                    return true;
                }
            }
        }

        return false; // No defense action taken
    }

    /**
     * Find position to kite to after ranged attack (away from enemy, towards safety)
     */
    findKitePosition(unit, attackTarget, player) {
        const reachable = MovementSystem.getReachableTiles(unit, this.map);

        const validMoves = reachable.filter(t => {
            const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
            return !existingUnit && !t.isEnemy;
        });

        if (validMoves.length === 0) return null;

        const scoredMoves = validMoves.map(tile => {
            let score = 0;

            // Move away from the target we just attacked
            const distFromTarget = Utils.chebyshevDistance(tile.x, tile.y, attackTarget.x, attackTarget.y);
            score += distFromTarget * 20; // Bonus for distance from attacked enemy

            // But stay within attack range for next turn
            const def = UNIT_DEFINITIONS[unit.type];
            if (distFromTarget <= def.range && distFromTarget > 1) {
                score += 30; // Sweet spot: in range but not adjacent
            }

            // Avoid other enemies
            for (const otherUnit of this.map.units) {
                if (otherUnit.owner !== player.id && otherUnit.hp > 0) {
                    const enemyDist = Utils.chebyshevDistance(tile.x, tile.y, otherUnit.x, otherUnit.y);
                    if (enemyDist <= 1) {
                        score -= 50; // Avoid adjacency to any enemy
                    }
                }
            }

            // Prefer defensive terrain
            const terrain = this.map.getTerrain(tile.x, tile.y);
            if (terrain === TERRAIN.MOUNTAINS) score += 15;
            if (terrain === TERRAIN.FOREST) score += 8;

            return { ...tile, score };
        });

        scoredMoves.sort((a, b) => b.score - a.score);
        return scoredMoves[0];
    }

    /**
     * Find position to retreat to after melee attack (defensive position)
     */
    findRetreatAfterAttack(unit, player) {
        const reachable = MovementSystem.getReachableTiles(unit, this.map);

        const validMoves = reachable.filter(t => {
            const existingUnit = this.map.getUnitsAt(t.x, t.y).find(u => u.owner === player.id && u.hp > 0);
            return !existingUnit && !t.isEnemy;
        });

        if (validMoves.length === 0) return null;

        // If unit is damaged, try to move away from enemies
        const def = UNIT_DEFINITIONS[unit.type];
        const healthPercent = unit.hp / def.hp;

        if (healthPercent > 0.6) {
            return null; // Healthy units stay in combat
        }

        return this.findRetreatTarget(unit, player);
    }

    /**
     * Evaluate an attack target with advanced scoring (higher score = better target)
     */
    evaluateAttackTarget(unit, enemyStack, targetX, targetY, player) {
        const enemy = enemyStack.getCombatUnit();
        if (!enemy) return -1000;

        let score = 0;
        const enemyDef = UNIT_DEFINITIONS[enemy.type];
        const myDef = UNIT_DEFINITIONS[unit.type];

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
        if (damage >= enemy.hp) {
            score += 60; // Kill bonus

            // Extra bonus for efficient kills (we take no damage)
            score += 20;
        }

        // DAMAGE EFFICIENCY: Calculate expected retaliation damage
        const myTerrainBonus = this.map.getDefenseBonus(unit.x, unit.y);
        const retaliationDamage = CombatSystem.calculateDamage(enemy, unit, myTerrainBonus).damage;
        const damageToMe = Math.min(unit.hp, retaliationDamage);

        // Prefer fights where we deal more damage than we take
        const damageEfficiency = damage - damageToMe;
        score += damageEfficiency * 2;

        // Avoid suicidal attacks (where we would die)
        if (damageToMe >= unit.hp) {
            // Only attack if we can kill and it's a high-value target
            if (damage < enemy.hp || (!enemy.isHero && enemy.type !== 'DRAGON' && enemy.type !== 'CATAPULT')) {
                score -= 200; // Strong penalty for suicidal attacks
            }
        }

        // City capture bonus
        const city = this.map.getCity(targetX, targetY);
        if (city && city.owner !== unit.owner) {
            // Check if we can actually capture (kill all defenders)
            if (damage >= enemy.hp) {
                const remaining = this.map.getUnitsAt(targetX, targetY).filter(u => u.owner !== unit.owner && u.hp > 0);
                if (remaining.length <= 1) {
                    score += 50; // Capture bonus
                }
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

        // Focus fire coordination: bonus if other units are targeting this enemy
        const enemyKey = `${targetX},${targetY}`;
        const focusCount = this.focusFireMemory.get(enemyKey) || 0;
        if (focusCount > 0) {
            score += 15; // Bonus for focusing fire
        }

        // Record that we're considering attacking this target
        this.focusFireMemory.set(enemyKey, focusCount + 1);

        return score;
    }

    /**
     * Find the best strategic move when no immediate attacks available
     */
    findBestMoveTarget(unit, validMoves, player, isRangedUnit) {
        if (validMoves.length === 0) return null;

        const def = UNIT_DEFINITIONS[unit.type];
        const isFastUnit = def.movement >= 4;

        const scoredMoves = validMoves.map(tile => {
            let score = this.evaluateStrategicMove(unit, tile.x, tile.y, player, isRangedUnit, isFastUnit);
            // Prefer closer moves (less wasted movement)
            score -= tile.cost * 1.5;
            return { ...tile, score };
        });

        scoredMoves.sort((a, b) => b.score - a.score);
        return scoredMoves[0];
    }

    /**
     * Find the best strategic target for a unit based on priority:
     * 1. Neutral empty cities (easiest to capture, expand territory)
     * 2. Enemy empty cities (weaken opponent)
     * 3. Ruins (one-time bonus)
     * 4. Enemy defended cities (conquest)
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

        // 4. ENEMY DEFENDED CITIES - fourth priority (if we can win)
        for (const city of this.map.cities) {
            if (city.owner === null || city.owner === player.id) continue;

            const dist = Utils.manhattanDistance(startX, startY, city.x, city.y);
            if (dist > maxDistance) continue;

            const defenders = this.map.getUnitsAt(city.x, city.y).filter(u => u.owner !== player.id && u.hp > 0);

            if (defenders.length > 0) {
                const defenseStrength = defenders.reduce((sum, d) => sum + d.effectiveDefense + d.hp, 0);
                const ourStrength = unit.effectiveAttack + unit.hp;

                if (ourStrength > defenseStrength * 0.8) {
                    let score = 400 - dist * 6;
                    if (score > bestScore) {
                        bestScore = score;
                        bestTarget = { type: 'enemy_defended_city', x: city.x, y: city.y, city, defenders, priority: 4, distance: dist };
                    }
                }
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
    evaluateStrategicMove(unit, x, y, player, isRangedUnit, isFastUnit) {
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
        // Find target from current position and from potential new position
        const priorityTargetFromCurrent = this.findPriorityTarget(unit, player);
        const priorityTargetFromNew = this.findPriorityTarget(unit, player, x, y);

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

            // Additional bonus if we're moving toward the best target from new position
            if (priorityTargetFromNew &&
                priorityTargetFromNew.x === priorityTargetFromCurrent.x &&
                priorityTargetFromNew.y === priorityTargetFromCurrent.y) {
                // We're still targeting the same city from new position - good
                score += 20;
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
                // Defended city - check odds
                const defenseStrength = defenders.reduce((sum, d) => sum + d.hp + d.effectiveDefense, 0);
                const ourStrength = unit.hp + unit.effectiveAttack;
                if (ourStrength > defenseStrength * 1.2) {
                    score += 80;
                } else if (ourStrength > defenseStrength * 0.8) {
                    score += 40;
                } else {
                    score -= 40;
                }
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

        // 7. EXPLORATION: All units can explore ruins now
        const nearbyRuin = this.map.getRuin(x, y);
        if (nearbyRuin) {
            // Higher bonus for units already on ruin tile
            score += 70;
        }

        // 8. FRONT LINE CONSTRUCTION: Bonus for being near front line
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
            // If we're moving toward a city, check if current position has something valuable

            // Opportunity: Ruin on current tile
            const ruinHere = this.map.getRuin(x, y);
            if (ruinHere) {
                score += 85; // High bonus - same as direct ruin bonus
            }

            // Opportunity: Empty neutral city on current tile (different from our main target)
            const cityHere = this.map.getCity(x, y);
            if (cityHere && cityHere.owner === null) {
                const defendersHere = this.map.getUnitsAt(cityHere.x, cityHere.y).filter(u => u.hp > 0);
                if (defendersHere.length === 0) {
                    score += 120; // Good bonus for capturing any neutral city
                }
            }

            // Opportunity: Enemy unit we can attack from here
            if (!unit.hasAttacked) {
                const enemyHere = this.map.getUnitsAt(x, y).find(u => u.owner !== player.id && u.hp > 0);
                if (enemyHere) {
                    // Calculate if we can win
                    const myDamage = CombatSystem.calculateDamage(unit, enemyHere, 0).damage;
                    const enemyDamage = CombatSystem.calculateDamage(enemyHere, unit, this.map.getDefenseBonus(x, y)).damage;

                    if (myDamage >= enemyHere.hp) {
                        // We can kill them - great opportunity!
                        score += 90;
                    } else if (myDamage > enemyDamage) {
                        // Favorable trade
                        score += 50;
                    } else if (!unit.isHero && unit.hp > enemyDamage * 2) {
                        // We can survive even if trade is not great
                        score += 25;
                    }
                }
            }

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
     * Prioritize units for action order (stronger units first)
     * @deprecated Use prioritizeUnitForAction instead
     */
    prioritizeUnit(unit) {
        const def = UNIT_DEFINITIONS[unit.type];
        return def.attack + def.defense + def.hp / 10;
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
                            this.game.performAttack(hero, enemyStack, isRanged);
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
                    this.game.moveUnit(hero, blockadedCity.x, blockadedCity.y);
                    await this.delay(300);

                    // Attack immediately after moving in
                    const adjacentEnemies = this.getAdjacentEnemies(blockadedCity.x, blockadedCity.y, player);
                    if (adjacentEnemies.length > 0 && !hero.hasAttacked) {
                        const enemyStack = this.map.getStack(adjacentEnemies[0].x, adjacentEnemies[0].y);
                        if (enemyStack) {
                            this.game.performAttack(hero, enemyStack, false);
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
                    this.game.moveUnit(hero, moveToward.x, moveToward.y);
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
                    const priorityTarget = this.findPriorityTarget(hero, player);
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
                    this.game.moveUnit(hero, bestOpportunity.tile.x, bestOpportunity.tile.y);
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
            this.game.moveUnit(hero, neutralCityTile.x, neutralCityTile.y);
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
            this.game.moveUnit(hero, enemyCityTile.x, enemyCityTile.y);
            await this.delay(300);
            return;
        }

        // Priority 3: Explore ruins (if safe)
        const ruin = safeMoves.find(t => this.map.getRuin(t.x, t.y));
        if (ruin) {
            this.game.moveUnit(hero, ruin.x, ruin.y);
            await this.delay(300);
            return;
        }

        // Priority 4: Stay near friendly units for protection
        const supportiveMove = this.findSupportivePosition(hero, safeMoves, player);
        if (supportiveMove) {
            this.game.moveUnit(hero, supportiveMove.x, supportiveMove.y);
            await this.delay(300);
            return;
        }

        // Priority 5: Strategic move (only if safe)
        if (safeMoves.length > 0) {
            const moveTarget = this.findBestMoveTarget(hero, safeMoves, player, false);
            if (moveTarget) {
                this.game.moveUnit(hero, moveTarget.x, moveTarget.y);
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
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
