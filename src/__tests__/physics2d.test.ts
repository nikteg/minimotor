import { describe, expect, it } from "vitest";
import { create as ecsWorld } from "../ecs/index.js";
import { Sprite } from "../sprites.js";
import { attach, Phys, world } from "../physics2d.js";

const STEP = 1000 / 60;
const run = (phys: ReturnType<typeof world>, steps: number) => {
  for (let i = 0; i < steps; i++) phys.step(STEP);
};

describe("Physics2D", () => {
  it("drops a dynamic box onto a static floor and comes to rest on top", () => {
    const phys = world();
    phys.box(200, 380, 400, 40, { type: "static" }); // floor, top edge at y=360
    const crate = phys.box(200, 100, 40, 40);
    run(phys, 180); // 3 s — plenty to fall and settle
    // Rests with its bottom on the floor top: center ≈ 360 - 20. Box2D keeps a
    // small overlap slop, so allow a couple of px.
    expect(crate.y).toBeGreaterThan(335);
    expect(crate.y).toBeLessThan(345);
    expect(crate.awake).toBe(false); // solver put it to sleep
    crate.wake();
    expect(crate.awake).toBe(true);
  });

  it("bounces with restitution and doesn't without", () => {
    const bouncy = world();
    bouncy.box(200, 380, 400, 40, { type: "static" });
    const ball = bouncy.circle(200, 200, 10, { restitution: 0.8 });
    let rose = false;
    for (let i = 0; i < 240; i++) {
      bouncy.step(STEP);
      if (ball.vy < -50) rose = true; // moving up after a bounce
    }
    expect(rose).toBe(true);

    const dead = world();
    dead.box(200, 380, 400, 40, { type: "static" });
    const brick = dead.circle(200, 200, 10, { restitution: 0 });
    let roseDead = false;
    for (let i = 0; i < 240; i++) {
      dead.step(STEP);
      if (brick.vy < -50) roseDead = true;
    }
    expect(roseDead).toBe(false);
  });

  it("walls contain a fast body and appear as Body2D in contacts", () => {
    const phys = world({ gravity: { x: 0, y: 0 } });
    phys.walls(0, 0, 400, 300);
    const ball = phys.circle(200, 150, 10, { restitution: 1, bullet: true });
    let sawNull = false;
    phys.onContact((a, b) => {
      if (!a || !b || typeof a.vx !== "number" || typeof b.vx !== "number") sawNull = true;
    });
    ball.vx = 900;
    ball.vy = 700;
    for (let i = 0; i < 600; i++) {
      phys.step(STEP);
      expect(ball.x).toBeGreaterThan(0);
      expect(ball.x).toBeLessThan(400);
      expect(ball.y).toBeGreaterThan(0);
      expect(ball.y).toBeLessThan(300);
    }
    expect(sawNull).toBe(false);
  });

  it("positions and velocities round-trip in pixels", () => {
    const phys = world({ gravity: { x: 0, y: 0 } });
    const b = phys.box(100, 50, 20, 20);
    expect(b.x).toBeCloseTo(100);
    expect(b.y).toBeCloseTo(50);
    b.x = 250;
    b.y = 130;
    b.vx = 60;
    b.vy = -30;
    b.rot = Math.PI / 4;
    b.spin = 2;
    expect(b.x).toBeCloseTo(250);
    expect(b.y).toBeCloseTo(130);
    expect(b.vx).toBeCloseTo(60);
    expect(b.vy).toBeCloseTo(-30);
    expect(b.rot).toBeCloseTo(Math.PI / 4);
    expect(b.spin).toBeCloseTo(2);
    phys.step(STEP); // gravity-free: velocity moves it
    expect(b.x).toBeCloseTo(251, 0);
  });

  it("fires onContact with the wrapped bodies and honors unsubscribe", () => {
    const phys = world();
    const floor = phys.box(200, 380, 400, 40, { type: "static", data: "floor" });
    const crate = phys.box(200, 300, 40, 40, { data: "crate" });
    const seen: string[] = [];
    const off = phys.onContact((a, b) => {
      seen.push(`${a.data}~${b.data}`);
    });
    run(phys, 120);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatch(/floor|crate/);
    expect([floor.data, crate.data]).toEqual(["floor", "crate"]);

    off();
    const before = seen.length;
    crate.applyImpulse(0, -40); // pop it up so it lands again
    run(phys, 120);
    expect(seen.length).toBe(before);
  });

  it("defers destroy() called inside a contact callback", () => {
    const phys = world();
    phys.box(200, 380, 400, 40, { type: "static" });
    const crate = phys.box(200, 300, 40, 40, { data: "doomed" });
    phys.onContact((a, b) => {
      // Destroying mid-step would trip Box2D's world lock; the adapter defers.
      if (a.data === "doomed") a.destroy();
      if (b.data === "doomed") b.destroy();
    });
    const before = phys.count;
    expect(() => run(phys, 120)).not.toThrow();
    expect(phys.count).toBe(before - 1);
    expect(crate.data).toBe("doomed"); // wrapper still readable after removal
  });

  it("pin() hinges bodies and motor() drives the joint", () => {
    const phys = world({ gravity: { x: 0, y: 0 } });
    const anchor = phys.box(200, 150, 10, 10, { type: "static" });
    const plank = phys.box(200, 150, 120, 10);
    const hinge = phys.pin(anchor, plank, 200, 150);
    hinge.motor(3, 5000);
    run(phys, 60);
    expect(plank.spin).toBeGreaterThan(1); // spinning around the pin
    expect(plank.x).toBeCloseTo(200, 0); // but not going anywhere
    hinge.destroy();
    expect(() => run(phys, 10)).not.toThrow();
  });

  it("walls.set() sweeps stranded bodies back inside instead of teleporting", () => {
    const phys = world();
    const frame = phys.walls(0, 0, 800, 300);
    const stray = phys.circle(700, 150, 12); // beyond the future right wall
    const resident = phys.circle(350, 150, 12); // already inside, stays
    run(phys, 180); // both settle on the floor and fall asleep
    expect(stray.x).toBeCloseTo(700, 0);
    expect(stray.awake).toBe(false);

    frame.set(0, 0, 400, 300); // window shrank — right wall glides 400px left
    // 400px at 1200px/s ≈ 0.33s; give it 2s to sweep and re-settle.
    run(phys, 120);
    expect(stray.x).toBeLessThan(400 - 11); // pushed inside the new arena
    expect(stray.x).toBeGreaterThan(0);
    expect(resident.x).toBeGreaterThan(0); // neighbor shoved, not overlapped
    expect(resident.x).toBeLessThan(400);
    // No two bodies interpenetrate once settled.
    run(phys, 120);
    const gap = Math.abs(stray.x - resident.x);
    expect(gap).toBeGreaterThan(22); // sum of radii minus slop
  });

  it("attach() steps the sim and syncs Sprite transforms via the ECS", () => {
    const ecs = ecsWorld();
    const phys = world();
    attach(ecs, phys);
    phys.box(200, 380, 400, 40, { type: "static" });
    const body = phys.box(200, 100, 40, 40);
    const img = {} as CanvasImageSource;
    ecs.spawn(Sprite.with({ x: 0, y: 0, img }), Phys.with({ body }));

    for (let i = 0; i < 180; i++) ecs.update(); // systems drive phys.step
    const [[, sprite]] = [...ecs.query(Sprite)];
    expect(sprite.y).toBeCloseTo(body.y);
    expect(sprite.y).toBeGreaterThan(335); // fell and rests on the floor
    expect(sprite.rot).toBe(body.rot);
    expect(sprite.alpha).toBeUndefined(); // transforms only — styling is yours
  });

  it("scales gravity by pixelsPerMeter consistently", () => {
    // Same px-space setup at two scales should land at ~the same px position.
    const a = world({ pixelsPerMeter: 30 });
    const b = world({ pixelsPerMeter: 100 });
    const boxA = a.box(100, 0, 20, 20);
    const boxB = b.box(100, 0, 20, 20);
    run(a, 30);
    run(b, 30);
    expect(boxA.y).toBeCloseTo(boxB.y, 0);
  });
});

