import { Utils, Events } from '../utils.js';
import { UNIT_DEFINITIONS, TERRAIN, CITY_INCOME } from '../constants.js';

/**
 * Strategic planner for AI - generates high-level plans each turn
 * Coordinates unit actions under common objectives instead of independent decisions
 */
export class StrategyPlanner {
    constructor(game) {
        this.game = game;
        this.map = game.map;
        this.players = game.players;
    }

    /**
     * Generate a strategic plan for the player this turn
     * @returns {{ phase, objectives, assignments, productionPlan }}
     */
    generatePlan(player) {
        const phase = this.assessGamePhase(player);
        const objectives = this.identifyObjectives(player, phase);
        const assignments = this.assignUnitsToObjectives(player, objectives);
        const productionPlan = this.planProduction(player, phase, objectives);

        return { phase, objectives, assignments, productionPlan };
    }

    // ─── Game Phase Assessment ─────────────────────────────────────

    assessGamePhase(player) {
        const turn = this.game.state.turnNumber || 1;
        const cities = player.cities.length;
        const totalCities = this.map.cities.length;
        const ownedRatio = totalCities > 0 ? cities / totalCities : 0;
        const aliveEnemies = this.players.filter(p => p.id !== player.id && p.isAlive).length;

        if (turn <= 5 || cities <= 1) return 'EARLY';
        if (ownedRatio >= 0.5 || aliveEnemies <= 1 || turn >= 25) return 'LATE';
        return 'MID';
    }

    // ─── Objective Identification ───────────────────────────────────

