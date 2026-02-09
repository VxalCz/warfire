export const Utils = {
    lerpColor: (c1, c2, f) => {
        const r = Math.round(((c1 >> 16) & 0xFF) + (((c2 >> 16) & 0xFF) - ((c1 >> 16) & 0xFF)) * f);
        const g = Math.round(((c1 >> 8) & 0xFF) + (((c2 >> 8) & 0xFF) - ((c1 >> 8) & 0xFF)) * f);
        const b = Math.round((c1 & 0xFF) + ((c2 & 0xFF) - (c1 & 0xFF)) * f);
        return (r << 16) | (g << 8) | b;
    },

    manhattanDistance: (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2),

    randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,

    assert: (condition, message) => {
        if (!condition) throw new Error(`Assertion failed: ${message}`);
    },

    clamp: (val, min, max) => Math.max(min, Math.min(max, val))
};

export class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    on(event, callback) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        if (!this.listeners.has(event)) return;
        const callbacks = this.listeners.get(event).filter(cb => cb !== callback);
        this.listeners.set(event, callbacks);
    }

    emit(event, data) {
        if (!this.listeners.has(event)) return;
        this.listeners.get(event).forEach(cb => {
            try {
                cb(data);
            } catch (e) {
                console.error(`Event ${event} error:`, e);
            }
        });
    }
}

export const Events = new EventBus();
