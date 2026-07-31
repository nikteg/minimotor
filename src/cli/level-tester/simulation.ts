import * as Collision from "@src/collision/index.js";
import * as Mathf from "@src/math/mathf.js";
import type { LadderSource, Solid, SolidSource } from "@src/collision/index.js";
import type { Rect } from "@src/engine/app.js";
import type { GeneratedAbilities } from "@src/cli/features/level.js";

export const TILE = 16;
export const PLAYER_W = 12;
export const PLAYER_H = 24;
const MOVE = 1.5;
const ACCEL = 0.2;
const GRAVITY = 0.25;
const JUMP = -5;
const JUMP_CUTOFF = 0.45;
const WALL_SLIDE = 0.7;
const WALL_JUMP_X = 2.25;
const CLIMB_SPEED = 1.5;
const DASH_SPEED = 5;
const DASH_STEPS = 8;

export interface SimulationLevel {
  width: number;
  height: number;
  grid: string[];
  abilities: GeneratedAbilities;
}

export interface SimulationAction {
  left?: boolean;
  right?: boolean;
  up?: boolean;
  down?: boolean;
  jumpPressed?: boolean;
  jumpReleased?: boolean;
  dashPressed?: boolean;
}

export interface SimulationGem {
  x: number;
  y: number;
  taken: boolean;
}

export interface SimulationStats {
  steps: number;
  deaths: number;
  jumps: number;
  dashes: number;
  doubleJumps: number;
  wallJumps: number;
  gems: number;
  maxX: number;
  completed: boolean;
  completionSteps: number;
}

export interface SimulationSnapshot {
  player: {
    x: number;
    y: number;
    velX: number;
    velY: number;
    grounded: boolean;
    facing: number;
  };
  climbing: boolean;
  wallDir: number;
  wallCoyote: number;
  dashSteps: number;
  dashReady: boolean;
  airJumps: number;
  gems: boolean[];
  stats: SimulationStats;
}

export interface PlatformerSimulation {
  readonly source: SimulationLevel;
  readonly level: SimulationCollisionLevel;
  readonly player: {
    x: number;
    y: number;
    w: number;
    h: number;
    vel: { x: number; y: number };
    grounded: boolean;
    facing: number;
  };
  readonly gems: SimulationGem[];
  readonly exit: { x: number; y: number };
  readonly stats: SimulationStats;
  readonly climbing: boolean;
  readonly dashing: boolean;
  reset(countDeath?: boolean): void;
  step(action?: SimulationAction): void;
  snapshot(): SimulationSnapshot;
  restore(snapshot: SimulationSnapshot): void;
}

export interface SimulationCollisionLevel extends SolidSource, LadderSource {
  readonly rect: Rect;
}

const freshStats = (): SimulationStats => ({
  steps: 0,
  deaths: 0,
  jumps: 0,
  dashes: 0,
  doubleJumps: 0,
  wallJumps: 0,
  gems: 0,
  maxX: 0,
  completed: false,
  completionSteps: 0,
});