    /**
     * Identify strategic objectives for this turn
     * @returns {Array<{ type, x, y, priority, requiredUnits }>}
     */
    identifyObjectives(player, phase) {
        const objectives = [];

        // CRITICAL: Defend blockaded cities
        for (const city of player.cities) {
            if (this.map.isCityBlockaded(city, player.id)) {
                objectives.push({
                    type: 'DEFEND_CITY',
                    x: city.x,
                    y: city.y,
                    priority: 100,
                    city,
                    requiredUnits: 2
                });
            }
        }

        // HIGH: Threatened cities (enemy adjacent)
        for (const city of player.cities) {
            if (this.map.isCityBlockaded(city, player.id)) continue; // Already handled
            const hasEnemyAdj = this.hasEnemyAdjacent(city.x, city.y, player);
            if (hasEnemyAdj) {
                objectives.push({
                    type: 'DEFEND_CITY',
                    x: city.x,
                    y: city.y,
                    priority: 70,
                    city,
                    requiredUnits: 1
                });
            }
        }

        // PREVENTIVE: Keep a garrison in exposed cities that are not under attack yet,
        // so captured cities are not left empty for the enemy to walk back into
        for (const city of player.cities) {
            if (this.map.isCityBlockaded(city, player.id)) continue;
            if (this.hasEnemyAdjacent(city.x, city.y, player)) continue; // Already covered above

            const hasGarrison = this.map.getUnitsAt(city.x, city.y)
                .some(u => u.owner === player.id && u.hp > 0);
            if (hasGarrison) continue;

            const enemyDist = this.nearestEnemyDistance(city.x, city.y, player);
            if (enemyDist > 12) continue; // Deep rear cities don't need a garrison

            objectives.push({
                type: 'DEFEND_CITY',
                x: city.x,
                y: city.y,
                priority: enemyDist <= 6 ? 55 : 40,
                city,
                requiredUnits: 1
            });
        }

        // Capture neutral cities
        for (const city of this.map.cities) {
            if (city.owner !== null) continue;
            const defenders = this.map.getUnitsAt(city.x, city.y).filter(u => u.hp > 0);
            if (defenders.length === 0) {
                const priority = phase === 'EARLY' ? 80 : phase === 'MID' ? 50 : 40;
                objectives.push({
                    type: 'CAPTURE_CITY',
                    x: city.x,
                    y: city.y,
                    priority,
                    city,
                    requiredUnits: 1
                });
            } else {
                // Neutral city with defenders — need combat units
                objectives.push({
                    type: 'CAPTURE_CITY',
                    x: city.x,
                    y: city.y,
                    priority: phase === 'EARLY' ? 60 : 45,
                    city,
                    requiredUnits: Math.min(defenders.length + 1, 3)
                });
            }
        }

        // Capture enemy cities
        for (const city of this.map.cities) {
            if (city.owner === null || city.owner === player.id) continue;
            const defenders = this.map.getUnitsAt(city.x, city.y).filter(u => u.owner !== player.id && u.hp > 0);
            const enemyPlayer = this.players[city.owner];

            if (defenders.length === 0) {
                // Empty enemy city — easy pick
                const isLastCity = enemyPlayer && enemyPlayer.isAlive && enemyPlayer.cities.length <= 1;
                const priority = isLastCity ? 95 : (phase === 'LATE' ? 70 : 55);
                objectives.push({
                    type: 'CAPTURE_CITY',
                    x: city.x,
                    y: city.y,
                    priority,
                    city,
                    requiredUnits: 1
                });
            } else {
                // Defended enemy city — need coordinated attack
                const isLastCity = enemyPlayer && enemyPlayer.isAlive && enemyPlayer.cities.length <= 1;
                const basePriority = isLastCity ? 85 : (phase === 'LATE' ? 55 : 40);
                objectives.push({
                    type: 'CAPTURE_CITY',
                    x: city.x,
                    y: city.y,
                    priority: basePriority,
                    city,
                    defenders,
                    requiredUnits: Math.min(defenders.length + 1, 4)
                });
            }
        }

        // Explore ruins (only if nearby and no higher priority)
        for (const ruin of this.map.ruins) {
            // Check if ruin is already claimed or has an enemy on it
            const unitsOnRuin = this.map.getUnitsAt(ruin.x, ruin.y);
            const friendlyOnRuin = unitsOnRuin.find(u => u.owner === player.id && u.hp > 0);
            if (friendlyOnRuin) continue; // Already there

            objectives.push({
                type: 'EXPLORE_RUIN',
                x: ruin.x,
                y: ruin.y,
                priority: phase === 'EARLY' ? 45 : 30,
                ruin,
                requiredUnits: 1
            });
        }

        // Attack enemy army groups (front line engagements)
        const enemyGroups = this.findEnemyClusters(player);
        for (const group of enemyGroups) {
            // Only engage if we have nearby units
            const nearbyFriendlies = this.countNearbyUnits(group.x, group.y, player, 4);
            if (nearbyFriendlies >= group.count) {
                objectives.push({
                    type: 'ATTACK_ARMY',
                    x: group.x,
                    y: group.y,
                    priority: phase === 'LATE' ? 50 : 35,
                    requiredUnits: Math.min(group.count + 1, 3)
                });
            }
        }

        // Sort by priority descending
        objectives.sort((a, b) => b.priority - a.priority);
        return objectives;
    }

    // ─── Unit Assignment ───────────────────────────────────────────

