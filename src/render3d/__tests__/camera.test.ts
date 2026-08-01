import { describe, expect, it } from "vitest";
import { Mat4 } from "@src/math/mat4.js";
import {
  cameraPosition,
  createCamera,
  dolly,
  frameMesh,
  orbit,
  projectionMatrix,
  viewMatrix,
  viewProjection,
} from "../camera.js";
import { box, sphere } from "../mesh.js";
import type { Vec3 } from "@src/math/vec3.js";

/** A world point through a matrix. */
function apply(m: Mat4, p: Vec3): Vec3 {
  return Mat4.transformPoint(m, { ...p });
}

describe("cameraPosition", () => {
  it("sits at +Z from the target at zero yaw and pitch", () => {
    const cam = createCamera({ yaw: 0, pitch: 0, distance: 5 });
    expect(cameraPosition(cam)).toEqual({ x: 0, y: 0, z: 5 });
  });

  it("keeps its distance from the target at any angle", () => {
    const cam = createCamera({ yaw: 1.3, pitch: -0.8, distance: 7, target: { x: 2, y: 3, z: -1 } });
    const p = cameraPosition(cam);
    expect(Math.hypot(p.x - 2, p.y - 3, p.z + 1)).toBeCloseTo(7);
  });

  it("rises with pitch", () => {
    expect(cameraPosition(createCamera({ pitch: 0.5, distance: 4 })).y).toBeGreaterThan(0);
  });
});

describe("viewMatrix", () => {
  it("puts the target in front of the camera, down −Z", () => {
    const cam = createCamera({ distance: 4, yaw: 0.9, pitch: 0.3 });
    const p = apply(viewMatrix(cam), cam.target);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-4);
  });
});

describe("orbit", () => {
  it("takes pixels, so every viewport drags at the same rate", () => {
    const cam = createCamera({ yaw: 0, pitch: 0 });
    orbit(cam, 100, 0, 0.01);
    expect(cam.yaw).toBeCloseTo(-1);
  });

  it("clamps pitch just short of the pole", () => {
    // At exactly ±90° the view direction is parallel to up and `lookAt` has no
    // basis to build — it would fall back to identity and the view would snap.
    const cam = createCamera({ pitch: 0 });
    orbit(cam, 0, 100000);
    expect(cam.pitch).toBeLessThan(Math.PI / 2);
    expect(cam.pitch).toBeGreaterThan(Math.PI / 2 - 0.05);
    // And the view it produces is still a real basis, not the identity
    // fallback.
    expect(Mat4.equals(viewMatrix(cam), Mat4.create())).toBe(false);

    orbit(cam, 0, -100000);
    expect(cam.pitch).toBeGreaterThan(-Math.PI / 2);
  });

  it("lets yaw wrap without limit", () => {
    const cam = createCamera({ yaw: 0 });
    orbit(cam, 100000, 0);
    expect(Number.isFinite(cam.yaw)).toBe(true);
  });
});

describe("dolly", () => {
  it("is multiplicative, so a notch moves the same proportion near or far", () => {
    const near = createCamera({ distance: 1 });
    const far = createCamera({ distance: 100 });
    dolly(near, 0.1);
    dolly(far, 0.1);
    expect(near.distance / 1).toBeCloseTo(far.distance / 100, 6);
  });

  it("never reaches the target", () => {
    const cam = createCamera({ distance: 1 });
    for (let i = 0; i < 500; i++) dolly(cam, -1);
    expect(cam.distance).toBeGreaterThan(0);
  });

  it("respects an upper limit", () => {
    const cam = createCamera({ distance: 1 });
    for (let i = 0; i < 500; i++) dolly(cam, 1, 0.05, 50);
    expect(cam.distance).toBe(50);
  });
});

describe("projectionMatrix", () => {
  it("takes its clip-depth range from the caller, not from an assumption", () => {
    const cam = createCamera({ near: 1, far: 10 });
    const gl = projectionMatrix(cam, 1, false);
    const gpu = projectionMatrix(cam, 1, true);
    expect(apply(gl, { x: 0, y: 0, z: -1 }).z).toBeCloseTo(-1);
    expect(apply(gpu, { x: 0, y: 0, z: -1 }).z).toBeCloseTo(0);
  });

  it("switching to orthographic keeps the subject the same size at the target", () => {
    // Otherwise toggling projection makes the model jump, which reads as a bug
    // rather than as a mode change.
    // Looking straight down −Z, so the sample point lies exactly on the target
    // PLANE. Off that plane the two projections must differ — that is what
    // foreshortening is — so comparing an off-axis point would be asserting
    // that perspective does not work.
    const cam = createCamera({
      distance: 5,
      fov: Math.PI / 4,
      near: 0.1,
      far: 50,
      yaw: 0,
      pitch: 0,
    });
    const atTarget = { x: 0.4, y: 0.3, z: 0 };

    const persp = apply(viewProjection(cam, 1.6, false), atTarget);
    cam.orthographic = true;
    const ortho = apply(viewProjection(cam, 1.6, false), atTarget);

    expect(ortho.x).toBeCloseTo(persp.x, 3);
    expect(ortho.y).toBeCloseTo(persp.y, 3);
  });

  it("an orthographic view does not foreshorten", () => {
    const cam = createCamera({ distance: 5, orthographic: true, yaw: 0, pitch: 0 });
    const vp = viewProjection(cam, 1, false);
    // Two points the same size, at different depths, project to the same size.
    const nearW = apply(vp, { x: 1, y: 0, z: 1 }).x;
    const farW = apply(vp, { x: 1, y: 0, z: -1 }).x;
    expect(nearW).toBeCloseTo(farW, 6);
  });
});

describe("viewProjection", () => {
  it("equals projection · view", () => {
    const cam = createCamera({ yaw: 0.4, pitch: -0.2, distance: 3 });
    const combined = viewProjection(cam, 1.5, false);
    const byHand = Mat4.mul(projectionMatrix(cam, 1.5, false), viewMatrix(cam), Mat4.create());
    expect(Mat4.equals(combined, byHand)).toBe(true);
  });
});

describe("frameMesh", () => {
  it("centres on the mesh and backs off far enough to contain it", () => {
    const cam = createCamera({ distance: 0.1, target: { x: 99, y: 99, z: 99 } });
    frameMesh(cam, box(2, 2, 2));
    expect(cam.target).toEqual({ x: 0, y: 0, z: 0 });
    // Every corner of the box must land inside the clip cube.
    const vp = viewProjection(cam, 1, false);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const p = apply(vp, { x: sx, y: sy, z: sz });
          expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("re-derives the clip planes, so a tiny mesh keeps depth precision", () => {
    const gem = createCamera();
    const ship = createCamera();
    frameMesh(gem, sphere(0.01, 8, 6));
    frameMesh(ship, sphere(500, 8, 6));
    expect(gem.far).toBeLessThan(1);
    expect(ship.far).toBeGreaterThan(1000);
    // The near plane must stay positive on both, or nothing renders.
    expect(gem.near).toBeGreaterThan(0);
    expect(ship.near).toBeGreaterThan(0);
  });

  it("scales the distance with the mesh", () => {
    const small = createCamera();
    const large = createCamera();
    frameMesh(small, box(1));
    frameMesh(large, box(10));
    expect(large.distance).toBeCloseTo(small.distance * 10, 4);
  });

  it("leaves a zero-size mesh alone rather than dividing by zero", () => {
    const cam = createCamera({ distance: 3 });
    frameMesh(cam, { positions: new Float32Array([1, 1, 1]), indices: new Uint16Array(0) });
    expect(cam.distance).toBe(3);
  });
});
