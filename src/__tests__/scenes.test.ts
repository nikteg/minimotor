import { describe, it, expect, vi } from "vitest";
import { createSceneManager, type Scene } from "../scenes.js";

function spyScene(log: string[], name: string): Scene {
  return {
    enter: () => log.push(`${name}:enter`),
    update: () => log.push(`${name}:update`),
    draw: () => log.push(`${name}:draw`),
    exit: () => log.push(`${name}:exit`),
  };
}

describe("SceneManager", () => {
  it("go enters the scene and makes it active", () => {
    const log: string[] = [];
    const m = createSceneManager();
    m.define("menu", spyScene(log, "menu"));
    m.go("menu");
    expect(m.active).toBe("menu");
    expect(m.stack).toEqual(["menu"]);
    expect(log).toEqual(["menu:enter"]);
  });

  it("go exits the whole current stack before entering the new scene", () => {
    const log: string[] = [];
    const m = createSceneManager();
    m.define("a", spyScene(log, "a"));
    m.define("b", spyScene(log, "b"));
    m.define("c", spyScene(log, "c"));
    m.go("a");
    m.push("b");
    log.length = 0;
    m.go("c");
    // top-first exit, then enter the new scene
    expect(log).toEqual(["b:exit", "a:exit", "c:enter"]);
    expect(m.stack).toEqual(["c"]);
  });

  it("push overlays: only the top updates, all draw bottom-to-top", () => {
    const log: string[] = [];
    const m = createSceneManager();
    m.define("play", spyScene(log, "play"));
    m.define("pause", spyScene(log, "pause"));
    m.go("play");
    m.push("pause");
    log.length = 0;

    m.update();
    m.draw();
    expect(log).toEqual(["pause:update", "play:draw", "pause:draw"]);
  });

  it("skips scenes covered by an opaque scene when drawing", () => {
    const log: string[] = [];
    const m = createSceneManager();
    m.define("menu", spyScene(log, "menu"));
    m.define("play", { ...spyScene(log, "play"), opaque: true });
    m.define("pause", spyScene(log, "pause"));
    m.go("menu");
    m.push("play");
    m.push("pause");
    log.length = 0;
    m.draw();
    // "menu" sits under the opaque "play" — never drawn.
    expect(log).toEqual(["play:draw", "pause:draw"]);
  });

  it("pop exits the top and resumes the one beneath", () => {
    const log: string[] = [];
    const m = createSceneManager();
    m.define("play", spyScene(log, "play"));
    m.define("pause", spyScene(log, "pause"));
    m.go("play");
    m.push("pause");
    log.length = 0;

    m.pop();
    expect(log).toEqual(["pause:exit"]);
    expect(m.active).toBe("play");

    log.length = 0;
    m.update();
    expect(log).toEqual(["play:update"]);
  });

  it("throws on navigating to an undefined scene", () => {
    const m = createSceneManager();
    expect(() => m.go("nope")).toThrow(/no scene defined/);
    expect(() => m.push("nope")).toThrow(/no scene defined/);
  });

  it("tolerates empty stack and optional hooks", () => {
    const m = createSceneManager();
    expect(m.active).toBeUndefined();
    expect(() => {
      m.update();
      m.draw();
      m.pop();
    }).not.toThrow();

    // A scene with no hooks is fine.
    m.define("bare", {});
    m.go("bare");
    expect(() => {
      m.update();
      m.draw();
    }).not.toThrow();
  });

  it("define replaces an existing scene under the same name", () => {
    const log: string[] = [];
    const m = createSceneManager();
    m.define("s", { enter: () => log.push("first") });
    m.define("s", { enter: () => log.push("second") });
    m.go("s");
    expect(log).toEqual(["second"]);
  });

  it("auto-drives a world-only scene, but a hook takes over", () => {
    const m = createSceneManager();
    const fakeCtx = {} as CanvasRenderingContext2D;

    const auto = { update: vi.fn(), draw: vi.fn() };
    const manual = { update: vi.fn(), draw: vi.fn() };
    m.define("auto", { world: auto as never });
    m.define("manual", { world: manual as never, update() {}, draw() {} });

    m.go("auto");
    m.update();
    m.draw(fakeCtx);
    expect(auto.update).toHaveBeenCalledTimes(1);
    expect(auto.draw).toHaveBeenCalledWith(fakeCtx);

    // A scene that defines its own hooks controls the world itself — no auto-drive.
    m.go("manual");
    m.update();
    m.draw(fakeCtx);
    expect(manual.update).not.toHaveBeenCalled();
    expect(manual.draw).not.toHaveBeenCalled();
  });
});

describe("Scenes default facade", () => {
  it("wires into Loop once and drives the manager", async () => {
    // Fresh module registry: import the facade and drive it through a fake Loop.
    vi.resetModules();
    const runSpy = vi.fn();
    vi.doMock("../engine.js", () => ({
      Loop: { run: runSpy, onStep: vi.fn(), step: 1000 / 60 },
      Draw: { ctx: {} },
      Stage: { viewport: { w: 800, h: 600 } },
    }));
    const { Scenes } = await import("../scenes.js");

    const log: string[] = [];
    Scenes.define("play", spyScene(log, "play"));
    Scenes.go("play");
    Scenes.push("play"); // second navigation must NOT re-wire the Loop

    expect(runSpy).toHaveBeenCalledTimes(1);
    const callbacks = runSpy.mock.calls[0][0] as { update(): void; draw(): void };
    log.length = 0;
    callbacks.update();
    callbacks.draw();
    // stack is [play, play] after go+push → top updates, both draw
    expect(log).toEqual(["play:update", "play:draw", "play:draw"]);

    vi.doUnmock("../engine.js");
  });

  it("go with a transition swaps behind full coverage", async () => {
    vi.resetModules();
    const runSpy = vi.fn();
    const onStepSpy = vi.fn();
    vi.doMock("../engine.js", () => ({
      Loop: { run: runSpy, onStep: onStepSpy, step: 100 },
      Draw: { ctx: {} },
      Stage: { viewport: { w: 800, h: 600 } },
    }));
    const { Scenes } = await import("../scenes.js");

    const log: string[] = [];
    Scenes.define("a", spyScene(log, "a"));
    Scenes.define("b", spyScene(log, "b"));
    Scenes.go("a");
    expect(Scenes.active).toBe("a");

    const render = vi.fn();
    Scenes.go("b", { durationMs: 400, render });
    expect(Scenes.active).toBe("a"); // swap is deferred to the midpoint

    const stepTransition = onStepSpy.mock.calls[0][0] as () => void;
    const { draw } = runSpy.mock.calls[0][0] as { draw(): void };
    stepTransition(); // 100ms — covering
    draw();
    expect(render).toHaveBeenLastCalledWith(expect.anything(), 0.5, { w: 800, h: 600 });
    expect(Scenes.active).toBe("a");
    stepTransition(); // 200ms — midpoint: swap fires
    expect(Scenes.active).toBe("b");
    stepTransition();
    stepTransition(); // 400ms — done; overlay no longer draws
    render.mockClear();
    draw();
    expect(render).not.toHaveBeenCalled();

    vi.doUnmock("../engine.js");
  });
});
