# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Warfire** is a browser-based 8-bit turn-based strategy game using:
- **Phaser 3** (v3.70.0) for rendering and game loop
- **Vite** for development server and build tooling
- **ES6 modules** with import/export syntax
- **Procedural graphics** - no external image assets

## Development Commands

```bash
# Start development server with HMR (hot reload)
npm run dev

# Production build (outputs to dist/)
npm run build

# Preview production build locally
npm run preview

# Install dependencies
npm install
```

Dev server runs at `http://localhost:5173` by default.

## Architecture

### Module Organization

```
src/
├── constants.js          # All game constants (CONFIG, COLORS, UNIT_DEFINITIONS)
├── utils.js              # Shared utilities + EventBus singleton
├── models/               # Pure data classes (Unit, City, Player, Stack)
├── systems/              # Logic systems with static or instance methods
├── ui/                   # UI rendering and interaction
├── scenes/              # Phaser scene classes (GameScene, MenuScene)
├── game/                 # Main game controller (WarfireGame)
└── main.js              # Entry point, initializes Phaser
```

### Key Patterns

**Event-Driven Architecture:**
```javascript
// Subscribe
Events.on('unit:moved', ({ unit, toX, toY }) => { ... });

// Emit
Events.emit('unit:moved', { unit, toX, toY });
```

**State Machine:**
```javascript
this.state.transition(GameState.PHASES.SELECTED); // Validates transition
```

**System Separation:**
- `MapGenerator.generate()` - procedural map generation
- `TextureGenerator.generateTextures()` - procedural texture creation
- `CombatSystem.performAttack()` - pure combat logic
- `RenderSystem.renderUnits()` - pure rendering with camera support
- `AISystem.playTurn()` - AI player decisions
- `MovementSystem` - unit movement and pathfinding
- `GameState` - state machine for game phases
- `SaveSystem.saveGame()` / `loadGame()` - save/load to localStorage
- `WarfireGame` - orchestrates between systems

**Camera System:**
```javascript
// Center on specific tile
this.renderer.centerOnTile(x, y);

// Move camera
this.renderer.moveCamera(dx, dy);

// Convert screen to tile coordinates
const tile = this.renderer.screenToTile(screenX, screenY);
```

### Adding Features

**New Unit Type:**
1. Add to `UNIT_DEFINITIONS` in `constants.js`
2. Add sprite drawing in `TextureGenerator.generateUnitTextures()`
3. Optionally add terrain restrictions via `canEnter`

**New Game Phase:**
1. Add to `GameState.PHASES`
2. Add valid transitions to `transition()` method
3. Handle in `WarfireGame.handleTileClick()`

**New UI Panel:**
1. Add to `UIController.elements` or `UIController.panels`
2. Create in `initialize()`, update in dedicated method
3. Emit events via `Events.emit('ui:action')`

**New Map Size:**
1. Add to `sizes` array in `MenuScene.createMapSizeSection()`
2. Default game constants (VIEWPORT_WIDTH, VIEWPORT_HEIGHT) handle all sizes
3. City/ruin counts scale automatically with map area

**AI Behavior Changes:**
1. Edit decision logic in `AISystem.decideProduction()` for build choices
2. Modify `AISystem.findBestAttackTarget()` for attack priorities
3. Adjust `AISystem.findBestMoveTarget()` for movement strategy

## Code Conventions

- **Imports first** - external (Phaser), then internal (constants, utils), then relative paths
- **Named exports** - `export class Unit` not default exports
- **JSDoc types** - use comments for complex parameter types
- **Assertions** - `Utils.assert(condition, 'message')` for invariants
- **Events** - past tense for completed actions (`unit:moved`), present for requests (`ui:save`)

## Common Tasks

**Debug rendering issues:**
```javascript
// In browser console
game.renderer.containers.units.list  // See all unit sprites
```

