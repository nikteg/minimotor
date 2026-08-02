// ---------- The multiplayer layer ----------
// Everything in this file is `Net.game` plus four decisions. The engine already
// carries rooms, a shared clock, snapshot interpolation, typed events and
// host-authoritative state; what a shooter has to decide is how to USE them.
//
//   1. THE LOBBY IS A ROOM. There is no room-listing protocol, and this sample
//      does not add one to the server: every client joins one well-known room
//      called `fps-lobby`, and a host ADVERTISES its match there — the same
//      `share` a player position uses, at 2 Hz, carrying a match code and a
//      seat count. The browser is that list. Join by code works with no lobby
//      at all, which is what happens offline.
//
//      Guests LEAVE the lobby room when they enter a match. In a WebRTC mesh
//      every member connects to every other member, so a lobby that everyone
//      stayed in would be a second full mesh carrying nothing. The host stays,
//      because a match nobody can see is not advertised.
//
//   2. EVERY PLAYER OWNS THEIR OWN BODY. Nobody's movement is simulated
//      remotely, so there is no server correction and therefore no
//      reconciliation: the local player IS authoritative and prediction is the
//      identity function. That is the honest shape for a peer mesh, and it puts
//      all the netcode weight where it actually belongs in a shooter — on
//      rendering everyone ELSE convincingly (§3) and on agreeing who got shot
//      (§4). `Net.createPrediction` is the piece for the other topology, where
//      a server owns movement; `samples/netgame` is closer to that.
//
//   3. REMOTE PLAYERS ARE RENDERED IN THE PAST, on purpose. `share` buffers
//      snapshots and samples them at `now − delayMs`, so a remote player is
//      always blended between two states that really happened rather than
//      snapped to the newest packet. Two overrides matter here and neither is
//      the default:
//
//        `lerp`   the default blends every numeric field linearly, which is
//                 WRONG for yaw: a player turning past ±π gets blended the long
//                 way round and spins on everyone else's screen once per lap.
//        `delayMs` pinned rather than `"auto"`. An adaptive buffer is right for
//                 most games and wrong for this one — a render delay that moves
//                 is a lead you cannot learn.
//
//      `extrapolate` covers a dropped packet by projecting from velocity, hard
//      capped, because a stopped player who keeps walking is worse than one who
//      pauses.
//
//   4. THE SHOOTER DECIDES THE HIT, and it is lag-compensated for free. A shot
//      is tested against the positions being RENDERED — which are already
//      `delayMs` in the past — so "I aimed at them and hit" holds without the
//      server rewind a client/server game needs, because there is no other
//      timeline to reconcile with. The victim applies its own damage and
//      announces its own death, so the two ends never disagree about a score;
//      `plausible()` is where a real game would refuse a shot from someone
//      across the map. In a peer mesh that check is advisory and this file says
//      so rather than pretending otherwise.
//
// The room's genuinely SHARED state — the wall terminal's switches — is neither
// of those. It is one record with one owner: guests `request` a change, the host
// applies it, and `Net.hostState` broadcasts the result. A promoted host carries
// on from its own copy, so the switches survive the host leaving.

import type { NetApi, NetGame, Shared, SharedStates } from "minimotor/net";
import { PLAYER_HALF, rayBox, wallDistance, type Box } from "./arena.js";
import type { Vec3 } from "minimotor";

/** How far in the past remote players are drawn. One 20 Hz packet interval
 *  (50 ms) plus room for jitter. Exposed as a slider in the pause menu, because
 *  being able to SEE what it costs is most of the point of shipping it. */
export const DEFAULT_DELAY_MS = 90;
/** Snapshots per second per player. 20 is the usual shooter figure — the
 *  interpolation buffer is what makes it look like 60. */
export const SNAPSHOT_HZ = 20;
/** How far a lost packet may be projected before a remote player simply waits. */
export const MAX_EXTRAPOLATION_MS = 120;

export const MAX_HEALTH = 100;
export const SHOT_DAMAGE = 34;
/** Cheapest possible sanity check on an incoming hit: nothing in this arena is
 *  further apart than its diagonal, so a shot claiming to have crossed more
 *  than that came from a broken or lying peer. */
export const MAX_SHOT_RANGE = 42;

/** One player, on the wire. Deliberately flat and small: 20 Hz × everyone means
 *  this shape is most of the traffic.
 *
 *  It carries `x`/`y` and a velocity, so `share` would guess the PACKED body
 *  codec — which is a 2D format and would quietly drop `z`. `packed: false`
 *  below is that guess being overruled; it is the exact case `ShareOptions`
 *  warns about. */