describe("Physics2D.raycast", () => {
  // A gravity-free world so bodies stay exactly where they're put.
  const still = () => world({ gravity: { x: 0, y: 0 } });

  it("returns the nearest hit, in px, with the surface normal facing the ray", () => {
    const phys = still();
    phys.box(300, 0, 20, 200, { type: "static" }); // far wall
    const near = phys.box(100, 0, 20, 200, { type: "static" }); // near wall

    const hit = phys.raycast(0, 0, 400, 0);
    expect(hit).not.toBeNull();
    expect(hit!.body).toBe(near); // nearest, not merely the last visited
    expect(hit!.x).toBeCloseTo(90, 5); // left face of the near wall
    expect(hit!.y).toBeCloseTo(0, 5);
    expect(hit!.nx).toBeCloseTo(-1, 5); // points back down the ray
    expect(hit!.ny).toBeCloseTo(0, 5);
    expect(hit!.distance).toBeCloseTo(90, 5);
    expect(hit!.fraction).toBeCloseTo(90 / 400, 5);
  });

  it("returns null when the line is clear, and for a zero-length ray", () => {
    const phys = still();
    phys.box(300, 0, 20, 20, { type: "static" });
    expect(phys.raycast(0, 100, 400, 100)).toBeNull(); // passes below
    expect(phys.raycast(0, 0, 0, 0)).toBeNull(); // no direction to cast
  });

  it("skips sensors unless asked, and honours the body filter", () => {
    const phys = still();
    const trigger = phys.box(100, 0, 20, 200, { type: "static", isSensor: true });
    const wall = phys.box(200, 0, 20, 200, { type: "static" });

    expect(phys.raycast(0, 0, 400, 0)!.body).toBe(wall); // sensor is see-through
    expect(phys.raycast(0, 0, 400, 0, { sensors: true })!.body).toBe(trigger);
    // The classic "don't shoot yourself" filter.
    expect(phys.raycast(0, 0, 400, 0, { filter: (b) => b !== wall })).toBeNull();
  });

  it("reuses one result object — copy what you keep", () => {
    const phys = still();
    phys.box(100, 0, 20, 200, { type: "static" });
    phys.box(100, 300, 20, 200, { type: "static" });
    const first = phys.raycast(0, 0, 400, 0)!;
    const x = first.x;
    const second = phys.raycast(0, 300, 400, 300)!;
    expect(second).toBe(first); // same object, rewritten
    expect(first.y).toBe(300); // …so the earlier read is gone
    expect(x).toBeCloseTo(90, 5); // the copied number survives
  });

  it("raycastAll collects every body along the ray, nearest first, as fresh objects", () => {
    const phys = still();
    const a = phys.box(100, 0, 20, 200, { type: "static" });
    const b = phys.box(200, 0, 20, 200, { type: "static" });
    const c = phys.box(300, 0, 20, 200, { type: "static" });

    const hits = phys.raycastAll(0, 0, 400, 0);
    expect(hits.map((h) => h.body)).toEqual([a, b, c]);
    expect(hits[0].x).toBeCloseTo(90, 5);
    expect(hits[1].x).toBeCloseTo(190, 5);
    expect(hits[2].x).toBeCloseTo(290, 5);
    expect(hits[0]).not.toBe(hits[1]); // independent objects, safe to keep
  });
});

