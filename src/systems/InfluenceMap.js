import { Utils } from '../utils.js';
import { UNIT_DEFINITIONS, TERRAIN } from '../constants.js';

/**
 * Influence map for strategic positioning decisions
 * Computes friendly/enemy influence and threat levels across the map
 * Used by AISystem to make smarter movement and positioning choices
 */
export class InfluenceMap {
    constructor(gameMap, players) {
        this.map = gameMap;
        this.players = players;
        this.width = gameMap.width;
        this.height = gameMap.height;

        // Flat arrays for performance (width * height)
        this.friendlyInfluence = new Float32Array(this.width * this.height);
        this.enemyInfluence = new Float32Array(this.width * this.height);
        this.threatLevel = new Float32Array(this.width * this.height);

        this.lastUpdateKey = null;
    }

    /**
     * Recompute influence values across the map
     * Should be called once per AI turn
     */
    update(playerId, currentTurn) {
        // Skip only if already updated this turn for this exact player -
        // influence is perspective-dependent, each AI player needs its own pass
        const updateKey = `${currentTurn}:${playerId}`;
        if (updateKey === this.lastUpdateKey) return;
        this.lastUpdateKey = updateKey;

        // Reset
        this.friendlyInfluence.fill(0);
        this.enemyInfluence.fill(0);
        this.threatLevel.fill(0);

        // Add influence from units
        for (const unit of this.map.units) {
            if (unit.hp <= 0) continue;
            const isFriendly = unit.owner === playerId;
            const influence = isFriendly
                ? this.friendlyInfluence
                : this.enemyInfluence;
            const strength = this.unitStrength(unit);
            this.addInfluence(influence, unit.x, unit.y, strength, unit);
        }

        // Add influence from cities
        for (const city of this.map.cities) {
            const isFriendly = city.owner === playerId;
            const isNeutral = city.owner === null;
            const influence = isFriendly
                ? this.friendlyInfluence
                : this.enemyInfluence;

            // Cities project more influence than units
            const cityStrength = isFriendly ? 8 : (isNeutral ? 2 : 6);
            this.addInfluence(influence, city.x, city.y, cityStrength);
        }

        // Compute threat level = enemy influence - friendly influence
        for (let i = 0; i < this.threatLevel.length; i++) {
            this.threatLevel[i] = this.enemyInfluence[i] - this.friendlyInfluence[i];
        }
    }

    /**
     * Get threat level at a position (positive = danger, negative = safe)
     */
    getThreatLevel(x, y, playerId) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
        return this.threatLevel[y * this.width + x];
    }

    /**
     * Get friendly influence at a position
     */
    getFriendlyInfluence(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
        return this.friendlyInfluence[y * this.width + x];
    }

    /**
     * Get enemy influence at a position
     */
    getEnemyInfluence(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
        return this.enemyInfluence[y * this.width + x];
    }

    /**
     * Check if a position is safe (more friendly influence than enemy)
     */
    isSafe(x, y, threshold = 0) {
        return this.getThreatLevel(x, y) <= threshold;
    }

    /**
     * Find the nearest safe tile from a position
     * Used for retreat decisions
     */
    findNearestSafeTile(x, y, maxDist = 5) {
        let bestX = x, bestY = y;
        let bestScore = this.getThreatLevel(x, y);
        let bestDist = 0;

        for (let dy = -maxDist; dy <= maxDist; dy++) {
            for (let dx = -maxDist; dx <= maxDist; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
                if (this.map.getTerrain(nx, ny) === TERRAIN.WATER) continue;

                const dist = Math.abs(dx) + Math.abs(dy);
                const threat = this.getThreatLevel(nx, ny);
                const friendly = this.getFriendlyInfluence(nx, ny);

                // Lower threat is better, higher friendly is better, closer is better
                const score = -threat * 3 + friendly * 2 - dist * 0.5;

                if (dist === 0) continue; // Current position handled separately

                if (score > bestScore || (dist === 0 && threat < bestScore)) {
                    bestScore = score;
                    bestX = nx;
                    bestY = ny;
                    bestDist = dist;
                }
            }
        }

        return { x: bestX, y: bestY, threatLevel: this.getThreatLevel(bestX, bestY), distance: bestDist };
    }

    // ─── Private Methods ────────────────────────────────────────

    /**
     * Compute a unit's influence strength
     */
    unitStrength(unit) {
        const def = UNIT_DEFINITIONS[unit.type];
        if (!def) return 3;
        // Stronger units project more influence
        return (def.attack + def.defense + def.hp / 10) / 5;
    }

    /**
     * Add influence from a source at (x, y) to the influence map
     * Uses a simple radius-based falloff
     */
    addInfluence(influenceMap, sourceX, sourceY, strength, unit = null) {
        // Range of influence: melee units project 3 tiles, ranged 4, fast units project wider
        let range = 3;
        if (unit) {
            const def = UNIT_DEFINITIONS[unit.type];
            if (def) {
                range = Math.max(3, def.range + 1);
                if (def.movement >= 5) range = Math.max(range, 4); // Fast units project wider
            }
        }

        const minX = Math.max(0, sourceX - range);
        const maxX = Math.min(this.width - 1, sourceX + range);
        const minY = Math.max(0, sourceY - range);
        const maxY = Math.min(this.height - 1, sourceY + range);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dist = Utils.chebyshevDistance(sourceX, sourceY, x, y);
                if (dist > range) continue;

                // Influence falls off with distance
                const falloff = 1 / (1 + dist * 0.5);
                influenceMap[y * this.width + x] += strength * falloff;
            }
        }
    }
}