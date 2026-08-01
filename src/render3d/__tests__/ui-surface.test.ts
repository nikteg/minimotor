import { describe, expect, it } from "vitest";
import { Mat4 } from "@src/math/mat4.js";
import { Quat } from "@src/math/quat.js";
import { createCamera } from "../camera.js";
import { intersectQuad, pointerRay } from "../ui-surface.js";
import type { Ray } from "../ui-surface.js";

const IDENTITY = Mat4.create();

/** A ray aimed straight down −Z from `(x, y, 5)`. */
function straightAt(x: number, y: number): Ray {
  return { origin: { x, y, z: 5 }, direction: { x: 0, y: 0, z: -1 } };
}

describe("intersectQuad", () => {
  it("puts v = 0 at the TOP, matching the UI's own coordinates", () => {
    // The single most important property here: a UI's +Y is down, a quad's is
    // up. Getting this backwards renders the panel upside down and puts every
    // click on the wrong row.
    const top = intersectQuad(IDENTITY, straightAt(0, 0.49), 1, 1);
    const bottom = intersectQuad(IDENTITY, straightAt(0, -0.49), 1, 1);
    expect(top!.v).toBeCloseTo(0.01);
    expect(bottom!.v).toBeCloseTo(0.99);
  });

  it("does NOT mirror u — the left of the quad is u = 0", () => {
    expect(intersectQuad(IDENTITY, straightAt(-0.49, 0), 1, 1)!.u).toBeCloseTo(0.01);
    expect(intersectQuad(IDENTITY, straightAt(0.49, 0), 1, 1)!.u).toBeCloseTo(0.99);
  });

  it("hits the centre dead on", () => {
    expect(intersectQuad(IDENTITY, straightAt(0, 0), 1, 1)).toEqual({ u: 0.5, v: 0.5 });
  });

  it("misses outside the quad", () => {
    expect(intersectQuad(IDENTITY, straightAt(0.51, 0), 1, 1)).toBeNull();
    expect(intersectQuad(IDENTITY, straightAt(0, -0.51), 1, 1)).toBeNull();
  });

  it("respects a non-square quad", () => {
    // 2 wide, 1 tall: x = 0.9 is inside, y = 0.9 is not.
    expect(intersectQuad(IDENTITY, straightAt(0.9, 0), 2, 1)).not.toBeNull();
    expect(intersectQuad(IDENTITY, straightAt(0, 0.9), 2, 1)).toBeNull();
  });

  it("follows the quad's model transform", () => {
    const model = Mat4.fromTranslation(10, 0, 0);
    expect(intersectQuad(model, straightAt(0, 0), 1, 1)).toBeNull();
    expect(intersectQuad(model, straightAt(10, 0), 1, 1)!.u).toBeCloseTo(0.5);
  });

  it("follows a rotated quad", () => {
    // Turned 90° about Y, the quad lies in the YZ plane and a ray down −Z can
    // only graze its edge — but one along −X hits it square.
    const model = Mat4.fromQuat(Quat.fromAxisAngle(Quat.create(), 0, 1, 0, Math.PI / 2));
    const fromSide: Ray = { origin: { x: 5, y: 0, z: 0 }, direction: { x: -1, y: 0, z: 0 } };
    expect(intersectQuad(model, fromSide, 1, 1)!.u).toBeCloseTo(0.5);
  });

  it("handles a scaled quad", () => {
    const model = Mat4.fromScale(4, 4, 1);
    // The quad is now 4 units wide, so x = 1.9 is still inside.
    expect(intersectQuad(model, straightAt(1.9, 0), 1, 1)!.u).toBeCloseTo(0.975);
    expect(intersectQuad(model, straightAt(2.1, 0), 1, 1)).toBeNull();
  });

  it("misses a quad BEHIND the ray rather than hitting it backwards", () => {
    // Without the t >= 0 check, a panel behind the camera would still be
    // clickable — the ray line crosses its plane, just in the wrong direction.
    const behind: Ray = { origin: { x: 0, y: 0, z: 5 }, direction: { x: 0, y: 0, z: 1 } };
    expect(intersectQuad(IDENTITY, behind, 1, 1)).toBeNull();
  });

  it("misses a quad the ray is parallel to, without dividing by zero", () => {
    const parallel: Ray = { origin: { x: 0, y: 0, z: 5 }, direction: { x: 1, y: 0, z: 0 } };
    expect(intersectQuad(IDENTITY, parallel, 1, 1)).toBeNull();
  });

  it("misses when the model matrix is degenerate", () => {
    expect(intersectQuad(Mat4.fromScale(1, 1, 0), straightAt(0, 0), 1, 1)).toBeNull();
  });
});

