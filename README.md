# Warfire

8-bit pixel art turn-based strategy game inspired by Warlords 2, built with Phaser 3 and Vite.

![Screenshot placeholder]

## Features

- **Configurable Game Setup** - Menu to select map size (Tiny to Giant), player count (2-4), and AI/human players
- **AI Players** - Rule-based AI opponents for single player or mixed games
- **Large Map Support** - Scrolling camera system for maps up to 50x40 tiles
- **Minimap** - Overview of the entire map with viewport indicator (updates during camera movement)
- **Tile Information** - Hover over tiles to see terrain type, defense bonus, cities, and ruins
- **4-player hotseat multiplayer** - Take turns on the same device
- **Procedural pixel art** - All graphics generated programmatically, no external assets
- **Enhanced Graphics** - Detailed terrain, animated highlights, HP bars, status indicators
- **Turn-based tactics** - Move units, capture cities, explore ruins
- **Combat system** - Terrain bonuses, ranged attacks, stack combat
- **Hero progression** - Find artifacts in ruins to power up your hero
- **Save/Load system** - Continue your game later

## Game Mechanics

### Units
| Unit | Cost | HP | ATK | DEF | MOV | RNG |
|------|------|-----|-----|-----|-----|-----|
| Light Infantry | 10g | 20 | 3 | 2 | 3 | 1 |
| Heavy Infantry | 20g | 35 | 5 | 4 | 2 | 1 |
| Cavalry | 30g | 25 | 6 | 2 | 5 | 1 |
| Archer | 15g | 15 | 4 | 1 | 3 | 2 |
| Catapult | 40g | 10 | 8 | 1 | 2 | 3 |
| Dragon | 100g | 50 | 10 | 5 | 6 | 1 |
| Hero | - | 40 | 7 | 4 | 4 | 1 |

### Cities
- **Small** - 5g/turn income
- **Medium** - 10g/turn income
- **Large** - 20g/turn income

### Terrain
- **Plains** - Normal movement, no defense bonus
- **Forest** - Normal movement, +1 defense
- **Mountains** - 2x movement cost, +2 defense
- **Water** - Impassable (except for Dragons)

## Visual Features

### Graphics
All game graphics are procedurally generated using Phaser 3:

- **Terrain** - Textured grass, 3D-style trees, mountains with snow caps, animated water
- **Units** - Detailed sprites with shadows, faces, equipment, HP bars, and status indicators (H=Hero, M=Moved, A=Attacked)
- **Cities** - Architectural details including walls, towers, gates, flags, and smoke effects
- **Ruins** - Broken pillars, scattered stones, vines, and mysterious ancient tablets

### UI Elements
- **Animated Highlights** - Pulsing effects for movement (green), attack (red X), and ranged targets (target crosshair)
- **Hover Effect** - Corner bracket highlight on tiles under cursor
- **Minimap** - Square overview with white viewport rectangle that follows camera movement
- **3D-Style Buttons** - Shadow effects with hover and press animations

### Map Sizes
| Size | Dimensions | Best For |
|------|------------|----------|
| Tiny | 12x10 | Quick games (15-20 min) |
| Small | 15x12 | Short games (20-30 min) |
| Medium | 20x15 | Standard games (30-45 min) |
| Large | 30x22 | Long games (45-60 min) |
| Huge | 40x30 | Epic games (60+ min) |
| Giant | 50x40 | Marathon games (90+ min) |

### Victory Conditions
Capture all enemy cities OR defeat all enemy units including their hero.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:5173
```

## Controls

### Basic Controls
| Action | Control |
|--------|---------|
| Select unit/city | Click |
| Move unit | Click highlighted tile |
| Attack | Click enemy on highlighted tile |
| Ranged attack | Click enemy in range (orange highlight) |
| Open production | Right-click owned city, or click when units have moved |
| End turn | Click END TURN button |
| Save game | S key or SAVE button |
| Load game | L key or LOAD button |
| Deselect | ESC key |

### Camera Controls
| Action | Control |
|--------|---------|
| Scroll map | Drag with mouse or Arrow keys |
| Center on player | C key |
| Jump to location | Click on minimap |

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| P | Open production for visible city |
| C | Center camera on current player |
| S | Save game |
| L | Load game |
| ESC | Deselect / Close panels |
| Arrow Keys | Move camera |

## AI Players

The game includes a rule-based AI system that can control any number of players. The AI:

- **Builds units** based on current army composition and available gold
- **Expands** by capturing neutral and enemy cities
- **Explores ruins** with heroes to find artifacts
- **Attacks strategically** - prioritizes weak enemies, heroes, and high-value targets
- **Defends cities** - attempts to protect its territories

To play against AI, use the game menu to set any player to "AI BOT" mode.

## Development

### Available Scripts

```bash
npm run dev      # Start dev server with HMR
npm run build    # Production build to dist/
npm run preview  # Preview production build
```

### Project Structure

```
src/
├── constants.js          # Game configuration, unit stats, colors
├── utils.js              # Utilities, EventBus
├── models/               # Data classes
│   ├── Unit.js
│   ├── City.js
│   ├── Player.js
│   └── Stack.js
├── systems/              # Game logic systems
│   ├── GameMap.js        # Map generation and queries
│   ├── GameState.js      # State machine
│   ├── CombatSystem.js   # Damage calculation
│   ├── AISystem.js       # AI player logic
│   ├── MovementSystem.js # Pathfinding
│   ├── SaveSystem.js     # localStorage persistence
│   └── RenderSystem.js   # Phaser rendering with camera
├── ui/                   # User interface
│   └── UIController.js   # UI panels, minimap, tile info
├── scenes/               # Phaser scenes
│   ├── MenuScene.js      # Game setup menu
│   └── GameScene.js      # Main game
├── game/                 # Main game controller
│   └── WarfireGame.js
└── main.js               # Entry point
```

### Architecture

The game uses a component-based architecture with:
- **EventBus** for decoupled communication between systems
- **State machine** for game phase management (IDLE → SELECTED → MOVING/ATTACKING)
- **Separation of concerns** - logic (systems) separated from data (models) and presentation (render/ui)

### Adding New Units

Edit `src/constants.js`:

```javascript
UNIT_DEFINITIONS: {
    NEW_UNIT: {
        name: 'New Unit',
        cost: 25,
        hp: 30,
        attack: 5,
        defense: 3,
        movement: 4,
        range: 1,
        canEnter: [TERRAIN.PLAINS, TERRAIN.FOREST, TERRAIN.MOUNTAINS]
    }
}
```

Then add sprite drawing in `WarfireGame.drawUnitSprite()`.

## Tech Stack

- [Phaser 3](https://phaser.io/) - Game framework
- [Vite](https://vitejs.dev/) - Build tool
- [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) - Pixel font

## License

MIT License - see LICENSE file
