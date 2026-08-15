// ---------- Scene graph ----------
// A flat array of nodes, each optionally naming a parent. Not a linked tree of
// objects with `children` arrays: a flat list keeps the update loop a single
// pass with no recursion, serialises to JSON for free (which is what hot-reload
// state saving and snapshots need), and makes "draw every node with this
// material" an ordinary filter.
//
// The one rule that makes the flat form work: **a node's parent must appear
// EARLIER in the array**. `updateWorldMatrices` relies on it to resolve
// hierarchy in one forward pass, and `Scene.add` enforces it by construction
// since a child can only name a parent that already exists.
//
// Transforms are TRS (`position`, `rotation`, `scale`) rather than a matrix,
// because that is what animation interpolates — a keyframe track writes a
// quaternion, and only the renderer ever wants the matrix.
import { Mat4 } from "../math/mat4.js";
import { Quat } from "../math/quat.js";
/** `Material.detailUvProjection` as the shaders see it: 0 mesh uv, 1 planar
 *  XZ, 2 triplanar. Resolved here rather than in each backend so WebGL2 and
 *  WebGPU cannot drift apart on what an unset value means. */
export function detailProjectionMode(material) {
    if (material.detailUvProjection === "planarXZ")
        return 1;
    if (material.detailUvProjection === "triplanar")
        return 2;
    return 0;
}
/** `Material.detailWorldStep` as the shaders see it: the grid the world
 *  position snaps to before a projected secondary map reads it, and 0 for off.
 *  Resolved here for the same reason as `detailProjectionMode` — and because a
 *  step under the mesh's own uv is meaningless, so the mode gates it in ONE
 *  place rather than in each backend's uniform block. */
export function detailWorldStep(material) {
    if (detailProjectionMode(material) === 0)
        return 0;
    const step = material.detailWorldStep ?? 0;
    return Number.isFinite(step) && step > 0 ? step : 0;
}
/** `Material.glaze`'s master weight as the shaders see it, and 0 for every way
 *  of not having one. Resolved here for the same reason as the two above: it is
 *  the single test both backends branch the whole coat on, and a backend that
 *  disagreed about what "off" means would draw a different frame. */
export function glazeStrength(material) {
    const strength = material.glaze?.strength ?? 0;
    return Number.isFinite(strength) && strength > 0 ? Math.min(strength, 1) : 0;
}
/** `Glaze.parallax` as the shaders see it — and **0 whenever the material has
 *  no `texture`**, which is the guard this function exists for.
 *
 *  The parallax term re-samples the material's OWN albedo. A material with no
 *  albedo has nothing to re-sample, and the two backends do not fail the same
 *  way when asked to anyway: WebGL2's sampler uniform sits at texture unit 0,
 *  so an unbound material reads whatever the PREVIOUS draw left bound there,
 *  while WebGPU falls to its 1x1 blank and reads white. Neither raises an
 *  error, neither looks like a bug in a screenshot, and the WebGL2 half changes
 *  with draw order — so it would come and go as the scene was re-sorted.
 *
 *  This is the shape of bug that once cost a whole course its detail blend by
 *  quietly handing a material a sampler nobody had configured. One test in one
 *  place is not enough for it; the resolution has to be somewhere neither
 *  backend can skip. */
export function glazeParallax(material) {
    if (!material.texture)
        return 0;
    const parallax = material.glaze?.parallax ?? 0;
    return Number.isFinite(parallax) ? parallax : 0;
}
/** Whether `Material.settle` has anything to lay on: a wash with no `up` and no
 *  usable `rise` is an object that costs a normalize and changes nothing.
 *  Resolved here so both backends agree on which materials skip the branch. */
export function settleActive(material) {
    const settle = material.settle;
    if (!settle)
        return false;
    const up = settle.up ?? 0;
    const rise = settle.rise ?? 0;
    const riseAmount = settle.riseAmount ?? 0;
    return up > 0 || (rise > 0 && riseAmount > 0);
}
/** The fog mode as the shaders see it. Resolved here rather than in each
 *  backend so WebGL2 and WebGPU cannot drift apart, and so the guards against
 *  a divide-by-zero live in one place. `params` means `(start, end, unused)`
 *  for linear, `(start, density, attenuation)` for the exponentials and
 *  `(height, range, attenuation)` for layered. */
export function fogUniform(fog) {
    const attenuation = Math.max(fog.attenuation ?? 5, 1e-3);
    switch (fog.mode ?? "exponential") {
        case "linear": {
            const start = fog.start ?? 0;
            // An end at or before the start is a zero-width ramp; nudge it so the
            // shader's division stays finite and the fog reads as a hard cut.
            return { mode: 0, params: [start, Math.max(fog.end ?? 300, start + 1e-3), 0] };
        }
        case "exponentialSquared":
            return { mode: 2, params: [fog.start ?? 0, fog.density ?? 0.3, attenuation] };
        case "layered":
            return { mode: 3, params: [fog.height ?? 0, Math.max(fog.range ?? 1.2, 1e-3), attenuation] };
        default:
            return { mode: 1, params: [fog.start ?? 0, fog.density ?? 0.3, attenuation] };
    }
}
/** A node with sane defaults: identity transform, no mesh. Spread over it to
 *  set what you care about. */