/** Exact headless movement simulation shared by the tester UI and bot runners. */
export function createPlatformerSimulation(source: SimulationLevel): PlatformerSimulation {
  const solids: Solid[] = [];
  const ladders: Rect[] = [];
  const markers = new Map<string, { x: number; y: number }[]>();
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const glyph = source.grid[y]?.[x] ?? ".";
      const rect = { x: x * TILE, y: y * TILE, w: TILE, h: TILE };
      if (glyph === "#") solids.push(rect);
      else if (glyph === "=") solids.push({ ...rect, oneWay: true });
      else if (glyph === "H") {
        ladders.push(rect);
        if (source.grid[y - 1]?.[x] !== "H") solids.push({ ...rect, oneWay: true });
      } else if (glyph !== ".") {
        const list = markers.get(glyph) ?? [];
        list.push({ x: rect.x + TILE / 2, y: rect.y + TILE / 2 });
        markers.set(glyph, list);
      }
    }
  }
  const broadphase = Collision.grid(solids, TILE * 2);
  const level: SimulationCollisionLevel = {
    rect: { x: 0, y: 0, w: source.width * TILE, h: source.height * TILE },
    solidsNear(area, out) {
      return broadphase.solidsNear(area, out);
    },
    laddersNear(area, out) {
      for (const ladder of ladders) {
        if (
          area.x < ladder.x + ladder.w &&
          area.x + area.w > ladder.x &&
          area.y < ladder.y + ladder.h &&
          area.y + area.h > ladder.y
        ) {
          out.push(ladder);
        }
      }
      return out;
    },
  };
  const one = (glyph: string) => {
    const values = markers.get(glyph) ?? [];
    if (values.length !== 1)
      throw new Error(`expected one "${glyph}" marker, found ${values.length}`);
    return values[0];
  };
  const spawn = one("P");
  const exit = one("E");
  const gems = (markers.get("G") ?? []).map((gem) => ({ ...gem, taken: false }));
  const player = {
    x: 0,
    y: 0,
    w: PLAYER_W,
    h: PLAYER_H,
    vel: { x: 0, y: 0 },
    grounded: false,
    facing: 1,
  };
  const stats = freshStats();
  let climbing = false;
  let wallDir = 0;
  let wallCoyote = 0;
  let dashSteps = 0;
  let dashReady = true;
  let airJumps = 0;

  const reset = (countDeath = false): void => {
    if (countDeath) stats.deaths++;
    player.x = spawn.x - PLAYER_W / 2;
    player.y = spawn.y + TILE / 2 - PLAYER_H;
    player.vel.x = 0;
    player.vel.y = 0;
    player.grounded = false;
    climbing = false;
    wallCoyote = 0;
    dashSteps = 0;
    dashReady = true;
    airJumps = source.abilities.doubleJump ? 1 : 0;
  };

  const step = (action: SimulationAction = {}): void => {
    if (stats.completed) return;
    stats.steps++;
    const run = Number(action.right === true) - Number(action.left === true);
    const climbAxis = Number(action.down === true) - Number(action.up === true);
    const ladderJump = climbing && action.jumpPressed === true && action.up !== true;

    if (ladderJump) {
      climbing = false;
      player.vel.y = JUMP * 0.85;
      stats.jumps++;
    } else {
      climbing = Collision.climbLadder(player, level, climbAxis, {
        active: climbing,
        autoGrab: true,
        speed: CLIMB_SPEED,
        horizontal: run,
      });
    }

    if (source.abilities.dash && action.dashPressed && dashReady && !climbing) {
      dashSteps = DASH_STEPS;
      dashReady = false;
      player.vel.x = player.facing * DASH_SPEED;
      player.vel.y = 0;
      stats.dashes++;
    }

    if (dashSteps > 0) {
      dashSteps--;
      player.vel.x = player.facing * DASH_SPEED;
      player.vel.y = 0;
    } else if (climbing) {
      player.vel.x = Mathf.approach(player.vel.x, 0, ACCEL * 2);
      if (climbAxis > 0) Collision.dropThrough(player, level);
    } else {
      player.vel.x = Mathf.approach(player.vel.x, run * MOVE, ACCEL);
      player.vel.y += GRAVITY;
    }

    const dropping = !climbing && action.down === true && Collision.dropThrough(player, level);
    if (!dropping && !climbing && action.jumpPressed && player.grounded) {
      player.vel.y = JUMP;
      stats.jumps++;
    } else if (
      !dropping &&
      !climbing &&
      action.jumpPressed &&
      !player.grounded &&
      source.abilities.wallJump &&
      wallCoyote > 0
    ) {
      player.vel.y = JUMP * 0.9;
      player.vel.x = -wallDir * WALL_JUMP_X;
      player.facing = -wallDir;
      wallCoyote = 0;
      stats.jumps++;
      stats.wallJumps++;
    } else if (
      !dropping &&
      !climbing &&
      action.jumpPressed &&
      !player.grounded &&
      source.abilities.doubleJump &&
      airJumps > 0
    ) {
      player.vel.y = JUMP;
      airJumps--;
      stats.jumps++;
      stats.doubleJumps++;
    }
    if (action.jumpReleased && player.vel.y < 0 && !climbing && dashSteps === 0) {
      player.vel.y *= JUMP_CUTOFF;
    }

    const hit = Collision.moveAndSlide(player, level);
    player.x = Math.max(0, Math.min(player.x, level.rect.w - player.w));
    if (player.grounded) {
      dashReady = true;
      airJumps = source.abilities.doubleJump ? 1 : 0;
    }

    if (source.abilities.wallJump && !player.grounded && !climbing && (hit.left || hit.right)) {
      wallDir = hit.left ? -1 : 1;
      wallCoyote = 7;
      if (run === wallDir && player.vel.y > WALL_SLIDE) player.vel.y = WALL_SLIDE;
    } else if (wallCoyote > 0) {
      wallCoyote--;
    }

    if (run !== 0 && dashSteps === 0) player.facing = Math.sign(run);
    if (player.y > level.rect.h + 20) reset(true);

    stats.maxX = Math.max(stats.maxX, player.x / TILE);
    for (const gem of gems) {
      if (!gem.taken && Collision.circleRect(gem.x, gem.y, 6, player)) {
        gem.taken = true;
        stats.gems++;
      }
    }
    if (Collision.circleRect(exit.x, exit.y, 8, player)) {
      stats.completed = true;
      stats.completionSteps = stats.steps;
    }
  };

  const snapshot = (): SimulationSnapshot => ({
    player: {
      x: player.x,
      y: player.y,
      velX: player.vel.x,
      velY: player.vel.y,
      grounded: player.grounded,
      facing: player.facing,
    },
    climbing,
    wallDir,
    wallCoyote,
    dashSteps,
    dashReady,
    airJumps,
    gems: gems.map((gem) => gem.taken),
    stats: { ...stats },
  });

  const restore = (state: SimulationSnapshot): void => {
    player.x = state.player.x;
    player.y = state.player.y;
    player.vel.x = state.player.velX;
    player.vel.y = state.player.velY;
    player.grounded = state.player.grounded;
    player.facing = state.player.facing;
    climbing = state.climbing;
    wallDir = state.wallDir;
    wallCoyote = state.wallCoyote;
    dashSteps = state.dashSteps;
    dashReady = state.dashReady;
    airJumps = state.airJumps;
    for (let index = 0; index < gems.length; index++)
      gems[index].taken = state.gems[index] ?? false;
    Object.assign(stats, state.stats);
  };

  reset();
  return {
    source,
    level,
    player,
    gems,
    exit,
    stats,
    get climbing() {
      return climbing;
    },
    get dashing() {
      return dashSteps > 0;
    },
    reset,
    step,
    snapshot,
    restore,
  };
}
