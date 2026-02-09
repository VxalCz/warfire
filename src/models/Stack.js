import { Utils, Events } from '../utils.js';

export class Stack {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.units = [];
    }

    add(unit) {
        Utils.assert(unit.x === this.x && unit.y === this.y, 'Unit position mismatch');
        this.units.push(unit);
    }

    remove(unit) {
        const idx = this.units.indexOf(unit);
        if (idx > -1) this.units.splice(idx, 1);
    }

    getCombatUnit() {
        return this.units
            .filter(u => u.hp > 0)
            .sort((a, b) => (b.effectiveAttack + b.effectiveDefense + b.hp) - (a.effectiveAttack + a.effectiveDefense + a.hp))[0] || null;
    }

    get owner() {
        return this.units[0]?.owner ?? null;
    }

    split(unitIds, newX, newY) {
        const splitUnits = this.units.filter(u => unitIds.includes(u.id));
        const remaining = this.units.filter(u => !unitIds.includes(u.id));

        splitUnits.forEach(u => { u.x = newX; u.y = newY; });
        this.units = remaining;

        Events.emit('stack:split', { original: this, splitUnits, newX, newY });
        return splitUnits;
    }

    static fromUnits(units, x, y) {
        const stack = new Stack(x, y);
        units.forEach(u => stack.add(u));
        return stack;
    }
}
