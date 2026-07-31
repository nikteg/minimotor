import { describe, expect, it, vi } from "vitest";
import { createPortalRouter } from "../portals/index.js";
import { world } from "../tiles/index.js";

const level = (spawns: Record<string, { x: number; y: number }>) => ({
  spawnOne(name: string) {
    const spawn = spawns[name];
    if (!spawn) throw new Error(`missing ${name}`);
    return spawn;
  },
});

describe("Portals", () => {
  it("changes area, places the body, stops motion, and navigates scenes", () => {
    const go = vi.fn();
    const onTravel = vi.fn();
    const body = {
      x: 2,
      y: 2,
      w: 4,
      h: 6,
      vel: { x: 3, y: 4 },
      area: "field" as "field" | "cave",
    };
    const portals = createPortalRouter({
      body,
      scenes: { go, active: "outside" },
      auto: false,
      areas: {
        field: {
          scene: "outside",
          level: level({ west: { x: 0, y: 0 } }),
          portals: [
            {
              x: 0,
              y: 0,
              w: 10,
              h: 10,
              to: { area: "cave", spawn: "door" },
              transition: "fade",
              transitionMs: 180,
            },
          ],
        },
        cave: {
          scene: "inside",
          level: level({ door: { x: 50, y: 60 } }),
          portals: [],
        },
      },
      onTravel,
    });

    expect(portals.update()).toBe(true);
    expect(body).toMatchObject({
      area: "cave",
      x: 48,
      y: 57,
      vel: { x: 0, y: 0 },
    });
    expect(go).toHaveBeenCalledWith("inside", {
      transition: expect.objectContaining({ durationMs: 180 }),
    });
    expect(onTravel).toHaveBeenCalledWith({
      from: "field",
      to: "cave",
      spawn: "door",
      portal: expect.any(Object),
    });
  });

  it("disarms paired doors until the body leaves the destination trigger", () => {
    const body = { x: 1, y: 1, w: 2, h: 2, area: "a" as "a" | "b" };
    const router = createPortalRouter({
      body,
      scenes: { go() {}, active: "play" },
      auto: false,
      areas: {
        a: {
          scene: "play",
          level: level({ door: { x: 2, y: 2 } }),
          portals: [{ x: 0, y: 0, w: 5, h: 5, to: { area: "b", spawn: "door" } }],
        },
        b: {
          scene: "play",
          level: level({ door: { x: 2, y: 2 } }),
          portals: [{ x: 0, y: 0, w: 5, h: 5, to: { area: "a", spawn: "door" } }],
        },
      },
    });

    expect(router.update()).toBe(true);
    expect(router.update()).toBe(false);
    expect(body.area).toBe("b");
    body.x = 20;
    router.update();
    body.x = 1;
    expect(router.update()).toBe(true);
    expect(body.area).toBe("a");
  });

  it("supports center-based physics bodies through custom trigger bounds", () => {
    const body = { x: 5, y: 5, vx: 10, vy: -4, area: "a" as "a" | "b" };
    const router = createPortalRouter({
      body,
      scenes: { go() {}, active: "play" },
      auto: false,
      bounds: (it) => ({ x: it.x - 2, y: it.y - 2, w: 4, h: 4 }),
      areas: {
        a: {
          scene: "play",
          level: level({ door: { x: 0, y: 0 } }),
          portals: [{ x: 0, y: 0, w: 10, h: 10, to: { area: "b", spawn: "door" } }],
        },
        b: { scene: "play", level: level({ door: { x: 30, y: 40 } }), portals: [] },
      },
    });

    router.update();
    expect(body).toMatchObject({ x: 30, y: 40, vx: 0, vy: 0, area: "b" });
    expect(router.sameArea({ area: "b" })).toBe(true);
  });

  it("does not activate an area behind a modal scene", () => {
    const body = { x: 1, y: 1, w: 2, h: 2, area: "field" as const };
    const go = vi.fn();
    const router = createPortalRouter({
      body,
      scenes: { go, active: "paused" as "field" | "paused" },
      auto: false,
      areas: {
        field: {
          scene: "field",
          level: level({ start: { x: 0, y: 0 } }),
          portals: [{ x: 0, y: 0, w: 5, h: 5, to: { area: "field", spawn: "start" } }],
        },
      },
    });

    expect(router.update()).toBe(false);
    expect(go).not.toHaveBeenCalled();
  });

  it("uses an ordinary tile-string world directly", () => {
    const maps = world(
      {
        field: "..A.\n####",
        cave: ".B..\n####",
      },
      {
        size: 10,
        legend: { "#": { solid: true } },
        portals: [{ between: ["field:A", "cave:B"], transition: "fade" }],
      },
    );
    const body = {
      x: 21,
      y: 1,
      w: 8,
      h: 9,
      area: maps.first,
      vel: { x: 2, y: 3 },
    };
    const go = vi.fn();
    const router = createPortalRouter({
      body,
      scenes: { go, active: "game" },
      world: maps,
      scene: "game",
      auto: false,
    });

    expect(router.update()).toBe(true);
    expect(body).toMatchObject({
      area: "cave",
      x: 11,
      y: 0,
      vel: { x: 0, y: 0 },
    });
    expect(go).toHaveBeenCalledWith("game", {
      transition: expect.objectContaining({ durationMs: 400 }),
    });
  });
});
