import { Events } from '../utils.js';

export class GameState {
    static PHASES = {
        IDLE: 'IDLE',
        SELECTED: 'SELECTED',
        MOVING: 'MOVING',
        MOVED: 'MOVED',          // Unit has moved, can still attack
        ATTACKING: 'ATTACKING',
        PRODUCTION: 'PRODUCTION',
        GAME_OVER: 'GAME_OVER'
    };

    constructor() {
        this.phase = GameState.PHASES.IDLE;
        this.currentPlayerIndex = 0;
        this.selectedEntity = null;
        this.turnNumber = 1;
    }

    transition(to, data = null) {
        const validTransitions = {
            [GameState.PHASES.IDLE]: [GameState.PHASES.SELECTED, GameState.PHASES.PRODUCTION],
            [GameState.PHASES.SELECTED]: [GameState.PHASES.IDLE, GameState.PHASES.MOVING, GameState.PHASES.ATTACKING, GameState.PHASES.MOVED],
            [GameState.PHASES.MOVING]: [GameState.PHASES.IDLE, GameState.PHASES.MOVED],
            [GameState.PHASES.MOVED]: [GameState.PHASES.IDLE, GameState.PHASES.ATTACKING],
            [GameState.PHASES.ATTACKING]: [GameState.PHASES.IDLE],
            [GameState.PHASES.PRODUCTION]: [GameState.PHASES.IDLE],
            [GameState.PHASES.GAME_OVER]: []
        };

        if (!validTransitions[this.phase].includes(to)) {
            console.warn(`Invalid transition: ${this.phase} -> ${to}`);
            return false;
        }

        this.phase = to;
        Events.emit('phase:changed', { phase: to, data });
        return true;
    }

    nextPlayer(playerCount) {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % playerCount;
        if (this.currentPlayerIndex === 0) this.turnNumber++;
        Events.emit('player:changed', { playerIndex: this.currentPlayerIndex, turn: this.turnNumber });
    }
}