export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** Radians. Blended shortest-arc — see `lerpPlayer`. */
  yaw: number;
  pitch: number;
  /** 1 while deployed, 0 while spectating. A number rather than a boolean so
   *  the default blend steps it instead of trying to average it. */
  live: number;
  hp: number;
  kills: number;
  deaths: number;
  name: string;
}

/** A remote player as drawn: interpolated state, plus who and which seat. */
export type RemotePlayer = Shared<PlayerState>;

/** What a host puts on the lobby channel. */
export interface MatchAd {
  code: string;
  title: string;
  players: number;
  max: number;
  /** Shared-clock ms at which the match opened, so the list can sort stably. */
  since: number;
}

/** The switches on the wall terminal: one record, owned by the room host. */
export interface RoomState {
  ambient: boolean;
  fill: boolean;
  /** Bumped by "Reset targets" so every client can notice one happened without
   *  the message having to arrive — a guest that joins late sees the count, not
   *  the event. */
  resetCount: number;
}

/** The room's typed contract. `events` travel to everyone; `requests` go to the
 *  host only, which is what makes the terminal authoritative. */
export type FpsProtocol = {
  events: {
    /** A shooter telling a victim it was hit. */
    hit: { to: string; dmg: number };
    /** A victim announcing its own death, and who gets the kill. */
    died: { by: string };
    /** A victim announcing it is back. */
    spawned: Record<string, never>;
    /** Someone pulled a trigger. Carries nothing: the listener already has the
     *  shooter's interpolated position, and a shot you hear should come from
     *  where you last SAW them rather than from a truer place you cannot see. */
    shot: Record<string, never>;
    /** A player pressing the button next to someone's name on the standings
     *  board. Carries the TARGET rather than being sent only to them, because
     *  the joke does not work in private: everyone near the victim should hear
     *  it coming out of the victim. */
    fart: { to: string };
  };
  requests: {
    /** Flip one terminal switch. The host owns the record; this asks it to. */
    toggle: { key: "ambient" | "fill" };
    /** Reset the shooting gallery for everyone. */
    resetTargets: Record<string, never>;
  };
};

// ---- blending --------------------------------------------------------------

/** Shortest-arc difference between two angles, in −π..π. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Blend two snapshots. Positions and velocities lerp; ANGLES take the short
 *  way round; everything discrete (`live`, `name`, the scores) steps to the
 *  newer value rather than being averaged into a number nobody sent. */
export function lerpPlayer(a: PlayerState, b: PlayerState, t: number): PlayerState {
  return {
    ...b,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    vx: a.vx + (b.vx - a.vx) * t,
    vz: a.vz + (b.vz - a.vz) * t,
    yaw: a.yaw + angleDelta(a.yaw, b.yaw) * t,
    pitch: a.pitch + angleDelta(a.pitch, b.pitch) * t,
  };
}

/** Cover a lost snapshot. `t` arrives above 1, so `lerpPlayer` would already
 *  project the position — but linearly through the PAIR, which overshoots a
 *  player who was accelerating. Running the last known velocity forward from
 *  the newest snapshot is both cheaper and better behaved, and it stops dead
 *  when the player was standing still. */
export function extrapolatePlayer(a: PlayerState, b: PlayerState, t: number): PlayerState {
  const blended = lerpPlayer(a, b, Math.min(t, 1));
  const ahead = Math.max(0, t - 1);
  // The pair's own span in seconds is unknown here; `maxExtrapolationMs` caps
  // how far `t` can run, so scaling velocity by the overshoot fraction of one
  // snapshot interval is the right unit.
  const seconds = (ahead * (1000 / SNAPSHOT_HZ)) / 1000;
  return {
    ...blended,
    x: blended.x + b.vx * seconds,
    z: blended.z + b.vz * seconds,
  };
}

// ---- the lobby -------------------------------------------------------------

/** A live view of the matches being advertised. */
export interface Lobby {
  /** Everyone else's adverts, newest first. Empty offline, which is correct:
   *  there is nothing to browse, and hosting still works. */
  readonly matches: MatchAd[];
  /** True once the lobby room actually connected to something. */
  readonly online: boolean;
  /** How many clients are sitting in the lobby, including us. */
  readonly here: number;
  /** Start (or update) our advert. Called every frame by a host — it only
   *  writes a field, the 2 Hz share does the sending. */
  advertise(ad: MatchAd | null): void;
  close(): void;
}