describe("Physics2D sensors and filtering", () => {
  it("a sensor reports contact but doesn't stop anything", () => {
    const phys = world();
    const zone = phys.box(200, 300, 200, 20, { type: "static", isSensor: true });
    const ball = phys.circle(200, 100, 10);
    let entered: unknown = null;
    phys.onContact((a, b) => {
      if (a === zone || b === zone) entered = a === zone ? b : a;
    });
    run(phys, 120);
    expect(entered).toBe(ball); // it fired…
    expect(ball.y).toBeGreaterThan(400); // …and the ball fell straight through
  });

  it("exposes `sensor` as a live property, so a solid can become passable", () => {
    const phys = world();
    const floor = phys.box(200, 380, 400, 40, { type: "static" });
    expect(floor.sensor).toBe(false);
    const crate = phys.box(200, 100, 40, 40);
    run(phys, 120);
    expect(crate.y).toBeLessThan(360); // resting on the floor
    floor.sensor = true; // the floor opens up
    crate.wake();
    run(phys, 120);
    expect(crate.y).toBeGreaterThan(500); // fell through
  });

  it("category/mask keeps bodies on separate layers", () => {
    const PLAYER = 0x0002;
    const ENEMY = 0x0004;
    const GROUND = 0x0001;
    const phys = world();
    // The floor collides with everything; the two movers ignore each other.
    phys.box(200, 380, 400, 40, { type: "static" });
    const player = phys.box(200, 100, 40, 40, { category: PLAYER, mask: GROUND });
    const enemy = phys.box(200, 100, 40, 40, { category: ENEMY, mask: GROUND });
    run(phys, 180);
    // Spawned in the exact same spot: without filtering one would be shoved
    // aside. Both land on the floor, still stacked on the same x.
    expect(player.x).toBeCloseTo(200, 1);
    expect(enemy.x).toBeCloseTo(200, 1);
    expect(player.y).toBeCloseTo(enemy.y, 1);
    expect(player.y).toBeLessThan(360); // …and both stopped at the floor
  });

  it("a negative group never self-collides, whatever the mask says", () => {
    const phys = world();
    phys.box(200, 380, 400, 40, { type: "static", group: 0 });
    const a = phys.box(200, 100, 40, 40, { group: -1 });
    const b = phys.box(200, 100, 40, 40, { group: -1 });
    run(phys, 180);
    expect(a.y).toBeCloseTo(b.y, 1); // passed through each other, both on floor
  });
});

