import { CONFIG, TERRAIN, TERRAIN_DEFENSE, UNIT_DEFINITIONS, ARTIFACTS } from '../constants.js';
import { Utils, Events } from '../utils.js';
import { City } from '../models/City.js';
import { Stack } from '../models/Stack.js';

export class GameMap {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.terrain = [];
        this.cities = [];
        this.ruins = [];
        this.units = [];
        this.generate();
    }

    generate() {
        for (let y = 0; y < this.height; y++) {
            this.terrain[y] = [];
            for (let x = 0; x < this.width; x++) {
                this.terrain[y][x] = TERRAIN.PLAINS;
            }
        }
        this.addPatches(TERRAIN.FOREST, 0.2);
        this.addPatches(TERRAIN.MOUNTAINS, 0.15);
        this.addPatches(TERRAIN.WATER, 0.05);
    }

    addPatches(type, ratio) {
        const target = Math.floor(this.width * this.height * ratio);
        let placed = 0;
        while (placed < target) {
            const x = Utils.randomInt(0, this.width - 1);
            const y = Utils.randomInt(0, this.height - 1);
            if (this.terrain[y][x] === TERRAIN.PLAINS) {
                this.terrain[y][x] = type;
                placed++;
                this.getNeighbors(x, y).forEach(n => {
                    if (Math.random() < 0.5 && placed < target && this.terrain[n.y][n.x] === TERRAIN.PLAINS) {
                        this.terrain[n.y][n.x] = type;
                        placed++;
                    }
                });
            }
        }
    }

    getNeighbors(x, y) {
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        return dirs.map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
            .filter(p => this.isValid(p.x, p.y));
    }

    isValid(x, y) {
        return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }

    getTerrain(x, y) {
        return this.isValid(x, y) ? this.terrain[y][x] : null;
    }

    getDefenseBonus(x, y) {
        return TERRAIN_DEFENSE[this.getTerrain(x, y)] || 0;
    }

    getMovementCost(x, y, unitType) {
        const terrain = this.getTerrain(x, y);
        const def = UNIT_DEFINITIONS[unitType];
        if (!def.canEnter.includes(terrain)) return Infinity;
        return terrain === TERRAIN.MOUNTAINS ? 2 : 1;
    }

    getCity(x, y) {
        return this.cities.find(c => c.x === x && c.y === y);
    }

    getRuin(x, y) {
        return this.ruins.find(r => r.x === x && r.y === y && !r.explored);
    }

    getUnitsAt(x, y) {
        return this.units.filter(u => u.x === x && u.y === y && u.hp > 0);
    }

    getStack(x, y) {
        const units = this.getUnitsAt(x, y);
        return units.length > 0 ? Stack.fromUnits(units, x, y) : null;
    }

    moveUnit(unit, x, y) {
        Utils.assert(this.isValid(x, y), 'Invalid coordinates');
        unit.x = x;
        unit.y = y;
        unit.hasMoved = true;
        Events.emit('unit:moved', { unit, fromX: unit.x, fromY: unit.y, toX: x, toY: y });
    }

    removeUnit(unit) {
        const idx = this.units.indexOf(unit);
        if (idx > -1) {
            this.units.splice(idx, 1);
            Events.emit('unit:removed', { unit });
        }
    }

    addCity(city) {
        this.cities.push(city);
    }

    addRuin(x, y) {
        this.ruins.push({ x, y, explored: false });
    }

    exploreRuin(x, y) {
        const ruin = this.ruins.find(r => r.x === x && r.y === y);
        if (!ruin || ruin.explored) return null;
        ruin.explored = true;
        const keys = Object.keys(ARTIFACTS);
        const artifact = { ...ARTIFACTS[keys[Utils.randomInt(0, keys.length - 1)]] };
        Events.emit('ruin:explored', { x, y, artifact });
        return artifact;
    }

    healUnitsInCities() {
        this.cities.forEach(city => {
            if (city.owner === null) return;
            const units = this.getUnitsAt(city.x, city.y).filter(u => u.owner === city.owner);
            units.forEach(u => {
                const healed = u.heal(Math.floor(u.maxHp * 0.2));
                if (healed > 0) {
                    Events.emit('city:healedUnit', { city, unit: u, amount: healed });
                }
            });
        });
    }

    serialize() {
        return {
            width: this.width,
            height: this.height,
            terrain: this.terrain.map(row => [...row]),
            cities: this.cities.map(c => c.serialize()),
            ruins: this.ruins.map(r => ({ ...r })),
            units: this.units.map(u => u.serialize())
        };
    }
}
