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

## Road Rivals

**Loop:** connect immediately, then continuously alternate between `on-foot` and
`driving`; death respawns the local player and personal car. The wrapper opens
two independent iframe clients against the same WebSocket relay.

**Rules:** WASD moves on foot or operates throttle/brake/steering in the car; E
enters a nearby car or exits to a collision-free side; the pointer aims and
fires. Remote projectiles damage the local authoritative player, with the car
reducing incoming damage. Each client sends state snapshots at 20 Hz and shot
events immediately.

**Vehicle contract:** velocity is decomposed into longitudinal and lateral tire
space. Engine/reverse/brake acceleration, speed-dependent drag, lateral grip,
handbrake slip, speed-sensitive steering and bicycle-model yaw are integrated on
the fixed step. `Physics2D` then resolves car/building/prop/enemy contacts with
continuous collision, friction, restitution and mass-scaled impulse transfer.

**Network contract:** `/ws-relay` forwards packets immediately; there is no
simulated latency. Protocol messages carry a game discriminator so samples can
share the relay. Local simulation is authoritative, while each remote actor owns
a `Net.createInterpolator` with wrap-safe angle blending and a small snapshot
render buffer for real packet spacing and Internet jitter. Stale peers expire.

**Iteration checklist:** two-client wrapper; on-foot aim/move/fire; enter/exit;
forward/reverse/brake; lateral grip/drift/handbrake; static collision; remote
snapshots; angle interpolation; shot events/damage/respawn; responsive camera and
HUD.

**Iteration 2:** place the personal car inside the initial interaction radius and
float the E prompt above it; add hostile AI with health/death/respawn; collide
local bullets against AI and interpolated remote hitboxes; relay targeted hit
confirmations; and transfer car impact impulses into enemies and movable street
props instead of treating every object as immovable scenery.

**Iteration 3:** prohibit firing from inside the car; raise engine/reverse force
and top speed; loosen powered rear grip for deterministic fishtail/drift; move
the car, scenery, enemies and street props into the opt-in `Physics2D` rigid-body
solver for continuous collision, friction, restitution and real impulse transfer;
use `Camera`, `Collision` and `Goodies.leadTarget` instead of sample-local
versions; and attach a life sequence to snapshots so remote respawns clear
interpolation instead of visibly sweeping across the map.

**Iteration 4:** expand the city to 4800×3000 and place the two player spawns at
opposite corners; add `spectator -> alive -> dead -> alive` state transitions,
a centered in-game spectator JOIN panel and a death/respawn modal; treat remote cars as
independent damageable hitboxes; list players and bots in the HUD; use
`Goodies.flash` for impact readability; move bot simulation, health, respawns,
leading aim and health-pickup validation to `/ws-road-rivals`; represent synced
pickups in a client ECS; and synthesize continuously speed-dependent engine and
impact-dependent crash audio.

**Iteration 5:** let authoritative bots select other living bots as movement and
combat targets when they are nearer than a player, including server-owned damage,
knockback, deaths and respawns. Replace the aggregate roster copy with a compact
`UI.listItem` roster containing one always-visible status row for the local
player, every remote player and every server bot.

**Iteration 6:** replace harsh saw/square vehicle audio with geared triangle/sine
engine harmonics, speed-filtered road noise, slip-filtered tire noise and a softer
noise-plus-sine collision transient. Anchor the enter-car badge just above the
roof, include camera-shake displacement and clamp it to the viewport.

**Iteration 7:** compute aim from the player's final rendered screen position
after cursor look-ahead camera movement; make occupied and empty cars block every
projectile; publish spectator presence so both iframe clients appear in the
roster before joining; replace the generic join wipe with a neon shutter; give
server bots preferred combat range, orbiting and neighbor separation; and add
local collision/ram response against interpolated bots, players and cars.