    /**
     * Assign each unit to its best objective using greedy matching
     * @returns {Map<unitId, { objective, role }>}
     */
    assignUnitsToObjectives(player, objectives) {
        const assignments = new Map();
        const availableUnits = player.units.filter(u => u.hp > 0 && !u.isHero);

        // Track how many units assigned to each objective
        const objectiveAssignments = objectives.map(obj => ({
            ...obj,
            assignedCount: 0,
            assignedUnits: []
        }));

        for (const unit of availableUnits) {
            let bestObj = null;
            let bestScore = -Infinity;

            for (const obj of objectiveAssignments) {
                // Skip if objective already has enough units
                if (obj.assignedCount >= obj.requiredUnits) continue;

                const dist = Utils.manhattanDistance(unit.x, unit.y, obj.x, obj.y);
                const reachability = dist <= (UNIT_DEFINITIONS[unit.type].movement * 3) ? 1 : 0.5;

                // Base score: objective priority
                let score = obj.priority;

                // Distance penalty — closer is better
                score -= dist * 3;

                // Unit type suitability
                score += this.unitObjectiveFit(unit, obj) * 10;

                // Reachability multiplier
                score *= reachability;

                // Role bonus: if already some units assigned, prefer complementary roles
                if (obj.assignedUnits.length > 0) {
                    const hasMelee = obj.assignedUnits.some(u => UNIT_DEFINITIONS[u.type].range === 1);
                    const hasRanged = obj.assignedUnits.some(u => UNIT_DEFINITIONS[u.type].range > 1);
                    const unitIsRanged = UNIT_DEFINITIONS[unit.type].range > 1;

                    // Mixed composition is better
                    if (!hasRanged && unitIsRanged) score += 15;
                    if (!hasMelee && !unitIsRanged) score += 15;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestObj = obj;
                }
            }

            if (bestObj) {
                bestObj.assignedCount++;
                bestObj.assignedUnits.push(unit);
                assignments.set(unit.id, {
                    objective: bestObj,
                    role: this.determineRole(unit, bestObj)
                });
            }
        }

        return assignments;
    }

    /**
     * How well a unit type fits an objective
     */
    unitObjectiveFit(unit, objective) {
        const def = UNIT_DEFINITIONS[unit.type];

        switch (objective.type) {
            case 'DEFEND_CITY':
                // Prefer tanks for defense
                return (def.defense / 4) + (def.hp / 40);

            case 'CAPTURE_CITY': {
                const defenders = objective.defenders || objective.city
                    ? this.map.getUnitsAt(objective.x, objective.y).filter(u => u.owner !== unit.owner && u.hp > 0).length
                    : 0;
                if (defenders > 0) {
                    // Need combat strength
                    return (def.attack / 5) + (def.hp / 40);
                }
                // Empty city — any unit works, faster is better
                return def.movement / 4;
            }

            case 'EXPLORE_RUIN':
                return def.movement / 4; // Faster units explore better

            case 'ATTACK_ARMY':
                return (def.attack / 5) + (def.range > 1 ? 0.5 : 0);

            default:
                return 0.5;
        }
    }

    /**
     * Determine the role of a unit within its objective
     */
    determineRole(unit, objective) {
        const def = UNIT_DEFINITIONS[unit.type];

        if (objective.type === 'DEFEND_CITY') {
            if (def.range > 1) return 'RANGED_SUPPORT';
            return 'DEFENDER';
        }
        if (def.range > 1) return 'RANGED_ATTACK';
        if (def.movement >= 4) return 'FLANKER';
        return 'ATTACKER';
    }

    // ─── Production Planning ────────────────────────────────────────

    /**
     * Plan what each city should produce
     * @returns {Map<cityId, unitType>}
     */
    planProduction(player, phase, objectives) {
        const plan = new Map();
        let remainingGold = player.gold;

        // Analyze current army composition
        const composition = this.analyzeArmyComposition(player);
        let totalUnits = Object.values(composition).reduce((s, c) => s + c, 0);

        // Front-line cities get gold first - plan them in urgency order and
        // spend from a shared budget so cities don't each plan against full gold
        const cityQueue = player.cities
            .filter(city => !this.map.isCityBlockaded(city, player.id))
            .map(city => {
                const context = this.assessCityContext(city, player, phase);
                return { city, context, urgency: this.cityProductionUrgency(context) };
            })
            .sort((a, b) => b.urgency - a.urgency);

        for (const { city, context } of cityQueue) {
            if (remainingGold < 10) break;

            // Find relevant objectives near this city
            const nearbyObjectives = objectives.filter(obj => {
                const dist = Utils.manhattanDistance(city.x, city.y, obj.x, obj.y);
                return dist <= 8;
            });

            const unitType = this.decideProductionForCity(
                player, city, phase, composition, totalUnits,
                context, nearbyObjectives, remainingGold
            );

            if (unitType) {
                plan.set(city.id, unitType);
                remainingGold -= UNIT_DEFINITIONS[unitType].cost;
                // Count the planned unit so the next city fills a different gap
                composition[unitType] = (composition[unitType] || 0) + 1;
                totalUnits++;
            }
        }

        return plan;
    }

