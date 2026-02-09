import { CITY_INCOME, UNIT_DEFINITIONS } from '../constants.js';
import { Events } from '../utils.js';

export class City {
    constructor(x, y, size = 'small', owner = null) {
        this.id = `city_${x}_${y}_${Date.now()}`;
        this.x = x;
        this.y = y;
        this.size = size;
        this.owner = owner;
        this.income = CITY_INCOME[size];
        this.productionQueue = [];
    }

    getProductionOptions() {
        return Object.entries(UNIT_DEFINITIONS)
            .filter(([key]) => key !== 'HERO')
            .map(([key, def]) => ({ type: key, ...def }));
    }

    changeOwner(newOwner) {
        const oldOwner = this.owner;
        this.owner = newOwner;
        Events.emit('city:captured', { city: this, oldOwner, newOwner });
    }

    serialize() {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            size: this.size,
            owner: this.owner
        };
    }
}
