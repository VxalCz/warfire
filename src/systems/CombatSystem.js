import { Utils, Events } from '../utils.js';

export class CombatSystem {
    static calculateDamage(attacker, defender, terrainBonus = 0) {
        const rawDamage = attacker.effectiveAttack - (defender.effectiveDefense + terrainBonus);
        return Math.max(1, rawDamage);
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
        const damageToDefender = this.calculateDamage(attacker, defender, terrainBonus);

        const results = {
            attacker: { unit: attacker, damageDealt: damageToDefender, died: false },
            defender: { unit: defender, damageDealt: 0, died: false },
            cityCaptured: null
        };

        // Defender takes damage
        results.defender.died = defender.takeDamage(damageToDefender);
        if (results.defender.died) {
            gameMap.removeUnit(defender);
        }

        // Mark attacker as having attacked
        attacker.hasMoved = true;
        attacker.hasAttacked = true;

        // Check city capture
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