describe("Physics2D.onContactEnd", () => {
  it("fires when two bodies separate", () => {
    const phys = world();
    phys.box(200, 380, 400, 40, { type: "static" });
    phys.circle(200, 300, 10, { restitution: 0.9 });
    let begins = 0;
    let ends = 0;
    phys.onContact(() => begins++);
    const off = phys.onContactEnd(() => ends++);
    run(phys, 120);
    expect(begins).toBeGreaterThan(0);
    expect(ends).toBeGreaterThan(0); // bounced back off the floor

    const wasEnds = ends;
    off();
    run(phys, 120);
    expect(ends).toBe(wasEnds); // unsubscribed
  });
});

describe("Physics2D destroy safety", () => {
  it("destroying a pin from inside a contact callback is deferred, and is idempotent", () => {
    const phys = world();
    const anchor = phys.box(200, 100, 20, 20, { type: "static" });
    const arm = phys.box(240, 100, 40, 20);
    const pin = phys.pin(anchor, arm, 200, 100);
    phys.box(200, 380, 400, 40, { type: "static" }); // floor to fall onto
    const weight = phys.box(240, 20, 20, 20); // dropped on the arm to trigger a contact

    let threw: unknown = null;
    let fired = false;
    phys.onContact((a, b) => {
      if (a !== weight && b !== weight) return;
      fired = true;
      try {
        pin.destroy(); // the world is locked inside a contact callback
      } catch (e) {
        threw = e;
      }
    });
    run(phys, 240);
    expect(fired).toBe(true);
    expect(threw).toBeNull();
    pin.destroy(); // second call is a no-op, not a double free
    expect(arm.y).toBeGreaterThan(300); // the arm let go and fell to the floor
  });
});