describe("pointerRay", () => {
  it("aims down −Z from a camera looking down −Z, at the view's centre", () => {
    const cam = createCamera({ yaw: 0, pitch: 0, distance: 4 });
    const r = pointerRay(cam, { x: 100, y: 50, viewW: 200, viewH: 100 });
    expect(r.origin.z).toBeCloseTo(4);
    expect(r.direction.x).toBeCloseTo(0);
    expect(r.direction.y).toBeCloseTo(0);
    expect(r.direction.z).toBeCloseTo(-1);
  });

  it("starts at the camera and is unit length", () => {
    const cam = createCamera({ yaw: 0.7, pitch: -0.3, distance: 6 });
    const r = pointerRay(cam, { x: 30, y: 200, viewW: 400, viewH: 300 });
    expect(Math.hypot(r.direction.x, r.direction.y, r.direction.z)).toBeCloseTo(1);
    // The origin is the eye, six units from the target.
    expect(Math.hypot(r.origin.x, r.origin.y, r.origin.z)).toBeCloseTo(6);
  });

  it("maps the pointer's Y downward, as a UI rect does", () => {
    // Clip space is +Y up; a widget rect is +Y down. A ray from the TOP of the
    // view must aim upward in the world.
    const cam = createCamera({ yaw: 0, pitch: 0, distance: 4 });
    const top = pointerRay(cam, { x: 100, y: 5, viewW: 200, viewH: 200 });
    const bottom = pointerRay(cam, { x: 100, y: 195, viewW: 200, viewH: 200 });
    expect(top.direction.y).toBeGreaterThan(0);
    expect(bottom.direction.y).toBeLessThan(0);
  });

  it("round-trips: a ray through a point on the quad lands back on that point", () => {
    // The strongest check available without a GPU — project a known surface
    // point to a pixel by hand, then cast through that pixel and land back on
    // it. This catches an aspect-ratio slip, a sign error and a
    // near-plane mix-up all at once.
    const cam = createCamera({ yaw: 0.5, pitch: 0.25, distance: 3 });
    const model = Mat4.compose(
      { x: 0.2, y: 0.1, z: -0.4 },
      Quat.fromAxisAngle(Quat.create(), 0, 1, 0, -0.3),
      { x: 1, y: 1, z: 1 },
    );
    const viewW = 640;
    const viewH = 360;

    for (const [u, v] of [
      [0.5, 0.5],
      [0.1, 0.8],
      [0.85, 0.2],
    ]) {
      // The world point at (u, v) on a 1 × 0.5 quad.
      const local = { x: (u - 0.5) * 1, y: (0.5 - v) * 0.5, z: 0 };
      const world = Mat4.transformPoint(model, { ...local });

      // Project it to a view pixel.
      const vp = Mat4.mul(
        Mat4.perspective(cam.fov, viewW / viewH, cam.near, cam.far),
        (() => {
          const m = Mat4.create();
          return Mat4.lookAt(
            {
              x: Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.distance,
              y: Math.sin(cam.pitch) * cam.distance,
              z: Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.distance,
            },
            cam.target,
            { x: 0, y: 1, z: 0 },
            m,
          );
        })(),
        Mat4.create(),
      );
      const clip = Mat4.transformPoint(vp, { ...world });
      const px = ((clip.x + 1) / 2) * viewW;
      const py = ((1 - clip.y) / 2) * viewH;

      const hit = intersectQuad(model, pointerRay(cam, { x: px, y: py, viewW, viewH }), 1, 0.5);
      expect(hit).not.toBeNull();
      expect(hit!.u).toBeCloseTo(u, 4);
      expect(hit!.v).toBeCloseTo(v, 4);
    }
  });

  it("gives an orthographic camera parallel rays", () => {
    // With no single eye point, two rays from different pixels must be
    // parallel and start on the near plane rather than converging on a point.
    const cam = createCamera({ yaw: 0, pitch: 0, distance: 4, orthographic: true });
    const a = pointerRay(cam, { x: 10, y: 10, viewW: 200, viewH: 200 });
    const b = pointerRay(cam, { x: 190, y: 190, viewW: 200, viewH: 200 });
    expect(a.direction.x).toBeCloseTo(b.direction.x);
    expect(a.direction.y).toBeCloseTo(b.direction.y);
    expect(a.direction.z).toBeCloseTo(b.direction.z);
    expect(a.origin.x).not.toBeCloseTo(b.origin.x);
  });

  it("an orthographic ray still hits the quad where the pixel says", () => {
    const cam = createCamera({ yaw: 0, pitch: 0, distance: 4, orthographic: true });
    // Dead centre must land dead centre whatever the projection.
    const hit = intersectQuad(
      IDENTITY,
      pointerRay(cam, { x: 100, y: 100, viewW: 200, viewH: 200 }),
      1,
      1,
    );
    expect(hit!.u).toBeCloseTo(0.5);
    expect(hit!.v).toBeCloseTo(0.5);
  });
});
