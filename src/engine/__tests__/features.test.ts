import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssets } from "../../assets/service.js";
import { createAnimation } from "../../anim/service.js";
import { createAutosave } from "../../autosave/service.js";
import { createInput } from "../../input/service.js";
import { createNet } from "../../net/service.js";
import { createSnapshots } from "../../snapshots.js";
import { createStorage } from "../../storage/service.js";
import { createApp } from "../app.js";
import { sheet, type SheetImage } from "../../anim/index.js";

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      canvas: this,
      setTransform: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  };
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

describe("explicit game services", () => {
  it("binds core services to each game", () => {
    const a = createApp(document.createElement("canvas"));
    const b = createApp(document.createElement("canvas"));
    expect(a.Draw.ctx.canvas).toBe(a.canvas);
    expect(b.Draw.ctx.canvas).toBe(b.canvas);
    expect(a.Draw.ctx).not.toBe(b.Draw.ctx);
    expect(a.Keys).not.toBe(b.Keys);
  });

  it("uses explicit storage and snapshot dependencies for autosave", async () => {
    const values = new Map<string, string>();
    const backend = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => void values.set(key, value),
      removeItem: async (key: string) => void values.delete(key),
    };
    const game = createApp(document.createElement("canvas"));
    const storage = createStorage(game, {
      stores: { browser: backend, network: backend },
      default: "browser",
      prefix: "test:",
    });
    const snapshots = createSnapshots();
    const autosave = createAutosave(game, snapshots, storage, { store: "network" });
    let score = 7;
    snapshots.register("score", { save: () => score, load: (value) => (score = value) });
    await autosave.save();
    score = 0;
    expect(await autosave.load()).toBe(true);
    expect(score).toBe(7);
    expect(values.has("test:network:autosave")).toBe(true);
  });

  it("binds animation playback to the owning game clock", () => {
    const game = createApp(document.createElement("canvas"));
    const Animation = createAnimation(game);
    const source = {
      play(_state: "idle", options: { clock: unknown }) {
        return options.clock;
      },
      once(_state: "idle", options: { clock: unknown }) {
        return options.clock;
      },
    };
    expect(Animation.play(source, "idle")).toBe(game.Clock.world);
    expect(Animation.once(source, "idle")).toBe(game.Clock.world);
  });

  it("keeps two games' animations on their own clocks", () => {
    // The whole reason the primitives capture the ambient clock when they are
    // BUILT rather than reading it when they are used: `play()` runs later,
    // from game code, with no binding on the stack. If it read the ambient
    // clock then, the second createAnimation would have stolen the first's.
    const a = createApp(document.createElement("canvas"));
    const b = createApp(document.createElement("canvas"));
    const AnimA = createAnimation(a);
    const AnimB = createAnimation(b);
    const image = { width: 64, height: 32 } as unknown as Parameters<typeof AnimA.sheet>[0];
    const options = { frame: { w: 32, h: 32 }, states: { idle: { row: 0, frames: 2 } } };
    const sheetA = AnimA.sheet(image, options);
    const sheetB = AnimB.sheet(image, options);

    a.Clock.world.hold(); // freeze A only
    const cursorA = sheetA.play("idle");
    const cursorB = sheetB.play("idle");
    expect(cursorA.frame).toBe(0);
    expect(cursorB.frame).toBe(0);
    expect(a.Clock.world.held).toBe(true);
    expect(b.Clock.world.held).toBe(false);
  });

  it("refuses to build a cursor with no clock anywhere", () => {
    const image = { width: 64, height: 32 } as unknown as SheetImage;
    const unbound = sheet(image, {
      frame: { w: 32, h: 32 },
      states: { idle: { row: 0, frames: 2 } },
    });
    // Geometry needs no time, so building and measuring is fine…
    expect(unbound.rect("idle", 0)).toEqual({ sx: 0, sy: 0, sw: 32, sh: 32 });
    // …but a cursor that would silently never advance is an error, not a shrug.
    expect(() => unbound.play("idle")).toThrow(/no ambient clock/);
  });

  it("gives each game an isolated asset cache", () => {
    const a = createApp(document.createElement("canvas"));
    const b = createApp(document.createElement("canvas"));
    expect(createAssets(a)).not.toBe(createAssets(b));
  });

  it("creates input and networking without eager external connections", () => {
    const game = createApp(document.createElement("canvas"));
    const Input = createInput(game);
    const Net = createNet(game);
    expect(Input.context().active).toBe("gameplay");
    expect(Net.playerColor(1)).toMatch(/^hsl/);
  });
});