describe("Physics2D shapes", () => {
  it("drops a polygon onto the floor and takes the convex hull of its points", () => {
    const phys = world();
    phys.box(200, 380, 400, 40, { type: "static" }); // floor top at y=360
    // A triangle, points given clockwise on screen — winding is Box2D's problem.
    const tri = phys.polygon(200, 100, [
      { x: 0, y: -20 },
      { x: 20, y: 20 },
      { x: -20, y: 20 },
    ]);
    run(phys, 180);
    expect(tri.y).toBeGreaterThan(330); // landed, flat side down
    expect(tri.y).toBeLessThan(345);

    // Hull, not bounding box: the corner beside the apex is outside the shape.
    const still = phys.polygon(
      600,
      100,
      [
        { x: 0, y: -20 },
        { x: 20, y: 20 },
        { x: -20, y: 20 },
      ],
      {
        type: "static",
      },
    );
    expect(phys.pointPick(600, 110)).toBe(still); // inside, near the base
    expect(phys.pointPick(618, 82)).toBeNull(); // in the box, outside the triangle
  });

  it("catches a falling body on a chain and lets it roll downhill", () => {
    const phys = world();
    // A ramp descending to the right: y 200 at x 0, y 400 at x 600.
    phys.chain([
      { x: 0, y: 200 },
      { x: 600, y: 400 },
    ]);
    // `bullet`, because a chain has no thickness: a fast body meeting one
    // without continuous collision goes straight through.
    const ball = phys.circle(100, 150, 10, { friction: 0.1, bullet: true });
    // Riding the surface = sitting one radius above the ramp line under it.
    const ride = () => Math.abs(ball.y - (200 + (ball.x / 600) * 200 - 10));

    run(phys, 45);
    expect(ride()).toBeLessThan(15); // caught by the chain, not fallen through
    const x0 = ball.x;
    run(phys, 45);
    expect(ball.x).toBeGreaterThan(x0); // and it runs down the slope…
    expect(ride()).toBeLessThan(15); // …still on it
  });
});

describe("Physics2D joints", () => {
  it("hangs a body from a rope and winches it in", () => {
    const phys = world();
    const anchor = phys.box(200, 100, 10, 10, { type: "static" });
    const load = phys.box(200, 250, 20, 20);
    const rope = phys.rope(anchor, load); // holds the current 150px gap
    run(phys, 180);
    expect(load.y - anchor.y).toBeGreaterThan(140);
    expect(load.y - anchor.y).toBeLessThan(160);

    rope.setLength(60);
    run(phys, 180);
    expect(load.y - anchor.y).toBeLessThan(75);

    rope.destroy();
    rope.destroy(); // idempotent
    run(phys, 120);
    expect(load.y - anchor.y).toBeGreaterThan(200); // cut loose, it falls
  });

  it("drives a lift along its axis and stops at the limit", () => {
    const phys = world({ gravity: { x: 0, y: 0 } });
    const ground = phys.box(200, 400, 10, 10, { type: "static" });
    const platform = phys.box(200, 400, 80, 12, { type: "dynamic" });
    const lift = phys.slider(ground, platform, 0, -1, { min: 0, max: 200 });
    expect(lift.travel).toBeCloseTo(0, 1);

    lift.motor(120); // rise at 120 px/s
    run(phys, 60); // 1 s
    expect(platform.y).toBeLessThan(300); // moved up…
    expect(platform.x).toBeCloseTo(200, 1); // …and nowhere else

    run(phys, 180); // long enough to run past the limit
    expect(lift.travel).toBeLessThanOrEqual(201);
    expect(platform.y).toBeGreaterThan(195);
  });

  it("welds two bodies into one, until the weld is destroyed", () => {
    const phys = world();
    const a = phys.box(200, 100, 20, 20);
    const b = phys.box(240, 100, 20, 20);
    const seam = phys.weld(a, b, 220, 100);
    run(phys, 120);
    // They fell together, keeping their relative offset.
    expect(b.x - a.x).toBeGreaterThan(35);
    expect(b.x - a.x).toBeLessThan(45);
    expect(Math.abs(b.y - a.y)).toBeLessThan(5);

    seam.destroy();
    a.applyImpulse(-4000, 0);
    run(phys, 120);
    expect(b.x - a.x).toBeGreaterThan(60); // free to drift apart
  });
});

