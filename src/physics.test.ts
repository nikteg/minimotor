import { describe, it, expect } from "vitest";
import { GRAVITY, JUMP_FORCE, applyGravity, jump, type PhysicsBody } from "./physics.js";

function body(p: Partial<PhysicsBody> = {}): PhysicsBody {
  return { x: 0, y: 0, w: 20, h: 20, vy: 0, onGround: true, rotation: 0, ...p };
}

describe("Physics", () => {
  it("constants", () => { expect(GRAVITY).toBe(0.7); expect(JUMP_FORCE).toBe(-13.5); });

  describe("applyGravity", () => {
    it("accelerates vy and moves down", () => {
      const b = body({ vy: 5, onGround: false });
      expect(applyGravity(b, 200)).toBe(false);
      expect(b.vy).toBe(5.7);
      expect(b.y).toBe(5.7);
    });
    it("lands when bottom hits floor", () => {
      const b = body({ y: 79, vy: 5, h: 20, onGround: false });
      expect(applyGravity(b, 100)).toBe(true);
      expect(b.y).toBe(80);
      expect(b.vy).toBe(0);
      expect(b.onGround).toBe(true);
      expect(b.rotation).toBe(0);
    });
    it("stays grounded when already on floor", () => {
      const b = body({ y: 80, h: 20, onGround: true });
      applyGravity(b, 100);
      expect(b.onGround).toBe(true);
    });
    it("spins while airborne", () => {
      const b = body({ onGround: false, rotation: 0 });
      applyGravity(b, 500);
      expect(b.rotation).toBeCloseTo(0.12);
    });
    it("does not land if still above floor", () => {
      const b = body({ vy: 1, y: 50, h: 20, onGround: false });
      expect(applyGravity(b, 200)).toBe(false);
      expect(b.onGround).toBe(false);
    });
  });

  describe("jump", () => {
    it("applies force when on ground", () => {
      const b = body({ onGround: true });
      expect(jump(b)).toBe(true);
      expect(b.vy).toBe(JUMP_FORCE);
      expect(b.onGround).toBe(false);
    });
    it("no-op when airborne", () => {
      const b = body({ onGround: false, vy: 3 });
      expect(jump(b)).toBe(false);
      expect(b.vy).toBe(3);
    });
  });
});
