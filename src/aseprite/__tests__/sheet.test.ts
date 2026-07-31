import { describe, expect, it } from "vitest";
import { createClockHandle } from "@src/clock/index.js";
import * as Aseprite from "@src/aseprite/index.js";

const image = { width: 48, height: 16 } as HTMLImageElement;
const data = {
  frames: [
    { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 },
    { frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 200 },
    { frame: { x: 32, y: 0, w: 16, h: 16 }, duration: 300 },
  ],
  meta: {
    frameTags: [
      { name: "idle", from: 0, to: 1, direction: "forward" },
      { name: "turn", from: 0, to: 2, direction: "pingpong" },
      { name: "die", from: 1, to: 2, direction: "reverse" },
    ],
    slices: [
      {
        name: "origin",
        keys: [
          { frame: 0, bounds: { x: 0, y: 0, w: 16, h: 16 }, pivot: { x: 7, y: 15 } },
          { frame: 1, bounds: { x: 0, y: 0, w: 16, h: 16 }, pivot: { x: 8, y: 15 } },
        ],
      },
    ],
  },
} as const;

describe("Aseprite.sheet", () => {
  it("honors tags, directions, and variable frame durations", () => {
    let steps = 0;
    const clock = createClockHandle(1000 / 60, () => steps);
    const sheet = Aseprite.sheet(image, data);
    const idle = sheet.play("idle", { clock });
    steps = 9; // 150 ms
    expect(idle.frame).toBe(1);
    expect(idle.sourceFrame).toBe(1);
    expect(idle.rect.sx).toBe(16);
    expect(idle.slice("origin")?.pivot).toEqual({ x: 8, y: 15 });

    const turn = sheet.play("turn", { clock });
    steps += 37; // ~617 ms: sequence 0,1,2,1 reaches the reverse frame 1
    expect(turn.frame).toBe(3);
    expect(turn.rect.sx).toBe(16);
  });

  it("supports one-shot playback", () => {
    let steps = 0;
    const clock = createClockHandle(1000 / 60, () => steps);
    const sheet = Aseprite.sheet(image, data);
    const death = sheet.once("die", { clock });
    steps = 60;
    expect(death.done).toBe(true);
    expect(death.rect.sx).toBe(16);
  });

  it("exposes static frames, slices, layers, and trimmed placement", () => {
    const atlas = Aseprite.sheet(image, {
      frames: {
        icon: {
          frame: { x: 4, y: 5, w: 8, h: 10 },
          duration: 100,
          trimmed: true,
          spriteSourceSize: { x: 3, y: 2, w: 8, h: 10 },
          sourceSize: { w: 16, h: 16 },
        },
      },
      meta: {
        layers: [{ name: "Body", opacity: 255 }],
        slices: [
          {
            name: "hitbox",
            keys: [
              {
                frame: 0,
                bounds: { x: 2, y: 3, w: 10, h: 11 },
                center: { x: 3, y: 4, w: 8, h: 8 },
                pivot: { x: 8, y: 12 },
              },
            ],
          },
        ],
      },
    });

    expect(atlas.states).toEqual([]);
    expect(atlas.frames).toEqual(["icon"]);
    expect(atlas.layers).toEqual([{ name: "Body", opacity: 255 }]);
    expect(atlas.slices).toEqual(["hitbox"]);
    expect(atlas.region("icon")).toEqual({
      sx: 4,
      sy: 5,
      sw: 8,
      sh: 10,
      sourceW: 16,
      sourceH: 16,
      offsetX: 3,
      offsetY: 2,
    });
    expect(atlas.sprite("icon")).toEqual({
      sheet: { image },
      rect: {
        sx: 4,
        sy: 5,
        sw: 8,
        sh: 10,
        sourceW: 16,
        sourceH: 16,
        offsetX: 3,
        offsetY: 2,
      },
    });
    expect(atlas.slice("hitbox")?.pivot).toEqual({ x: 8, y: 12 });
  });

  it("supports hash-format frames and reusing clips with a tinted image", () => {
    const hash = {
      frames: { a: data.frames[0], b: data.frames[1] },
      meta: { frameTags: [{ name: "run", from: 0, to: 1 }] },
    } as const;
    const sheet = Aseprite.sheet(image, hash);
    const tinted = { width: 48, height: 16 } as HTMLImageElement;
    expect(
      sheet.withImage(tinted).play("run", { clock: createClockHandle(1000 / 60) }).sheet.image,
    ).toBe(tinted);
  });

  it("rejects unsupported or malformed exports", () => {
    expect(() =>
      Aseprite.sheet(image, {
        frames: [{ ...data.frames[0], rotated: true }],
        meta: { frameTags: [{ name: "idle", from: 0, to: 0 }] },
      }),
    ).toThrow(/rotated/);
    expect(() =>
      Aseprite.sheet(image, {
        frames: data.frames,
        meta: { frameTags: [{ name: "bad", from: 0, to: 99 }] },
      }),
    ).toThrow(/invalid frame range/);
  });
});