export async function openLobby(Net: NetApi, room: string): Promise<Lobby> {
  const net = await Net.game({ room });
  let mine: MatchAd | null = null;
  // A share needs a state every tick, so an empty advert is a real value rather
  // than a gap: `code: ""` is the "not hosting" sentinel, filtered on receipt.
  const empty: MatchAd = { code: "", title: "", players: 0, max: 0, since: 0 };
  const ads: SharedStates<MatchAd> = net.share(() => mine ?? empty, {
    hz: 2,
    packed: false,
    // An advert is a fact, not a trajectory: blending two of them would produce
    // a fractional player count nobody published.
    delayMs: 0,
    lerp: (_a, b) => b,
  });

  return {
    get matches() {
      return [...ads]
        .filter((ad) => ad.code !== "")
        .sort((a, b) => b.since - a.since || a.code.localeCompare(b.code));
    },
    get online() {
      return net.online;
    },
    get here() {
      return net.count;
    },
    advertise(ad) {
      mine = ad;
    },
    close() {
      ads.stop();
      net.close();
    },
  };
}

// ---- a match ---------------------------------------------------------------

export interface MatchOptions {
  code: string;
  name: string;
  /** Read the local player's state on each send tick. */
  local: () => PlayerState;
  /** Interpolation delay, live — read every time it is needed so the pause
   *  menu's slider takes effect without a reconnect. */
  delayMs: () => number;
  /** We took `dmg` damage from `from`. */
  onHit(from: string, dmg: number): void;
  /** `who` died; `by` gets the kill. Both ends learn it from the same event. */
  onDeath(who: string, by: string): void;
  /** Someone else fired, at `distance` metres from us. */
  onRemoteShot(distance: number): void;
  /** `to` has been farted at by `from`. `distance` is to the VICTIM — the sound
   *  belongs to whoever it came out of — or 0 when that victim is us. */
  onFart(from: string, to: string, distance: number): void;
}

export interface Match {
  readonly net: NetGame<FpsProtocol>;
  readonly code: string;
  /** Everyone else, interpolated and ready to draw. */
  readonly others: RemotePlayer[];
  /** Everyone including us, sorted for the scoreboard. */
  readonly roster: RemotePlayer[];
  /** The terminal's switches. Reading is free; changing goes through `toggle`. */
  readonly world: RoomState;
  /** Ask the host to flip a switch. Works when we ARE the host. */
  toggle(key: "ambient" | "fill"): void;
  /** Ask the host to reset the gallery. */
  resetTargets(): void;
  /** Fart at `id`. Costs nothing and settles nothing. */
  fart(id: string): void;
  /** Fire a ray and tell the victim, if there is one. Returns the id hit, or
   *  null. Tests against the INTERPOLATED positions — see §4 up top. */
  shoot(origin: Vec3, dir: Vec3): string | null;
  /** Announce our own death. */
  reportDeath(by: string): void;
  /** Announce our own respawn, and stop remote copies of us sweeping across the
   *  arena to the new position. */
  reportSpawn(): void;
  close(): void;
}

