# Sample game plans

These samples are intentionally small games, not feature demos with disconnected
objects. Each plan names the state machine, game rules, collision geometry and
an iteration checklist before implementation.

## Pocket Asteroids

**Loop:** `title -> play -> wave clear -> play -> gameover`; Space/A starts and
restarts. Every play frame updates input, ship physics, wrapped entities,
projectiles, collisions, score and particles; draw is presentation only.

**Rules:** the ship rotates and thrusts with inertia; bullets expire; large rocks
split into two medium rocks, then small rocks; clearing a wave starts the next
wave; rocks cost one life and grant two seconds of invulnerability; hyperspace
teleports safely but is limited by a cooldown.

**Collision contract:** the arena is a torus. All circle checks use shortest
wrapped distance on both axes. Bullet/rock checks use the same metric, so edge
crossings cannot cause false misses. Spawn positions are rejected if their
wrapped distance from the ship is unsafe. No entity is removed while iterating a
second entity list without a stable index.

**Iteration checklist:** title and restart; thrust/rotation/fire; edge wrapping;
rock splitting; edge collision; invulnerability; wave progression; game-over.

**Iteration 2:** use torus-distance helpers for every circle check, enlarge the
logical playfield, remove edge-clipped square stars, and render effects in the
same coordinate space as their emitters. Mobile user agents keep a 16:9
letterbox; desktop canvases fill their actual viewport.

## Asset Quest

**Loop:** `loading -> play -> won`; R resets. The player moves with a circle
collider through a JSON tile map, collects every key, then enters the gate.

**Collision contract:** tile coordinates are queried by an explicit `tile === 1`
wall test (`0` is floor). Player movement resolves X and Y independently using
four circle edge samples, preventing corner clipping and preserving sliding.
Gate completion is checked only after collection is complete.

**Iteration checklist:** assets load/progress; keyboard movement on floor and
around walls; key collection; gate lock/unlock; win/restart; animated astronaut
uses a purpose-built sheet rather than arbitrary art slicing.

**Iteration 2:** fix zero-valued floor tiles, use circle edge/corner samples,
and keep pickup particles/floating labels under the map offset.

## Parallax Courier

**Loop:** `play -> won/lost`; R resets. The courier navigates three sequential
beacons while drones chase. Camera follows with dead-zone, clamp and zoom.

**Collision contract:** drones and courier use circle-vs-circle distance in world
space. A hit consumes one life, resets the courier to a safe checkpoint and
starts a brief invulnerability window. Beacon clicks are converted from screen
to world coordinates and only dock when the courier is within range.

**Iteration checklist:** camera follow/clamp; keyboard movement; screen/world
click conversion; beacon sequence; drone pursuit; hit cooldown; win/loss/restart.

**Iteration 2:** add checkpoint invulnerability, deterministic drone reset,
world-space effect rendering, and UI health/beacon meters.

## Pixel Adventure

**Loop:** `loading -> play -> won/gameover`; R resets. A real JSON tilemap is
loaded from an itch.io kit, the player and enemy are animated from sprite
atlases, and WAV effects play on jump, pickup, damage and victory.

**Rules:** run and jump across the terrain, stomp roaming radishes, collect all
coins, then reach the gate. Tile collision resolves one axis at a time and the
camera follows the player.

**Iteration checklist:** manifest progress; atlas animation; tilemap culling and
solidity; platform movement; stomp/enemy damage; coin collection; goal/win;
loaded sound effects; restart.

## Clockwork Garden

**Loop:** `play -> gameover`; Space/click restarts. Clock schedules buds, Tween
animates their appearance and Signals owns score/miss side effects.

**Rules:** collect buds before their eight-second lifetime; each miss costs one
heart and resets combo; zero hearts ends the run. The update phase owns game
state and the draw phase never mutates it.

**Iteration checklist:** deterministic spawn timer; tweened bud lifecycle; click
collection; miss/health; game-over/restart; readable HUD and feedback.

**Iteration 2:** route all game sounds through a shared musical Audio primitive
palette and use panel/bar/float UI helpers for HUD and score feedback.
