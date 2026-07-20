import { describe, expect, it } from "vitest";
import { world } from "./physics2d.js";

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

  it("walls contain a fast body", () => {
    const phys = world({ gravity: { x: 0, y: 0 } });
    phys.walls(0, 0, 400, 300);
    const ball = phys.circle(200, 150, 10, { restitution: 1, bullet: true });
    ball.vx = 900;
    ball.vy = 700;
    for (let i = 0; i < 600; i++) {
      phys.step(STEP);
      expect(ball.x).toBeGreaterThan(0);
      expect(ball.x).toBeLessThan(400);
      expect(ball.y).toBeGreaterThan(0);
      expect(ball.y).toBeLessThan(300);
    }
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
