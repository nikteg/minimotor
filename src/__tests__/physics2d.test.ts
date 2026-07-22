import { describe, expect, it } from "vitest";
import { create as ecsWorld, Sprite } from "../ecs/index.js";
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
