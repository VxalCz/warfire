// Detect mobile device
const isMobile = typeof window !== 'undefined' &&
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(window.navigator?.userAgent || '');

// Get screen dimensions for responsive sizing
const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1600;
const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 900;

// Layout: Desktop = sidebar right, Mobile = panel bottom
const MOBILE_UI_HEIGHT = Math.min(200, screenHeight * 0.25); // Bottom panel height on mobile

export const CONFIG = {
    TILE_SIZE: 64,
    MAP_WIDTH: 20,
    MAP_HEIGHT: 15,
    UI_WIDTH: 300,  // Desktop only
    UI_HEIGHT: MOBILE_UI_HEIGHT, // Mobile only
    MAX_PLAYERS: 4,
    STARTING_GOLD: 50,
    STARTING_UNITS: { HERO: 1, LIGHT_INFANTRY: 2 },
    VERSION: '1.1.0',
    IS_MOBILE: isMobile
};

// Viewport size - on mobile: full width, height minus bottom panel
// On desktop: fixed size with sidebar
export const VIEWPORT_WIDTH = isMobile ? screenWidth : (20 * CONFIG.TILE_SIZE);
export const VIEWPORT_HEIGHT = isMobile ? (screenHeight - MOBILE_UI_HEIGHT) : (15 * CONFIG.TILE_SIZE);

// Total game window
export const GAME_WIDTH = isMobile ? screenWidth : (VIEWPORT_WIDTH + CONFIG.UI_WIDTH);
export const GAME_HEIGHT = screenHeight;

export const COLORS = {
    playerSchemes: [
        { primary: 0x3B5DC9, secondary: 0xFFD700, dark: 0x1E3A8A, accent: 0x87CEEB }, // Blue + Gold
        { primary: 0xEF476F, secondary: 0x06D6A0, dark: 0x7D1A30, accent: 0xFFAAAA }, // Red + Teal
        { primary: 0x06D6A0, secondary: 0xFFD23F, dark: 0x047857, accent: 0x90EE90 }, // Teal + Gold
        { primary: 0xFFD23F, secondary: 0x9B59B6, dark: 0xB7950B, accent: 0xFFECB3 }  // Gold + Purple
    ],
    get players() { return this.playerSchemes.map(s => s.primary); },
    neutral: 0x808080,
    neutralSecondary: 0xA0A0A0,
    neutralDark: 0x606060,
    plains: 0x7EC850,
    forest: 0x306230,
    mountains: 0x9CA3AF,
    water: 0x4A90E2,
    uiBg: 0x1E3A8A,
    uiBorder: 0x0F172A,
    highlightMove: 0x90EE90,
    highlightAttack: 0xFF6B6B,
    highlightRanged: 0xFFA500,
    grid: 0x000000
};

export const TERRAIN = { PLAINS: 0, FOREST: 1, MOUNTAINS: 2, WATER: 3 };

export const TERRAIN_NAMES = ['Plains', 'Forest', 'Mountains', 'Water'];

export const TERRAIN_DEFENSE = {
    [TERRAIN.PLAINS]: 0,
    [TERRAIN.FOREST]: 1,
    [TERRAIN.MOUNTAINS]: 2,
    [TERRAIN.WATER]: 0
};

export const UNIT_DEFINITIONS = {
    LIGHT_INFANTRY: {
        name: 'Light Infantry',
        cost: 10,
        hp: 20,
        attack: 3,
        defense: 2,
        movement: 3,
        range: 1,
        canEnter: [TERRAIN.PLAINS, TERRAIN.FOREST, TERRAIN.MOUNTAINS]
    },
    HEAVY_INFANTRY: {
        name: 'Heavy Infantry',
        cost: 20,
        hp: 35,
        attack: 5,
        defense: 4,
        movement: 2,
        range: 1,
        canEnter: [TERRAIN.PLAINS, TERRAIN.FOREST, TERRAIN.MOUNTAINS]
    },
    CAVALRY: {
        name: 'Cavalry',
        cost: 30,
        hp: 25,
        attack: 6,
        defense: 2,
        movement: 5,
        range: 1,
        canEnter: [TERRAIN.PLAINS, TERRAIN.FOREST, TERRAIN.MOUNTAINS]
    },
    ARCHER: {
        name: 'Archer',
        cost: 15,
        hp: 15,
        attack: 4,
        defense: 1,
        movement: 3,
        range: 2,
        canEnter: [TERRAIN.PLAINS, TERRAIN.FOREST, TERRAIN.MOUNTAINS]
    },
    CATAPULT: {
        name: 'Catapult',
        cost: 40,
        hp: 10,
        attack: 8,
        defense: 1,
        movement: 2,
        range: 3,
        canEnter: [TERRAIN.PLAINS, TERRAIN.FOREST, TERRAIN.MOUNTAINS]
    },
    DRAGON: {
        name: 'Dragon',
        cost: 100,
        hp: 50,
        attack: 10,
        defense: 5,
        movement: 6,
        range: 1,
        canEnter: [TERRAIN.PLAINS, TERRAIN.FOREST, TERRAIN.MOUNTAINS, TERRAIN.WATER]
    },
    HERO: {
        name: 'Hero',
        cost: 0,
        hp: 40,
        attack: 7,
        defense: 4,
        movement: 4,
        range: 1,
        isHero: true,
        canEnter: [TERRAIN.PLAINS, TERRAIN.FOREST, TERRAIN.MOUNTAINS]
    }
};

export const CITY_INCOME = { small: 5, medium: 10, large: 20 };

export const ARTIFACTS = {
    SWORD_OF_POWER: { name: 'Sword of Power', attackBonus: 3 },
    SHIELD_OF_DEFENSE: { name: 'Shield of Defense', defenseBonus: 3 },
    BOOTS_OF_SPEED: { name: 'Boots of Speed', movementBonus: 2 }
};
