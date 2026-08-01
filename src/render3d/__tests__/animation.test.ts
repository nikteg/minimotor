import { describe, expect, it } from "vitest";
import { Quat } from "@src/math/quat.js";
import { Vec3 } from "@src/math/vec3.js";
import { addNode, createScene, node } from "../scene.js";
import { createClip, sampleClip, spinTrack } from "../animation.js";
import type { Scene3D } from "../scene.js";
import type { Track } from "../animation.js";

function sceneWithNode(): Scene3D {
  const scene = createScene();
  addNode(scene, node({ name: "target" }));
  return scene;
}

/** A position track from 0→10 on X over two seconds. */
const slide: Track = {
  node: 0,
  property: "position",
  times: new Float32Array([0, 2]),
  values: new Float32Array([0, 0, 0, 10, 0, 0]),
};

describe("sampleClip", () => {
  it("interpolates linearly between two keys", () => {
    const scene = sceneWithNode();
    sampleClip(scene, createClip("slide", [slide]), 0.5);
    expect(scene.nodes[0].position.x).toBeCloseTo(2.5);
  });

  it("hits both endpoints exactly when not looping", () => {
    const scene = sceneWithNode();
    const clip = createClip("slide", [slide]);
    sampleClip(scene, clip, 0, false);
    expect(scene.nodes[0].position.x).toBe(0);
    sampleClip(scene, clip, 2, false);
    expect(scene.nodes[0].position.x).toBe(10);
  });

  it("wraps a LOOPING sample at exactly the duration back to the start", () => {
    // Not a rounding edge — it is what looping means, and it is why a
    // one-shot has to pass `loop: false` to settle on its final pose.
    const scene = sceneWithNode();
    sampleClip(scene, createClip("slide", [slide]), 2);
    expect(scene.nodes[0].position.x).toBe(0);
  });

  it("derives the duration from the longest track", () => {
    const long: Track = {
      node: 0,
      property: "scale",
      times: new Float32Array([0, 5]),
      values: new Float32Array([1, 1, 1, 2, 2, 2]),
    };
    expect(createClip("mixed", [slide, long]).duration).toBe(5);
  });

  it("loops by wrapping the time", () => {
    const scene = sceneWithNode();
    const clip = createClip("slide", [slide]);
    sampleClip(scene, clip, 2.5); // one loop plus 0.5
    expect(scene.nodes[0].position.x).toBeCloseTo(2.5);
  });

  it("wraps a NEGATIVE time forward rather than leaving it negative", () => {
    // `%` in JS keeps the sign, so a rewinding clock would sample before the
    // first key and stick on it.
    const scene = sceneWithNode();
    sampleClip(scene, createClip("slide", [slide]), -0.5);
    expect(scene.nodes[0].position.x).toBeCloseTo(7.5);
  });

  it("clamps instead of looping when asked, so a one-shot settles on its end pose", () => {
    const scene = sceneWithNode();
    const clip = createClip("slide", [slide]);
    sampleClip(scene, clip, 99, false);
    expect(scene.nodes[0].position.x).toBe(10);
    sampleClip(scene, clip, -99, false);
    expect(scene.nodes[0].position.x).toBe(0);
  });

  it("holds the earlier key under step interpolation", () => {
    const scene = sceneWithNode();
    sampleClip(scene, createClip("cut", [{ ...slide, interpolation: "step" }]), 1.9);
    expect(scene.nodes[0].position.x).toBe(0);
  });

  it("slerps a rotation rather than lerping its components", () => {
    const scene = sceneWithNode();
    const a = Quat.create();
    const b = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 2);
    const track: Track = {
      node: 0,
      property: "rotation",
      times: new Float32Array([0, 1]),
      values: new Float32Array([a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w]),
    };
    sampleClip(scene, createClip("turn", [track]), 0.5);
    // Halfway must be a 45° turn — a component-wise lerp would land short and
    // would not be a unit quaternion.
    const quarter = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 4);
    expect(Quat.equals(scene.nodes[0].rotation, quarter)).toBe(true);
  });

  it("handles two keys at the same time as a hard cut, not a NaN", () => {
    const scene = sceneWithNode();
    const track: Track = {
      node: 0,
      property: "position",
      times: new Float32Array([0, 1, 1, 2]),
      values: new Float32Array([0, 0, 0, 0, 0, 0, 5, 0, 0, 5, 0, 0]),
    };
    sampleClip(scene, createClip("cut", [track]), 1);
    expect(Number.isNaN(scene.nodes[0].position.x)).toBe(false);
  });

  it("ignores a track pointing at a node that is no longer there", () => {
    const scene = sceneWithNode();
    const clip = createClip("gone", [{ ...slide, node: 7 }]);
    expect(() => sampleClip(scene, clip, 0.5)).not.toThrow();
  });

  it("does nothing for an empty track", () => {
    const scene = sceneWithNode();
    const empty: Track = {
      node: 0,
      property: "position",
      times: new Float32Array(0),
      values: new Float32Array(0),
    };
    sampleClip(scene, createClip("empty", [empty]), 1);
    expect(scene.nodes[0].position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("samples the same value regardless of the order times are requested in", () => {
    // A cached forward cursor would break on a scrub bar or a replay seek.
    const scene = sceneWithNode();
    const clip = createClip("slide", [slide]);
    sampleClip(scene, clip, 1.5);
    const forward = scene.nodes[0].position.x;
    sampleClip(scene, clip, 0.2);
    sampleClip(scene, clip, 1.5);
    expect(scene.nodes[0].position.x).toBe(forward);
  });
});

describe("spinTrack", () => {
  it("completes a full turn over its duration", () => {
    const scene = sceneWithNode();
    const clip = createClip("spin", [spinTrack(0, 3)]);
    const forward = { x: 0, y: 0, z: 1 };

    sampleClip(scene, clip, 0);
    const start = Quat.rotateVec3(scene.nodes[0].rotation, forward, { x: 0, y: 0, z: 0 });
    // A third of the way round, +Z must have moved a long way — the two-key
    // version of this track cannot, because slerp takes the shortest arc
    // between two identical orientations and never moves at all.
    sampleClip(scene, clip, 1);
    const third = Quat.rotateVec3(scene.nodes[0].rotation, forward, { x: 0, y: 0, z: 0 });
    expect(Vec3.dot(start, third)).toBeCloseTo(Math.cos((2 * Math.PI) / 3), 3);

    sampleClip(scene, clip, 3);
    const end = Quat.rotateVec3(scene.nodes[0].rotation, forward, { x: 0, y: 0, z: 0 });
    expect(Vec3.equals(end, start, 1e-5)).toBe(true);
  });

  it("spins about the axis it was given", () => {
    const scene = sceneWithNode();
    sampleClip(scene, createClip("roll", [spinTrack(0, 4, { x: 1, y: 0, z: 0 })]), 1);
    // A rotation about X leaves X fixed.
    const x = Quat.rotateVec3(scene.nodes[0].rotation, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(Vec3.equals(x, { x: 1, y: 0, z: 0 }, 1e-5)).toBe(true);
  });
});