    /**
     * How urgently a city needs its production - used to order budget allocation
     */
    cityProductionUrgency(context) {
        let urgency = 0;
        if (context.isUnderThreat) urgency += 100;
        if (context.isFrontLine) urgency += 50;
        // Closer to enemy territory = higher urgency (units reach the action sooner)
        urgency -= Math.min(context.nearestEnemyCityDist, 30);
        return urgency;
    }

    /**
     * Assess the strategic context around a city
     */
    assessCityContext(city, player, phase) {
        let nearestEnemyDist = Infinity;
        let nearestEnemyCityDist = Infinity;
        let enemyUnitsNearby = 0;
        let friendlyUnitsNearby = 0;

        for (const unit of this.map.units) {
            const dist = Utils.manhattanDistance(city.x, city.y, unit.x, unit.y);
            if (unit.owner !== player.id && unit.hp > 0) {
                nearestEnemyDist = Math.min(nearestEnemyDist, dist);
                if (dist <= 3) enemyUnitsNearby++;
            }
            if (unit.owner === player.id && unit.hp > 0 && dist <= 3) {
                friendlyUnitsNearby++;
            }
        }

        for (const otherCity of this.map.cities) {
            if (otherCity.owner !== null && otherCity.owner !== player.id) {
                const dist = Utils.manhattanDistance(city.x, city.y, otherCity.x, otherCity.y);
                nearestEnemyCityDist = Math.min(nearestEnemyCityDist, dist);
            }
        }

        const isFrontLine = nearestEnemyDist <= 5;
        const isUnderThreat = nearestEnemyDist <= 3;

        return {
            isFrontLine,
            isUnderThreat,
            nearestEnemyDist,
            nearestEnemyCityDist,
            enemyUnitsNearby,
            friendlyUnitsNearby,
            militaryBalance: friendlyUnitsNearby - enemyUnitsNearby
        };
    }

    /**
     * Decide what unit to produce for a specific city
     */
    decideProductionForCity(player, city, phase, composition, totalUnits, context, nearbyObjectives, gold) {
        // Need at least 10 gold to produce anything
        if (gold < 10) return null;

        // Priority: hero if we don't have one
        if (!player.getHero() && gold >= 50) return 'HERO';

        const { isUnderThreat, isFrontLine, militaryBalance } = context;

        // Under threat: produce defensive units fast
        if (isUnderThreat && militaryBalance < 1) {
            if (gold >= 20) return 'HEAVY_INFANTRY'; // Best defense for cost
            if (gold >= 10) return 'LIGHT_INFANTRY';
        }

        // Front line city: balanced with defense bias
        if (isFrontLine) {
            // Need ranged support at the front?
            const rangedRatio = (composition.ARCHER || 0) + (composition.CATAPULT || 0);
            if (rangedRatio < totalUnits * 0.2 && gold >= 15) return 'ARCHER';

            // Need tanks?
            const heavyRatio = (composition.HEAVY_INFANTRY || 0);
            if (heavyRatio < totalUnits * 0.25 && gold >= 20) return 'HEAVY_INFANTRY';

            // Default front line: heavy infantry
            if (gold >= 20) return 'HEAVY_INFANTRY';
            if (gold >= 10) return 'LIGHT_INFANTRY';
        }

        // Back line city: produce based on phase and army needs
        switch (phase) {
            case 'EARLY': {
                // Early game: fast expansion units
                // Check for nearby neutral cities to capture
                const captureObjectives = nearbyObjectives.filter(o => o.type === 'CAPTURE_CITY' && o.priority >= 50);
                if (captureObjectives.length > 0 && gold >= 30) return 'CAVALRY'; // Fast capture
                if (gold >= 15) return 'ARCHER'; // Cheap ranged support
                if (gold >= 10) return 'LIGHT_INFANTRY';
                return null;
            }

            case 'MID': {
                // Mid game: balanced army composition
                // Ensure we have ranged support
                const rangedPercent = totalUnits > 0
                    ? ((composition.ARCHER || 0) + (composition.CATAPULT || 0)) / totalUnits
                    : 0;
                if (rangedPercent < 0.2 && gold >= 15) return 'ARCHER';

                // Ensure we have cavalry for flanking
                const cavPercent = totalUnits > 0 ? (composition.CAVALRY || 0) / totalUnits : 0;
                if (cavPercent < 0.15 && gold >= 30) return 'CAVALRY';

                // Ensure heavy infantry backbone
                const heavyPercent = totalUnits > 0 ? (composition.HEAVY_INFANTRY || 0) / totalUnits : 0;
                if (heavyPercent < 0.25 && gold >= 20) return 'HEAVY_INFANTRY';

                // Default mid: heavy infantry for solid front
                if (gold >= 20) return 'HEAVY_INFANTRY';
                if (gold >= 15) return 'ARCHER';
                if (gold >= 10) return 'LIGHT_INFANTRY';
                return null;
            }

            case 'LATE': {
                // Late game: powerful units to close the game
                if (gold >= 100 && (composition.DRAGON || 0) < 2) return 'DRAGON';
                if (gold >= 40 && (composition.CATAPULT || 0) < totalUnits * 0.1) return 'CATAPULT';
                if (gold >= 30) return 'CAVALRY';
                if (gold >= 20) return 'HEAVY_INFANTRY';
                if (gold >= 15) return 'ARCHER';
                if (gold >= 10) return 'LIGHT_INFANTRY';
                return null;
            }
        }

        // Fallback
        if (gold >= 10) return 'LIGHT_INFANTRY';
        return null;
    }