export async function joinMatch(Net: NetApi, opts: MatchOptions): Promise<Match> {
  const net = await Net.game<FpsProtocol>({ room: `fps-${opts.code}` });

  const others: SharedStates<PlayerState> = net.share(opts.local, {
    hz: SNAPSHOT_HZ,
    // Overruling `share`'s format guess — see `PlayerState`.
    packed: false,
    lerp: lerpPlayer,
    extrapolate: extrapolatePlayer,
    maxExtrapolationMs: MAX_EXTRAPOLATION_MS,
    // `delayMs` is read once, when the share is created; the slider therefore
    // sets the STARTING delay and a change takes effect on the next match. The
    // alternative — tearing the buffer down mid-fight — is worse than the
    // limitation.
    delayMs: opts.delayMs(),
  });

  // The switches. The host's copy is the truth; everyone else's is whatever the
  // host last broadcast, which is why `local` is only ever mutated inside a
  // request handler (host-side) and never by a guest's own click.
  const local: RoomState = { ambient: true, fill: true, resetCount: 0 };
  const world = Net.hostState<RoomState>(net.room, { state: () => local, hz: 4 });

  net.events.onRequest("toggle", ({ key }) => {
    local[key] = !local[key];
  });
  net.events.onRequest("resetTargets", () => {
    local.resetCount++;
  });

  net.events.on("hit", ({ to, dmg }, from) => {
    if (to !== net.id) return; // a hit on someone else, overheard on the mesh
    opts.onHit(from, dmg);
  });
  net.events.on("died", ({ by }, from) => opts.onDeath(from, by));
  // A respawn is a teleport, and a teleport through an interpolation buffer is
  // a smooth 20-metre glide across the arena. Dropping that peer's snapshots
  // makes their next one SNAP, which is what a respawn should look like.
  net.events.on("spawned", (_data, from) => others.snap(from));
  net.events.on("shot", (_data, from) => {
    const shooter = [...others].find((o) => o.id === from);
    if (!shooter) return;
    const me = opts.local();
    opts.onRemoteShot(Math.hypot(shooter.x - me.x, shooter.y - me.y, shooter.z - me.z));
  });

  net.events.on("fart", ({ to }, from) => {
    const me = opts.local();
    // Distance to the VICTIM, not to the sender: the sound is the victim's.
    // Zero when the victim is us, which is the one case that plays at full
    // volume — being farted at should be unmissable.
    if (to === net.id) return opts.onFart(from, to, 0);
    const victim = [...others].find((o) => o.id === to);
    if (!victim) return;
    opts.onFart(from, to, Math.hypot(victim.x - me.x, victim.y - me.y, victim.z - me.z));
  });

  const bodyBox: Box = { x: 0, y: 0, z: 0, ...PLAYER_HALF };

  return {
    net,
    code: opts.code,
    get others() {
      return [...others];
    },
    get roster() {
      const me = opts.local();
      const mine: RemotePlayer = Object.assign({ ...me }, { id: net.id, index: net.index });
      return [mine, ...others].sort(
        (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.index - b.index,
      );
    },
    get world() {
      return world.value;
    },
    toggle(key) {
      net.events.request("toggle", { key });
    },
    fart(id) {
      net.events.emit("fart", { to: id });
      // The sender's own emit does not come back to them, so play it here.
      // Same path as everyone else's: the victim is somewhere out there, so it
      // is heard at the victim's distance, not at zero.
      const me = opts.local();
      const victim = [...others].find((o) => o.id === id);
      opts.onFart(
        net.id,
        id,
        victim ? Math.hypot(victim.x - me.x, victim.y - me.y, victim.z - me.z) : 0,
      );
    },
    resetTargets() {
      net.events.request("resetTargets", {});
    },
    shoot(origin, dir) {
      // Announced whether or not it connects — the room hears the gun, not the
      // outcome.
      net.events.emit("shot", {});
      // Clip to cover first: a shot that would hit a wall before a player is a
      // miss, and testing players first is how you shoot through crates.
      const maxRange = Math.min(wallDistance(origin, dir), MAX_SHOT_RANGE);
      let bestT = maxRange;
      let bestId: string | null = null;
      for (const other of others) {
        if (other.live !== 1 || other.hp <= 0) continue;
        // The rendered position — already `delayMs` in the past, which IS the
        // lag compensation. Testing against `others.latest(id)` instead would
        // hit-test a body nobody has been shown yet.
        bodyBox.x = other.x;
        // The shared `y` is the EYE; the body hangs below it.
        bodyBox.y = other.y - (PLAYER_HALF.hy - 0.55);
        bodyBox.z = other.z;
        const t = rayBox(origin, dir, bodyBox);
        if (t < bestT) {
          bestT = t;
          bestId = other.id;
        }
      }
      if (bestId) net.events.emit("hit", { to: bestId, dmg: SHOT_DAMAGE });
      return bestId;
    },
    reportDeath(by) {
      net.events.emit("died", { by });
    },
    reportSpawn() {
      // Everyone who hears this clears OUR buffer on their machine, so our
      // teleport lands as a jump rather than a glide. There is no way to reach
      // into a peer's buffer directly, and there does not need to be: the
      // announcement is already reliable.
      net.events.emit("spawned", {});
    },
    close() {
      others.stop();
      world.stop();
      net.close();
    },
  };
}

/** Whether a claimed hit could physically have happened. Advisory in a peer
 *  mesh — the shooter has already decided — but it is the line a client/server
 *  build would move to the server, so it exists and is called. */
export function plausible(me: Vec3, shooter: RemotePlayer | undefined): boolean {
  if (!shooter) return true; // never heard from them; nothing to check against
  return Math.hypot(me.x - shooter.x, me.y - shooter.y, me.z - shooter.z) <= MAX_SHOT_RANGE;
}
