# Minimotor — Roadmap & Ideas

## Functionality from Hoppspelet that could move into Minimotor

These are features currently implemented directly in the game that are generic
enough to become engine utilities.

### 1. Stage / Canvas management (`stage.ts`)

- DPR-aware canvas resize with backing-store scaling
- View dimensions (`viewW`, `viewH`) and safe-area insets (iPhone notch)
- Ground-line positioning (generalised as a stage-floor helper)
- Orientation change listener for notch side detection
- `initParticles()` — background ambient particles are a generic pattern
- **Suggested API:** `Minimotor.Stage.create(canvas)` → returns `{ viewW, viewH, DPR, resize, onResize(cb) }`

### 2. Orientation lock / portrait-pause (`input.ts` + `stage.ts`)

- Media query `(orientation: portrait) and (pointer: coarse)` auto-pause
- Rotate-hint overlay (DOM element injected by engine, shown/hidden by CSS)
- `screen.orientation.lock("landscape")` for full-screen PWAs
- **Suggested API:** `Minimotor.Orientation.requireLandscape({ pauseGame: true })`

### 3. Input helpers (`input.ts`)

- Generic button wiring (`wireButton(id, action)` with touch/mouse/click)
- Keyboard action binding (space-prevents-default + custom keys)
- Touchstart listener with `preventDefault`
- **Suggested API:** `Minimotor.Input.key(code, action)`, `Minimotor.Input.tap(element, action)`

### 4. Sprite cache / off-screen rendering (`sprites.ts`)

- `getCoinSprite` pattern: render an off-screen canvas once, cache by key+DPR
- `SpriteCanvas` type extends `HTMLCanvasElement` with `logicalSize` property
- **Suggested API:** `Minimotor.SpriteCache.get(key, w, h, drawFn)` → cached canvas

### 5. Hazard strip caching (`render-helpers.ts`)

- Pre-render farozonsremsa (hazard gradient strip) at view width, reuse until theme changes
- Similar to sprite cache but linear/rect fill, used as `drawImage` source

### 6. Overlay text / HUD helpers (`main.ts`)

- `overlayText(ctx, text, subtext?)` — semi-transparent full-screen overlay with centered text
- **Suggested API:** `Minimotor.UI.overlay(ctx, msg, sub?)`

### 7. Floating text / score popups (`update.ts` + `sprites.ts`)

- Small animated text that floats up and fades out
- Generic: position, text, velocity, life-span, colour
- **Suggested API:** `Minimotor.UI.floatingTexts` (array) + `drawAll(ctx)`

### 8. LocalStorage best-score helper (`state.ts`)

- `getBest(key)` / `setBest(key, score)` with try/catch for private browsing
- **Suggested API:** `Minimotor.Storage.get(key)`, `.set(key, value)`

### 9. Particle system (generalised)

- Ambient particles currently in `stage.ts` with fixed set of behaviours:
  rising (embers), falling (snow, bubbles), orbiting (fireflies), static blink (stars)
- **Suggested API:** `Minimotor.Particles.emitter(config)` returning update/draw closures

### 10. Theme application (`main.ts` + `world.ts`)

- The pattern: on theme change → apply `canvas.style.background`, show name banner, reset caches
- Could be a `Minimotor.ThemeApplier` that handles CSS background, announcement timer, cache invalidation

## New functionality not yet used by Hoppspelet

### 1. Force landscape mode

- `screen.orientation.lock("landscape")` (works on mobile in fullscreen/PWA)
- If lock fails (desktop), auto-rotate hint via CSS media query
- Combine with portrait-pause from point 2 above
- **Implementation in engine:** `Minimotor.setLandscapeRequired(enabled)`

### 2. FPS / debug overlay

- Display current FPS, frame timing, update count
- Toggle with a key combo (F3, backtick)
- **Value:** helps tune performance across devices

### 3. Camera / viewport

- `ctx.save(); ctx.translate(-camera.x, -camera.y); ctx.restore()`
- Shake effect (`camera.offset = random * intensity`)
- Smooth scrolling / lerp to target
- **Value:** used by many platformers and action games

### 4. Game state machine

- Scene/state transitions (Menu, Playing, Paused, GameOver)
- Each "scene" gets its own `update()` / `draw()` lifecycle
- **Value:** stops state-checking boilerplate (`if (state === "playing")`) from spreading

### 5. Resource preloader

- Load images, audio, JSON data with progress callback
- Cache them in a global resource map
- **Value:** needed for sprite sheets, level data, sound samples

### 6. Tween / easing library

- `Tween.to(obj, { x: 100 }, 500, Easing.outBounce).onUpdate(...)`
- Lightweight, no external deps
- **Value:** smooth camera transitions, menu animations, UI pop-ins

### 7. Circle-rect collision

- Engine has `rectsOverlap`; add `circleRectOverlap(circle, rect)`
- Add helper for circle-circle, point-in-rect, point-in-circle

### 8. Math utilities

- `clamp`, `lerp`, `mapRange`, `randInt`, `randFloat`, `randItem`
- Angle helpers (`angleBetween`, `distance`, `normalizeAngle`)
- **Value:** every game needs these; avoids repetition

### 9. Gamepad API support

- Navigator.getGamepads() polling in the game loop
- Map stick/button events to virtual action names
- **Value:** controller support for desktop play

### 10. Haptic feedback

- `navigator.vibrate(pattern)` on mobile
- Optional: short pulse on jump / hit / collect
- **Value:** feels more responsive on touch devices (where screen taps give no physical feedback)

### 11. Simpler PWA setup

- Automatically register service worker if `sw.js` is present
- Provide `cacheFirst` and `networkFirst` strategies
- **Value:** one-line PWA setup

### 12. Audio extensions

- Sample-based SFX playback (play pre-loaded buffers instead of synth only)
- Volume control per channel (SFX / Music / Master)
- Pan / spatial audio helper
- **Value:** richer audio beyond current procedurally-generated sounds

## Design principles for new features

- **KISS** — each feature should be optional, <100 lines unless complex
- **No bundler required** — engine must work when built with plain `tsc`
- **Progressive** — game only pays for what it imports
- **TypeScript strict** always

---

_This file is a brainstorming document; nothing here is committed to be implemented._
