import { UNIT_DEFINITIONS, ARTIFACTS } from '../constants.js';
import { Utils, Events } from '../utils.js';

export class Unit {
    constructor(type, owner, x, y) {
        const def = UNIT_DEFINITIONS[type];
        Utils.assert(def, `Unknown unit type: ${type}`);

        this.id = `unit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.type = type;
        this.owner = owner;
        this.x = x;
        this.y = y;
        this.maxHp = def.hp;
        this.hp = def.hp;
        this.baseAttack = def.attack;
        this.baseDefense = def.defense;
        this.baseMovement = def.movement;
        this.range = def.range;
        this.cost = def.cost;
        this.isHero = def.isHero || false;
        this.canEnter = def.canEnter;

        this.hasMoved = false;
        this.hasAttacked = false;
        this.artifacts = [];
        this.buffs = [];
    }

    get effectiveAttack() {
        const artifactBonus = this.artifacts.reduce((s, a) => s + (a.attackBonus || 0), 0);
        const buffBonus = this.buffs.reduce((s, b) => s + (b.attackBonus || 0), 0);
        return this.baseAttack + artifactBonus + buffBonus;
    }

    get effectiveDefense() {
        const artifactBonus = this.artifacts.reduce((s, a) => s + (a.defenseBonus || 0), 0);
        const buffBonus = this.buffs.reduce((s, b) => s + (b.defenseBonus || 0), 0);
        return this.baseDefense + artifactBonus + buffBonus;
    }

    get effectiveMovement() {
        const artifactBonus = this.artifacts.reduce((s, a) => s + (a.movementBonus || 0), 0);
        return this.baseMovement + artifactBonus;
    }

    get name() {
        return UNIT_DEFINITIONS[this.type].name;
    }

    canEnterTerrain(terrain) {
        return this.canEnter.includes(terrain);
    }

    takeDamage(damage) {
        this.hp = Utils.clamp(this.hp - damage, 0, this.maxHp);
        Events.emit('unit:damaged', { unit: this, damage, remainingHp: this.hp });
        return this.hp <= 0;
    }

    heal(amount) {
        const oldHp = this.hp;
        this.hp = Utils.clamp(this.hp + amount, 0, this.maxHp);
        const healed = this.hp - oldHp;
        if (healed > 0) Events.emit('unit:healed', { unit: this, amount: healed });
        return healed;
    }

    addArtifact(artifact) {
        this.artifacts.push({ ...artifact });
        Events.emit('unit:artifactAdded', { unit: this, artifact });
    }

    resetTurn() {
        this.hasMoved = false;
        this.hasAttacked = false;
    }

    serialize() {
        return {
            id: this.id,
            type: this.type,
            owner: this.owner,
            x: this.x,
            y: this.y,
            hp: this.hp,
            hasMoved: this.hasMoved,
            hasAttacked: this.hasAttacked,
            artifacts: [...this.artifacts]
        };
    }

    static deserialize(data) {
        const unit = new Unit(data.type, data.owner, data.x, data.y);
        unit.hp = data.hp;
        unit.hasMoved = data.hasMoved;
        unit.hasAttacked = data.hasAttacked;
        unit.artifacts = [...data.artifacts];
        return unit;
    }
}
