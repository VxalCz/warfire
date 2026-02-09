import { CONFIG, COLORS } from '../constants.js';
import { Events } from '../utils.js';

export class Player {
    constructor(id, color, name, isAI = false) {
        this.id = id;
        this.color = color;
        this.name = name;
        this.isAI = isAI;
        this.gold = CONFIG.STARTING_GOLD;
        this.units = [];
        this.cities = [];
        this.isAlive = true;
        this.defeatedAt = null;
    }

    addGold(amount) {
        this.gold += amount;
        Events.emit('player:goldChanged', { player: this, amount, total: this.gold });
    }

    spendGold(amount) {
        if (this.gold < amount) return false;
        this.gold -= amount;
        Events.emit('player:goldChanged', { player: this, amount: -amount, total: this.gold });
        return true;
    }

    defeat() {
        this.isAlive = false;
        this.defeatedAt = Date.now();
        Events.emit('player:defeated', { player: this });
    }

    getHero() {
        return this.units.find(u => u.isHero && u.hp > 0);
    }

    serialize() {
        return {
            id: this.id,
            name: this.name,
            gold: this.gold,
            isAlive: this.isAlive,
            units: this.units.map(u => u.serialize()),
            cities: this.cities.map(c => c.serialize())
        };
    }
}