export function node(init = {}) {
    return {
        position: { x: 0, y: 0, z: 0 },
        rotation: Quat.create(),
        scale: { x: 1, y: 1, z: 1 },
        ...init,
    };
}
/** An empty scene lit well enough to see something immediately: one key light
 *  from over the viewer's shoulder, modest ambient, transparent background. */
export function createScene(init = {}) {
    return {
        nodes: [],
        lights: [{ direction: { x: -0.4, y: -1, z: -0.6 }, intensity: 1 }],
        ambient: [0.32, 0.34, 0.4],
        background: [0, 0, 0, 0],
        ...init,
    };
}
/** Append a node and return its index — the handle a child passes as `parent`
 *  and an animation track uses as its target.
 *
 *  Throws when the parent index is not already in the scene: that is the
 *  ordering invariant this file depends on, and a forward reference would
 *  otherwise show up as a mesh silently stuck at the origin. */
export function addNode(scene, n) {
    if (n.parent !== undefined && (n.parent < 0 || n.parent >= scene.nodes.length)) {
        throw new Error(`Node3D parent ${n.parent} must be an index already in the scene (length ${scene.nodes.length}) — parents come first.`);
    }
    scene.nodes.push(n);
    return scene.nodes.length - 1;
}
/** Index of the first node with this name, or −1. */
export function findNode(scene, name) {
    return scene.nodes.findIndex((n) => n.name === name);
}
/** Resolve every node's world matrix from its TRS and its parent chain — one
 *  forward pass, no recursion, which is only correct because parents precede
 *  children. Call once per frame after animating, before rendering. */
export function updateWorldMatrices(scene) {
    for (const n of scene.nodes) {
        const local = Mat4.compose(n.position, n.rotation, n.scale, (n.world ?? (n.world = Mat4.create())));
        if (n.parent !== undefined) {
            const parent = scene.nodes[n.parent].world;
            // The parent was resolved earlier in this same loop.
            if (parent)
                Mat4.mul(parent, local, n.world);
        }
    }
    // A joint matrix transforms a vertex from mesh space to the current joint
    // pose: inverse(meshWorld) × jointWorld × inverseBind. Keeping these on the
    // scene node makes animation and rendering independent of a particular GPU
    // backend, and is also useful to a CPU renderer or an exporter.
    const inverseMesh = Mat4.create();
    const jointPose = Mat4.create();
    const jointMatrix = Mat4.create();
    for (const n of scene.nodes) {
        const skin = n.skin;
        if (!skin)
            continue;
        const count = skin.joints.length;
        if (skin.inverseBindMatrices.length < count * 16) {
            throw new Error(`Skin3D needs ${count} inverse bind matrices.`);
        }
        if (!skin.matrices || skin.matrices.length !== count * 16) {
            skin.matrices = new Float32Array(count * 16);
        }
        const meshInverse = n.world && Mat4.invert(n.world, inverseMesh);
        for (let i = 0; i < count; i++) {
            const joint = scene.nodes[skin.joints[i]];
            const destination = skin.matrices.subarray(i * 16, i * 16 + 16);
            if (!joint?.world || !meshInverse) {
                Mat4.identity(destination);
                continue;
            }
            const bind = skin.inverseBindMatrices.subarray(i * 16, i * 16 + 16);
            Mat4.mul(joint.world, bind, jointPose);
            Mat4.mul(meshInverse, jointPose, jointMatrix);
            destination.set(jointMatrix);
        }
    }
}
/** The material a node's `occludedAlpha` ghost pass draws with: the same
 *  surface, blended, at a fraction of the alpha it was authored with.
 *
 *  Both backends call this so the two agree on what the ghost looks like —
 *  which they have to, since a scene is expected to render the same either
 *  way. The alpha is scaled rather than replaced, so a surface that was
 *  already half transparent gives a fainter ghost than a solid one, and
 *  `transparent` is forced on because the ghost is blended whatever the node
 *  is. */
export function ghostMaterial(material) {
    const color = material.color ?? [1, 1, 1, 1];
    const alpha = color[3] * (material.occludedAlpha ?? 0);
    return {
        ...material,
        transparent: true,
        occludedAlpha: 0,
        color: [...color.slice(0, 3), alpha],
    };
}
/** True when the node, or anything it hangs off, is hidden. Visibility is
 *  inherited even though `hidden` itself is not — hiding a limb hides the hand
 *  on it, which is the only useful reading. */
export function isVisible(scene, index) {
    let at = index;
    while (at !== undefined) {
        const n = scene.nodes[at];
        if (n.hidden)
            return false;
        at = n.parent;
    }
    return true;
}