    /**
     * Analyze the player's own army composition
     */
    analyzeArmyComposition(player) {
        const composition = {};
        for (const type of Object.keys(UNIT_DEFINITIONS)) {
            composition[type] = 0;
        }
        for (const unit of player.units) {
            if (unit.hp > 0) {
                composition[unit.type] = (composition[unit.type] || 0) + 1;
            }
        }
        return composition;
    }

    // ─── Helper Methods ────────────────────────────────────────────

    /**
     * Distance to the nearest enemy unit or enemy city
     */
    nearestEnemyDistance(x, y, player) {
        let min = Infinity;
        for (const unit of this.map.units) {
            if (unit.owner !== player.id && unit.hp > 0) {
                min = Math.min(min, Utils.manhattanDistance(x, y, unit.x, unit.y));
            }
        }
        for (const city of this.map.cities) {
            if (city.owner !== null && city.owner !== player.id) {
                min = Math.min(min, Utils.manhattanDistance(x, y, city.x, city.y));
            }
        }
        return min;
    }

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
     * Find clusters of enemy units
     */
    findEnemyClusters(player, radius = 2) {
        const clusters = [];
        const visited = new Set();

        for (const unit of this.map.units) {
            if (unit.owner === player.id || unit.hp <= 0 || visited.has(unit.id)) continue;

            const nearby = this.map.units.filter(u =>
                u.owner !== player.id && u.hp > 0 && !visited.has(u.id) &&
                Utils.chebyshevDistance(unit.x, unit.y, u.x, u.y) <= radius
            );

            if (nearby.length >= 2) {
                const cx = nearby.reduce((s, u) => s + u.x, 0) / nearby.length;
                const cy = nearby.reduce((s, u) => s + u.y, 0) / nearby.length;
                clusters.push({ x: Math.round(cx), y: Math.round(cy), count: nearby.length, units: nearby });
                for (const u of nearby) visited.add(u.id);
            }
        }

        return clusters;
    }

    /**
     * Count units near a position
     */
    countNearbyUnits(x, y, player, radius) {
        let count = 0;
        for (const unit of player.units) {
            if (unit.hp > 0 && Utils.manhattanDistance(x, y, unit.x, unit.y) <= radius) {
                count++;
            }
        }
        return count;
    }
}