describe("Physics2D world queries", () => {
  it("queryAABB returns the bodies overlapping the rect, and nothing else", () => {
    const phys = world({ gravity: { x: 0, y: 0 } });
    const inside = phys.box(100, 100, 20, 20, { data: "inside" });
    const edge = phys.box(155, 100, 20, 20, { data: "edge" }); // spans x 145..165
    const outside = phys.box(400, 400, 20, 20, { data: "outside" });
    const trigger = phys.box(110, 110, 20, 20, { isSensor: true, data: "trigger" });

    const found = phys.queryAABB(50, 50, 100, 100); // x 50..150, y 50..150
    expect(found).toContain(inside);
    expect(found).toContain(edge); // its box reaches into the rect
    expect(found).not.toContain(outside);
    expect(found).not.toContain(trigger); // sensors are out by default

    expect(phys.queryAABB(50, 50, 100, 100, { sensors: true })).toContain(trigger);
    expect(phys.queryAABB(50, 50, 100, 100, { filter: (b) => b.data !== "edge" })).not.toContain(
      edge,
    );
    // A rect in empty space finds nothing — the broadphase pads its proxies, so
    // this is the assertion that the tight re-test actually runs.
    expect(phys.queryAABB(250, 250, 20, 20)).toEqual([]);
  });

  it("pointPick is exact, and prefers the crate over the floor it rests on", () => {
    const phys = world();
    const floor = phys.box(200, 380, 400, 40, { type: "static" });
    const crate = phys.box(200, 100, 40, 40);
    run(phys, 180); // the crate falls and settles on the floor

    expect(phys.pointPick(200, crate.y)).toBe(crate);
    // The crate's feet sit inside the floor's fat proxy; the dynamic body wins.
    expect(phys.pointPick(200, crate.y + 19)).toBe(crate);
    expect(phys.pointPick(50, 380)).toBe(floor);
    expect(phys.pointPick(50, 50)).toBeNull();

    // Exact, not bounding-box: a circle's corner is a miss.
    const ball = phys.circle(600, 100, 20, { type: "static" });
    expect(phys.pointPick(600, 100)).toBe(ball);
    expect(phys.pointPick(617, 117)).toBeNull(); // inside the box, outside the disc
  });
});

describe("Physics2D drag", () => {
  it("pulls a body toward the pointer and lets go", () => {
    const phys = world({ gravity: { x: 0, y: 0 } });
    const crate = phys.box(100, 100, 40, 40);
    const grab = phys.drag(100, 100);
    expect(grab).not.toBeNull();
    expect(grab!.body).toBe(crate);

    grab!.move(300, 100);
    run(phys, 120);
    expect(crate.x).toBeGreaterThan(280);
    expect(crate.x).toBeLessThan(320);

    // Released, it coasts on instead of being held at the target.
    grab!.release();
    const x = crate.x;
    run(phys, 60);
    expect(crate.x).toBeGreaterThanOrEqual(x - 1);
    grab!.release(); // idempotent, not a double free
  });

  it("grabs nothing on empty space or on static scenery", () => {
    const phys = world({ gravity: { x: 0, y: 0 } });
    phys.box(200, 380, 400, 40, { type: "static" });
    expect(phys.drag(50, 50)).toBeNull(); // nothing there
    expect(phys.drag(200, 380)).toBeNull(); // a spring can't move a static body
  });

  it("drags through the world rather than teleporting past it", () => {
    // A wall between the crate and the pointer: a teleporting drag would put
    // the crate on the far side, a spring leaves it stopped against the wall.
    const phys = world({ gravity: { x: 0, y: 0 } });
    const crate = phys.box(100, 100, 40, 40);
    phys.box(200, 100, 20, 200, { type: "static" }); // wall at x 190..210
    const grab = phys.drag(100, 100)!;
    grab.move(400, 100);
    run(phys, 180);
    expect(crate.x).toBeLessThan(190); // stopped at the wall
    grab.release();
  });

  it("survives the body being destroyed mid-drag", () => {
    const phys = world({ gravity: { x: 0, y: 0 } });
    const crate = phys.box(100, 100, 40, 40);
    const grab = phys.drag(100, 100)!;
    grab.move(200, 100);
    run(phys, 10);
    crate.destroy();
    run(phys, 10);
    expect(() => {
      grab.move(300, 100);
      grab.release();
    }).not.toThrow();
  });
});
