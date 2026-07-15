import { Utils, Events } from '../utils.js';

/**
 * Combat type advantages matrix (attacker vs defender)
 * Values > 1 = advantage, < 1 = disadvantage
 */
const TYPE_ADVANTAGES = {
    'Light Infantry': { 'Archer': 1.4, 'Catapult': 1.3, 'Dragon': 0.7 },
    'Heavy Infantry': { 'Cavalry': 1.4, 'Light Infantry': 1.2, 'Catapult': 1.2, 'Archer': 0.9 },
    'Cavalry': { 'Archer': 1.6, 'Catapult': 1.4, 'Light Infantry': 1.3, 'Heavy Infantry': 0.7, 'Dragon': 0.6 },
    'Archer': { 'Light Infantry': 1.3, 'Heavy Infantry': 1.2, 'Dragon': 1.2, 'Cavalry': 0.6, 'Catapult': 0.8 },
    'Catapult': { 'Heavy Infantry': 1.5, 'Light Infantry': 1.4, 'Cavalry': 1.3, 'Archer': 1.2, 'Dragon': 0.8 },
    'Dragon': { 'Cavalry': 1.5, 'Heavy Infantry': 1.4, 'Light Infantry': 1.3, 'Archer': 1.3, 'Catapult': 1.6 },
    'Hero': { 'Cavalry': 1.3, 'Dragon': 1.2, 'Archer': 1.2, 'Catapult': 1.3 }
};

export class CombatSystem {
    /**
     * Calculate damage with randomization, critical hits, and type advantages
     * @returns {Object} { damage: number, isCritical: boolean, typeMultiplier: number }
     */
    static calculateDamage(attacker, defender, terrainBonus = 0) {
        const baseAttack = attacker.effectiveAttack;
        const baseDefense = defender.effectiveDefense + terrainBonus;

        // Type advantage multiplier
        const typeMultiplier = this.getTypeAdvantage(attacker.typeName, defender.typeName);

        // BLOODY DAMAGE FORMULA - attacks are DEADLY
        // Base: attack * 2 vs defense - offense dominates
        let rawDamage = (baseAttack * 2 - baseDefense * 0.5) * typeMultiplier;

        // Minimum base damage ensures attacks always hurt significantly
        // At least 15% of max HP (3-8 damage for most units)
        const minBaseDamage = Math.floor(defender.maxHp * 0.15);
        rawDamage = Math.max(minBaseDamage, rawDamage);

        // Randomization: 80% - 120% (variance without too much randomness)
        const randomFactor = 0.8 + Math.random() * 0.4;
        let damage = rawDamage * randomFactor;

        // Critical hits: 20% chance for double damage
        let critChance = 0.20;
        if (typeMultiplier > 1.2) critChance += 0.10; // +10% with advantage
        if (typeMultiplier < 0.9) critChance -= 0.10; // -10% with disadvantage

        const isCritical = Math.random() < critChance;
        if (isCritical) {
            damage *= 2.0; // DOUBLE damage on crit
        }

        // Final damage - no upper cap, can one-shot
        damage = Math.floor(damage);

        return {
            damage,
            isCritical,
            typeMultiplier,
            rawDamage: Math.floor(rawDamage)
        };
    }

    static getTypeAdvantage(attackerType, defenderType) {
        if (!attackerType || !defenderType) return 1.0;
        const advantages = TYPE_ADVANTAGES[attackerType];
        if (!advantages) return 1.0;
        return advantages[defenderType] || 1.0;
    }

    static canAttack(attacker, defenderX, defenderY, gameMap) {
        // Use Chebyshev distance for attacks (allows diagonal attacks)
        const distance = Utils.chebyshevDistance(attacker.x, attacker.y, defenderX, defenderY);
        return distance <= attacker.range && !attacker.hasAttacked;
    }

    static performAttack(attacker, defenderStack, gameMap) {
        const defender = defenderStack.getCombatUnit();
        if (!defender) return null;

        const terrainBonus = gameMap.getDefenseBonus(defender.x, defender.y);
        const attackResult = this.calculateDamage(attacker, defender, terrainBonus);

        const results = {
            attacker: {
                unit: attacker,
                damageDealt: attackResult.damage,
                damageInfo: attackResult,
                died: false
            },
            defender: {
                unit: defender,
                damageDealt: 0,
                damageInfo: null,
                died: false
            },
            cityCaptured: null
        };

        // Defender takes damage
        results.defender.died = defender.takeDamage(attackResult.damage);

        // Remove dead units
        if (results.defender.died) {
            gameMap.removeUnit(defender);
        }

        // Mark attacker as having attacked (even if they died from counter)
        attacker.hasMoved = true;
        attacker.hasAttacked = true;

        // Check city capture (only if attacker survived)
        const city = gameMap.getCity(defender.x, defender.y);
        if (city && results.defender.died && !results.attacker.died) {
            const remaining = gameMap.getUnitsAt(city.x, city.y).filter(u => u.owner !== attacker.owner && u.hp > 0);
            if (remaining.length === 0) {
                results.cityCaptured = city;
            }
        }

        Events.emit('combat:resolved', results);
        return results;
    }
}
