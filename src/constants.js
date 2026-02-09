// Detect mobile device
const isMobile = typeof window !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(window.navigator?.userAgent || '');

export const CONFIG = {
    TILE_SIZE: 64,
    MAP_WIDTH: 20,
    MAP_HEIGHT: 15,
    UI_WIDTH: isMobile ? 150 : 300,  // Smaller UI on mobile
    MAX_PLAYERS: 4,
    STARTING_GOLD: 50,
    STARTING_UNITS: { HERO: 1, LIGHT_INFANTRY: 2 },
    VERSION: '1.1.0',
    IS_MOBILE: isMobile
};

// Viewport size (visible area) - larger on mobile to fill screen
// On mobile, use larger viewport to fill the tall screen
const mobileViewportWidth = isMobile && typeof window !== 'undefined' ? Math.min(window.innerWidth * 2, 1600) : 20 * CONFIG.TILE_SIZE;
const mobileViewportHeight = isMobile && typeof window !== 'undefined' ? Math.min(window.innerHeight * 2, 2000) : 15 * CONFIG.TILE_SIZE;

export const VIEWPORT_WIDTH = isMobile ? mobileViewportWidth : 20 * CONFIG.TILE_SIZE;  // 1280px on desktop
export const VIEWPORT_HEIGHT = isMobile ? mobileViewportHeight : 15 * CONFIG.TILE_SIZE; // 960px on desktop

// Total game window includes UI sidebar
export const GAME_WIDTH = VIEWPORT_WIDTH + CONFIG.UI_WIDTH;
export const GAME_HEIGHT = VIEWPORT_HEIGHT;

export const COLORS = {
    players: [0x3B5DC9, 0xEF476F, 0x06D6A0, 0xFFD23F],
    neutral: 0x808080,
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