**Iteration 8:** keep cursor aim canonical by converting the pointer through the
final camera transform after look-ahead and shake, and use the same practical
125px center-distance threshold for both the enter-car prompt and interaction.
Use zero camera dead zone and keep the player/car as the primary camera anchor
while a direct screen-space mouse offset pulls the viewport toward the aimed
side, avoiding cursor-world/camera feedback.
Initialize each client camera at its own spawn (rather than the map center), and
drive a frame-rate-corrected explicit focus point through `Camera.snapTo` so both
opposite-corner clients have deterministic viewport tracking. Calculate each
shot from the final rendered actor-to-pointer screen vector at fire time, exclude
the shooter's own nearby parked car from local blocking, and render a bright
short projectile streak in addition to the bullet head. Use the engine's explicit
game-bound `Mouse` service (normalized through the canvas client rect and tracked at window
scope), require `Mouse.inside` for mouse interactions, and draw a screen-space
aim reticle as direct visual confirmation of the coordinates being consumed.
Drive camera focus from the latest mouse position during the render frame before
the world transform, and hide the native cursor while alive so only the in-game
crosshair remains. Use the actual game-bound camera shake API (`Camera.shake(...)`,
`Camera.shakeX()`, `Camera.shakeY()`): treating `shake` as an object yields
`undefined`, turns world/aim coordinates into `NaN`, and makes canvas translation
silently no-op.

**Iteration 9:** reduce the shared authoritative population from twelve bots to
six; reproduce the client building/cover geometry on the server and axis-slide
bot movement around it; render car prompts below fixed HUD z-order; use streaks
without bullet-head circles; leave fading paired rear-tire marks during fast,
slipping and handbrake driving; and add a bottom-right city minimap for roads,
buildings, pickups, bots and players.

**Iteration 10:** replace generic coin/blip cues with layered weapon cracks,
damage thumps, door/latch hits, pickup arpeggios, radio confirms and join sweeps.
Route engine/road noise, combat, impacts, pickups and UI into distinct
`Audio.Mixer` buses with per-channel gain/filtering, city reverb, weapon slap
delay, a master limiter, impact/death ducking and distance/pan-aware remote
shots. Gate the entire graph behind a real user gesture—remote discovery and
server bot traffic must remain silent during page load.

**Iteration 11:** extract the authoritative WebSocket simulation from Vite into
`road-rivals/src/server/index.ts`. Add server-validated, respawning shotgun and SMG
pickups alongside the default pistol; give each weapon distinct damage, rate,
spread, projectile lifetime and mixer-treated report; support keyboard slots
`1`–`3` and clickable inventory slots; show weapon pickups in-world and on the
minimap; and layer a spatial crunch plus descending body tone for bot deaths.

**Iteration 12:** synchronize explicit car-destruction events between clients and
render a multi-stage explosion with an expanding shockwave, radial fireball,
rising smoke and spinning hot/body-color debris. Add a dedicated distance- and
pan-aware explosion voice on the impact bus, aggressive vehicle/combat ducking
and distance-scaled camera shake.

**Iteration 13:** give pistol, shotgun and SMG clearly different transient,
body and mechanical audio envelopes; render active health pickups as green
crosses and weapon pickups as outlined amber diamonds on the minimap; and show
a color-thresholded car-health meter above the inventory whenever driving.
Always show a matching player-health meter during play, stacking player and car
health while driving so damage state is readable without consulting the roster.

**Iteration 14:** replace the single spawn-adjacent vehicle with a distributed
three-car local fleet. Compact, muscle and drift cars have distinct dimensions,
mass, acceleration, grip, steering, visuals and HUD labels. Make every projectile
collide with every fleet/remote car, add cooldown-limited low collision damage,
show fleet positions on the minimap, select the nearest enterable car, and animate
bot deaths by flattening, rotating, sliding and fading their body before removal.
Keep roster, health meters, inventory, prompts and modal HUD chrome on `UI`
primitives while reserving raw canvas drawing for the world/minimap visualization.

**Iteration 15:** make vehicle rams visibly launch actors. Player movement gains
a transient network-fed knockback velocity with exponential drag; player ram
messages include car-velocity impulses; and server-authoritative bot ram impulses
are strengthened enough to survive snapshot damping and produce clear travel.

**Iteration 16:** split the expanded sample by responsibility: client
`config.js` owns world, fleet and weapon definitions; `visuals.js` owns
world/entity/effect rendering; the server entry owns authoritative WebSocket
state; and the client main module remains the orchestration, physics, networking
and HUD entry point.

**Iteration 17:** continue the subsystem split as the sample grows. Move the
mixer graph and sound definitions into `audio.js`, immediate-mode health,
inventory, prompt and minimap composition into `hud.js`, and deterministic city
geometry generation into `world.js`. Each subsystem exposes a small factory or
pure renderer while the client main module retains ownership of mutable game state.

**Iteration 18:** give every sample a consistent `src/` source boundary. Keep
HTML wrappers and assets at the sample root, shared JavaScript in `shared/src/`,
and organize Road Rivals explicitly under `src/client/` and `src/server/`.
