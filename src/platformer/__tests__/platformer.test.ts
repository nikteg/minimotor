import { describe, expect, it, vi } from "vitest";
import { animations, animationState } from "../index.js";

function cursor() {
  let state: "idle" | "run" | "jump" | "climb" = "idle";
  let paused = false;
  return {
    get state() {
      return state;
    },
    get paused() {
      return paused;
    },
    set: vi.fn((next: typeof state) => {
      state = next;
    }),
    reset: vi.fn(),
    pause: vi.fn(() => {
      paused = true;
    }),
    resume: vi.fn(() => {
      paused = false;
    }),
  };
}

describe("Platformer animations", () => {
  it("derives conventional states from local bodies and network snapshots", () => {
    expect(animationState({ grounded: true, vel: { x: 0, y: 0 } })).toBe("idle");
    expect(animationState({ grounded: true, vx: 2 })).toBe("run");
    expect(animationState({ grounded: false, vx: 0 })).toBe("jump");
    expect(animationState({ state: "climb", vy: 0 })).toBe("climb");
  });

  it("rests climbing cursors on one frame and resumes them with vertical movement", () => {
    const sprite = cursor();
    const outline = cursor();
    const group = animations({ sprite, outline });

    group.sync({ state: "climb", vy: 0 });
    expect(sprite.state).toBe("climb");
    expect(sprite.reset).toHaveBeenCalledOnce();
    expect(sprite.paused).toBe(true);
    expect(outline.paused).toBe(true);

    group.sync({ state: "climb", vy: -2 });
    expect(sprite.paused).toBe(false);
    expect(outline.paused).toBe(false);
  });
});
