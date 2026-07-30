import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssets } from "../../assets.js";
import { createAnimation } from "../../features/animation/index.js";
import { createAutosave } from "../../features/autosave.js";
import { createInput } from "../../features/input/index.js";
import { createNet } from "../../features/networking/index.js";
import { createSnapshots } from "../../features/snapshots.js";
import { createStorage } from "../../features/storage.js";
import { createApp } from "../app.js";

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
