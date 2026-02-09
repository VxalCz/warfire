import { CONFIG } from '../constants.js';
import { Events } from '../utils.js';

export class SaveSystem {
    static save(game) {
        const data = {
            version: CONFIG.VERSION,
            timestamp: Date.now(),
            state: game.state,
            map: game.map.serialize(),
            players: game.players.map(p => p.serialize()),
            currentPlayer: game.state.currentPlayerIndex,
            turn: game.state.turnNumber
        };
        localStorage.setItem('warfire_save', JSON.stringify(data));
        Events.emit('game:saved', data);
        return true;
    }

    static load() {
        const json = localStorage.getItem('warfire_save');
        if (!json) return null;
        try {
            return JSON.parse(json);
        } catch (e) {
            console.error('Failed to load save:', e);
            return null;
        }
    }

    static hasSave() {
        return !!localStorage.getItem('warfire_save');
    }

    static clear() {
        localStorage.removeItem('warfire_save');
    }
}