**Check game state:**
```javascript
game.state.phase      // Current phase
game.state.selectedEntity  // What's selected
game.map.getStack(x, y)    // Units at position (uses spatial index)
game.map.getCity(x, y)     // O(1) lookup via cityGrid
game.map.getUnitsAt(x, y)  // O(1) lookup via unitGrid
game.renderer.camera   // Camera position {x, y}
game.players[0].isAI   // Check if player is AI
```

**Force save/load:**
- Press `S` to save, `L` to load
- Or use UI buttons
- Data stored in `localStorage` key `warfire_save`

**Keyboard Shortcuts:**
- `Arrow Keys` - Move camera
- `C` - Center camera on current player
- `P` - Open production menu (for selected city or city under cursor)
- `ESC` - Deselect current unit/city
- `S` - Save game
- `L` - Load game

## Testing Changes

Since this is a game without automated tests:
1. Run `npm run dev` for HMR
2. Test manually in browser
3. Check browser console for errors
4. Test save/load after significant changes

## Build Notes

- Phaser is bundled from `node_modules` (not CDN)
- All textures created procedurally via `Graphics.generateTexture()`
- No external assets to copy - everything is code
- Production build is a static site, can deploy to any static host

## Graphical Features

**Procedural Graphics System:**
All game graphics are generated programmatically using Phaser 3 Graphics API:

**Terrain Tiles:**
- Plains - textured grass with random patches and flowers
- Forest - multi-layered trees with trunks, foliage, and depth
- Mountains - peaks with snow caps, rock details, and shading
- Water - animated waves with sparkles and depth variation

**Units (detailed sprites with):**
- Shadows for depth
- Faces with eyes
- Type-specific equipment (weapons, shields, armor)
- HP bars (visible when damaged) - green/yellow/red based on health %
- Status indicators: H (Hero), M (Moved), A (Attacked)
- Hop animation when selected

**Cities:**
- Size variations (small/medium/large) with different architecture
- Walls, towers, gates, flags
- Chimneys with smoke
- Lit windows for owned cities

**Ruins:**
- Broken pillars and scattered stones
- Vines and overgrowth
- Ancient tablets with mysterious symbols

**UI Elements:**
- Animated highlights (pulsing) for move/attack/ranged targets
- Hover effect on tiles (corner brackets)
- 3D-style buttons with shadows and hover states
- Square minimap with viewport rectangle that updates during camera movement
- Decorative panel headers

## Known Limitations

- No animations for unit movement (instant)
- No sound effects
- Stack limit is 1 unit per tile (no stacking)
- Stack splitting not implemented in UI
- No undo functionality
- AI is rule-based (not machine learning), sometimes makes suboptimal decisions

## Performance Optimizations

The codebase includes several performance optimizations:

- **Spatial Indexing**: `GameMap` uses `cityGrid`, `ruinGrid`, and `unitGrid` for O(1) lookups instead of O(n) array searches
- **ZOC Caching**: `MovementSystem` caches Zone of Control calculations to avoid redundant checks
- **Bounding Box Search**: Attack target search only iterates tiles within range instead of entire map
- **AI thinkDelay**: Reduced to 200ms for faster AI turns

When adding new features that query map positions frequently:
- Use `gameMap.getCity(x, y)`, `gameMap.getRuin(x, y)`, `gameMap.getUnitsAt(x, y)` for O(1) lookups
- Do not iterate over `gameMap.cities` or `gameMap.units` directly for position checks

## Performance Optimizations

The codebase includes several performance optimizations:

**Spatial Indexing (GameMap):**
- `cityGrid`, `ruinGrid`, `unitGrid` provide O(1) lookups
- `getCity()`, `getRuin()`, `getUnitsAt()` are constant time
- Always use these methods instead of iterating arrays

**MovementSystem:**
- ZOC (Zone of Control) caching to avoid redundant checks
- Bounding box optimization for attack target search
- Uses spatial grid internally

**AI:**
- Think delay reduced to 200ms for faster turns
- Focus fire coordination between units

## User Preferences

**Git commits:** Do not add "Co-Authored-By: Claude Opus 4.6" or similar co-author lines to commit messages.
