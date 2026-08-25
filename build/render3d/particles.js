/** A particle emitter that draws as one ordinary mesh.
 *
 *  There is no particle STAGE in either backend and this deliberately does not
 *  add one. An emitter owns a `MeshData` sized for its capacity, rewrites the
 *  vertices every `update`, and bumps `MeshData.version` so the backend
 *  re-uploads. Put that mesh on a `Node3D` with a transparent material and it
 *  draws like anything else — same lighting opt-out, same sorting, same
 *  culling, both backends, no new shader.
 *
 *  The trade is one draw call per EMITTER rather than per particle, which is
 *  the number that matters: a scene with a hundred emitters of thirty
 *  particles each is a hundred draws, not three thousand. Instancing would beat
 *  it, but only once the per-emitter count is much larger than these, and it
 *  would cost a shader permutation in each backend to find out.
 *
 *  ## Space
 *
 *  Particles live in the emitter node's LOCAL space, so moving or turning the
 *  node carries them with it. That means billboarding needs the camera in that
 *  space too, which is what `update`'s `view` argument is — use `localViewer`
 *  to work it out from the node's world matrix.
 *
 *  ## Capacity
 *
 *  Fixed, and allocated once. Particles beyond it are not emitted rather than
 *  replacing a live one, and the unused tail of the mesh is collapsed to a
 *  degenerate quad at the origin. A fixed length is what keeps a version bump
 *  a rewrite rather than a reallocation.
 */
import { Mat4 } from "../math/mat4.js";
import { Vec3 } from "../math/vec3.js";
/** Where the camera is in a node's local space.
 *
 *  Billboarding has to happen in the space the particles are simulated in, and
 *  a node under a rotated or scaled parent is not in world space. Pass the
 *  node's `world` matrix — `updateWorldMatrices` fills it — and the camera's
 *  world position. A matrix that cannot be inverted (a zero scale somewhere up
 *  the chain) gives the camera position back unchanged, which is wrong but
 *  finite; the node is not being drawn at a sane size anyway. */
export function localViewer(world, camera, out = { x: 0, y: 0, z: 0 }) {
    const inverse = world ? Mat4.invert(world, scratchMatrix) : null;
    if (!inverse) {
        out.x = camera.x;
        out.y = camera.y;
        out.z = camera.z;
        return out;
    }
    const m = inverse;
    const w = m[3] * camera.x + m[7] * camera.y + m[11] * camera.z + m[15] || 1;
    out.x = (m[0] * camera.x + m[4] * camera.y + m[8] * camera.z + m[12]) / w;
    out.y = (m[1] * camera.x + m[5] * camera.y + m[9] * camera.z + m[13]) / w;
    out.z = (m[2] * camera.x + m[6] * camera.y + m[10] * camera.z + m[14]) / w;
    return out;
}
/** Which way WORLD UP points in a node's local space.
 *
 *  The companion to `localViewer`, and needed for the same reason. Three of the
 *  billboard modes are defined against the world's up — `horizontal` lies in the
 *  ground plane, `vertical` stands upright, `billboard` keeps its own top as
 *  near vertical as the view allows — and all three are COMPUTED in the space
 *  the particles are simulated in. Under a node with any rotation on it those
 *  are different directions, so an emitter on a node turned a quarter circle
 *  drew its flat ring standing on edge and its upright cards lying flat.
 *
 *  Pass this to `update` alongside `localViewer`. A node with no rotation gives
 *  `(0, 1, 0)` back and nothing changes, which is the ordinary case.
 *
 *  A DIRECTION, so the matrix's translation is not applied: the second column of
 *  the inverse is `inverse * (0, 1, 0)`. A matrix that cannot be inverted gives
 *  world up back unchanged, matching `localViewer`'s answer for the same case. */
export function localUp(world, out = { x: 0, y: 0, z: 0 }) {
    const inverse = world ? Mat4.invert(world, scratchMatrix) : null;
    if (!inverse) {
        out.x = 0;
        out.y = 1;
        out.z = 0;
        return out;
    }
    const length = Math.hypot(inverse[4], inverse[5], inverse[6]) || 1;
    out.x = inverse[4] / length;
    out.y = inverse[5] / length;
    out.z = inverse[6] / length;
    return out;
}
const scratchMatrix = Mat4.create();
function pick(range, random) {
    return typeof range === "number" ? range : range[0] + (range[1] - range[0]) * random();
}
function highest(range) {
    return typeof range === "number" ? range : Math.max(range[0], range[1]);
}
export function createEmitter(opts) {
    const random = opts.random ?? Math.random;
    const lifetime = opts.lifetime;
    const speed = opts.speed ?? 0;
    const mode = opts.mode ?? "billboard";
    const source = mode === "mesh" ? opts.mesh : undefined;
    if (mode === "mesh" && (!source || source.positions.length === 0)) {
        throw new Error('A particle emitter in "mesh" mode needs a non-empty mesh.');
    }
    const sizeX = opts.size.x;
    const sizeY = opts.size.y;
    const sizeZ = opts.size.z ?? sizeX;
    const lengthScale = opts.lengthScale ?? 1;
    const gravity = opts.gravity ?? 0;
    const color = opts.color ?? [1, 1, 1, 1];
    const sheet = opts.sheet;
    const cycles = sheet?.cycles ?? 1;
    const frames = sheet ? Math.max(1, sheet.columns * sheet.rows) : 1;
    const bursts = opts.bursts ?? [];
    const duration = Math.max(0, opts.duration ?? 0);
    const looping = opts.loop ?? true;
    const burstPerCycle = bursts.reduce((sum, burst) => sum + Math.ceil(highest(burst.count)) * Math.max(1, burst.cycles ?? 1), 0);
    const overlappingCycles = looping && duration > 0 ? Math.ceil(highest(lifetime) / duration) + 1 : 1;
    // One more than the steady state, because the particle emitted on the frame
    // the oldest one dies is briefly the (n+1)th.
    const capacity = Math.max(1, opts.capacity ??
        Math.ceil(opts.rate * highest(lifetime)) + burstPerCycle * overlappingCycles + 1);
    const rotate = (x, y, z, rx, ry, rz, out) => {
        const sx = Math.sin(rx);
        const cx = Math.cos(rx);
        const sy = Math.sin(ry);
        const cy = Math.cos(ry);
        const sz = Math.sin(rz);
        const cz = Math.cos(rz);
        const y1 = y * cx - z * sx;
        const z1 = y * sx + z * cx;
        const x2 = x * cy + z1 * sy;
        const z2 = -x * sy + z1 * cy;
        out.x = x2 * cz - y1 * sz;
        out.y = x2 * sz + y1 * cz;
        out.z = z2;
    };
    const shapeRotation = opts.shapeRotation ?? { x: 0, y: 0, z: 0 };
    const offset = opts.offset ?? { x: 0, y: 0, z: 0 };
    const turned = { x: 0, y: 0, z: 0 };
    // Cocos' own defaults for the two that are usually left alone
    // (`cc.13039.js:52496-52526`): a solid disc through a full turn.
    const circle = opts.circle;
    const circleRadius = circle?.radius ?? 0;
    const circleInner = circleRadius * (1 - (circle?.radiusThickness ?? 1));
    const circleArc = circle?.arc ?? Math.PI * 2;
    const direction = { x: 0, y: 0, z: 1 };
    if (opts.direction) {
        const d = opts.direction;
        const length = Math.hypot(d.x, d.y, d.z);
        if (length > 0) {
            direction.x = d.x / length;
            direction.y = d.y / length;
            direction.z = d.z / length;
        }
    }
    rotate(direction.x, direction.y, direction.z, shapeRotation.x, shapeRotation.y, shapeRotation.z, turned);
    direction.x = turned.x;
    direction.y = turned.y;
    direction.z = turned.z;
    // Struct-of-arrays, sized once. `age` is NaN for a slot that is free, which
    // is one test rather than a parallel liveness array.
    const px = new Float32Array(capacity);
    const py = new Float32Array(capacity);
    const pz = new Float32Array(capacity);
    const vx = new Float32Array(capacity);
    const vy = new Float32Array(capacity);
    const vz = new Float32Array(capacity);
    const age = new Float32Array(capacity).fill(NaN);
    const life = new Float32Array(capacity);
    const scaleX = new Float32Array(capacity);
    const scaleY = new Float32Array(capacity);
    const scaleZ = new Float32Array(capacity);
    const rotationX = new Float32Array(capacity);
    const rotationY = new Float32Array(capacity);
    const rotationZ = new Float32Array(capacity);
    const angularX = new Float32Array(capacity);
    const angularY = new Float32Array(capacity);
    const angularZ = new Float32Array(capacity);
    const verticesPerParticle = source ? source.positions.length / 3 : 4;
    const sourceIndices = source?.indices ?? new Uint16Array([0, 1, 2, 0, 2, 3]);
    const indicesPerParticle = sourceIndices.length;
    const positions = new Float32Array(capacity * verticesPerParticle * 3);
    const uvs = new Float32Array(capacity * verticesPerParticle * 2);
    const colors = new Float32Array(capacity * verticesPerParticle * 4);
    const normals = new Float32Array(capacity * verticesPerParticle * 3);
    const indices = capacity * verticesPerParticle > 65535
        ? new Uint32Array(capacity * indicesPerParticle)
        : new Uint16Array(capacity * indicesPerParticle);
    // One particle's worth of vertex colour: `color` with the source mesh's own
    // per-vertex colours already multiplied in. Every particle in the batch is
    // this, and `colorOverTime` scales it — so the product is worked out once here
    // rather than per particle per frame.
    const particleColor = new Float32Array(verticesPerParticle * 4);
    for (let vertex = 0; vertex < verticesPerParticle; vertex++) {
        const sourceColor = source?.colors;
        for (let channel = 0; channel < 4; channel++) {
            particleColor[vertex * 4 + channel] =
                color[channel] * (sourceColor?.[vertex * 4 + channel] ?? 1);
        }
    }
    for (let i = 0; i < capacity; i++) {
        const v = i * verticesPerParticle;
        const o = i * indicesPerParticle;
        for (let at = 0; at < indicesPerParticle; at++)
            indices[o + at] = v + sourceIndices[at];
        // Colours never vary per corner, and without a `colorOverTime` they never
        // vary over a life either — so they are written once here rather than every
        // frame.
        colors.set(particleColor, v * 4);
    }
    const mesh = { positions, normals, uvs, colors, indices, version: 0 };
    let pending = 0;
    let emitting = true;
    let alive = 0;
    let emissionTime = 0;
    let burstStarted = false;
    function spawn() {
        let slot = -1;
        for (let i = 0; i < capacity; i++) {
            if (Number.isNaN(age[i])) {
                slot = i;
                break;
            }
        }
        // Full. Dropping the particle rather than recycling the oldest keeps a
        // burst from cutting live ones short, which reads as flicker.
        if (slot < 0)
            return;
        let bx = 0;
        let by = 0;
        let bz = 0;
        // The distance the circle put the particle from its centre, which is also
        // what turns its position back into its outward direction below. Zero for
        // every other shape, and those use the emitter's one `direction` instead.
        let radial = 0;
        if (circle) {
            // Angle first, then distance. Cocos draws them in that order
            // (`generateArcAngle` is evaluated into the argument list before `LH`
            // lerps the radius), and a caller that passes a seeded `random` to
            // reproduce a burst gets a different disc if they are swapped.
            const angle = circleArc * random();
            radial = circleInner + (circleRadius - circleInner) * random();
            bx = Math.cos(angle) * radial;
            by = Math.sin(angle) * radial;
        }
        else if (opts.box) {
            bx = (random() - 0.5) * opts.box.x;
            by = (random() - 0.5) * opts.box.y;
            bz = (random() - 0.5) * opts.box.z;
        }
        rotate(bx, by, bz, shapeRotation.x, shapeRotation.y, shapeRotation.z, turned);
        px[slot] = turned.x + offset.x;
        py[slot] = turned.y + offset.y;
        pz[slot] = turned.z + offset.z;
        const launch = pick(speed, random);
        if (circle) {
            // `velocity = normalize(position) * speed`, with the shape rotation
            // applied to it exactly as it was to the position — Cocos rotates both
            // by the same quat at the end of `emit`. A Euler rotation preserves
            // length, so the already-rotated offset divided by the radius it was
            // born at IS the rotated unit radius: no second rotate, and no second
            // normalize to disagree with the first about the last bit.
            //
            // Dead centre there is no radius to point along and the particle does
            // not move, which is what Cocos' `Vec3.normalize` returns for a zero
            // vector, and it keeps `radius: 0` from writing NaN into the whole mesh.
            const outward = radial > 0 ? launch / radial : 0;
            vx[slot] = turned.x * outward;
            vy[slot] = turned.y * outward;
            vz[slot] = turned.z * outward;
        }
        else {
            vx[slot] = direction.x * launch;
            vy[slot] = direction.y * launch;
            vz[slot] = direction.z * launch;
        }
        age[slot] = 0;
        life[slot] = Math.max(1e-4, pick(lifetime, random));
        scaleX[slot] = pick(sizeX, random);
        scaleY[slot] = pick(sizeY, random);
        scaleZ[slot] = pick(sizeZ, random);
        rotationX[slot] = pick(opts.rotation?.x ?? 0, random);
        rotationY[slot] = pick(opts.rotation?.y ?? 0, random);
        rotationZ[slot] = pick(opts.rotation?.z ?? 0, random);
        angularX[slot] = pick(opts.angularVelocity?.x ?? 0, random);
        angularY[slot] = pick(opts.angularVelocity?.y ?? 0, random);
        angularZ[slot] = pick(opts.angularVelocity?.z ?? 0, random);
        alive++;
    }
    /** The slack the burst window is compared with, on BOTH ends. An emission
     *  time accumulated one frame at a time never lands exactly on a multiple of
     *  `duration`, so a cycle boundary has to be recognised from either side of
     *  it or the burst that starts the cycle is lost. */
    const BURST_EPSILON = 1e-9;
    function fireBursts(start, end, includeStart) {
        if (bursts.length === 0)
            return;
        const firstCycle = looping && duration > 0 ? Math.max(0, Math.floor(start / duration)) : 0;
        // `end + BURST_EPSILON`, matching the test below, and NOT `end`. The two
        // used to disagree: a frame whose `end` fell a hair SHORT of the next
        // boundary never considered that cycle at all, and the following frame —
        // whose `start` is the same number — then rejected the event for being
        // within `BURST_EPSILON` of its start. The window belonged to neither
        // frame and the burst was dropped. With a regular timestep that repeats at
        // every boundary until accumulated float error drifts the other way, which
        // is minutes of a looping effect emitting nothing: MEASURED at a fixed
        // 1/60 on a `duration: 1.5`, `lifetime: 1.5`, one-particle-per-cycle
        // emitter, dark from 1.5 s to 9.0 s.
        const lastCycle = looping && duration > 0 ? Math.max(0, Math.floor((end + BURST_EPSILON) / duration)) : 0;
        for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
            if (!looping && cycle > 0)
                break;
            const origin = looping && duration > 0 ? cycle * duration : 0;
            for (const burst of bursts) {
                const repetitions = Math.max(1, Math.floor(burst.cycles ?? 1));
                const interval = Math.max(0, burst.interval ?? 0);
                for (let repeat = 0; repeat < repetitions; repeat++) {
                    const local = Math.max(0, burst.time ?? 0) + repeat * interval;
                    if (duration > 0 && local > duration)
                        continue;
                    const event = origin + local;
                    const afterStart = includeStart
                        ? event >= start - BURST_EPSILON
                        : event > start + BURST_EPSILON;
                    if (!afterStart || event > end + BURST_EPSILON)
                        continue;
                    const probability = Math.max(0, Math.min(1, burst.probability ?? 1));
                    if (probability <= 0 || (probability < 1 && random() > probability))
                        continue;
                    const count = Math.max(0, Math.floor(pick(burst.count, random)));
                    for (let n = 0; n < count; n++)
                        spawn();
                }
            }
        }
    }
    /** WORLD up, in the space the particles are simulated in — see `localUp`.
     *  `(0, 1, 0)` unless `update` is handed something else, which is every node
     *  that carries no rotation. */
    const worldUp = { x: 0, y: 1, z: 0 };
    /** Any unit vector square to `worldUp`, for the two cases that need a second
     *  axis and do not care which: the flat quad's own U, and the fallback for a
     *  streak flying straight at the camera. Gram-Schmidt against whichever
     *  cardinal axis `worldUp` leans on least, so the default `(0, 1, 0)` gives
     *  `(1, 0, 0)` back and the flat quad spans X and Z exactly as it always
     *  did. */
    const worldRight = { x: 1, y: 0, z: 0 };
    /** Refill `worldRight` for the current `worldUp`. */
    function squareToUp() {
        const ax = Math.abs(worldUp.x);
        const ay = Math.abs(worldUp.y);
        const az = Math.abs(worldUp.z);
        let hx = 0;
        let hy = 0;
        let hz = 0;
        if (ax <= ay && ax <= az)
            hx = 1;
        else if (ay <= az)
            hy = 1;
        else
            hz = 1;
        const dot = hx * worldUp.x + hy * worldUp.y + hz * worldUp.z;
        worldRight.x = hx - worldUp.x * dot;
        worldRight.y = hy - worldUp.y * dot;
        worldRight.z = hz - worldUp.z * dot;
        const length = Math.hypot(worldRight.x, worldRight.y, worldRight.z) || 1;
        worldRight.x /= length;
        worldRight.y /= length;
        worldRight.z /= length;
    }
    /** `sizeOverTime`'s answer for the particle being written, reused across
     *  every particle of every frame. */
    const sizeScale = { x: 1, y: 1, z: 1 };
    const sizeOverTime = opts.sizeOverTime;
    /** Fill `sizeScale` for one particle, or leave it at 1 when nothing was
     *  passed. */
    function scaleAt(slot) {
        if (!sizeOverTime)
            return;
        sizeScale.x = 1;
        sizeScale.y = 1;
        sizeScale.z = 1;
        const span = life[slot];
        sizeOverTime(span > 0 ? Math.min(1, age[slot] / span) : 0, sizeScale);
    }
    /** `colorOverTime`'s answer for the particle being written, reused for
     *  `sizeScale`'s reason. */
    const colorScale = { r: 1, g: 1, b: 1, a: 1 };
    const colorOverTime = opts.colorOverTime;
    /** Write one live particle's colour at its place in the batch.
     *
     *  Called from the write loop rather than from the two writers, because a
     *  colour is a colour whichever way the geometry was laid down — and only when
     *  a curve was passed, since the construction-time fill is already the answer
     *  without one. */
    function colorAt(slot, index) {
        if (!colorOverTime)
            return;
        colorScale.r = 1;
        colorScale.g = 1;
        colorScale.b = 1;
        colorScale.a = 1;
        const span = life[slot];
        colorOverTime(span > 0 ? Math.min(1, age[slot] / span) : 0, colorScale);
        const at = index * verticesPerParticle * 4;
        for (let vertex = 0; vertex < verticesPerParticle; vertex++) {
            const from = vertex * 4;
            const target = at + from;
            colors[target] = particleColor[from] * colorScale.r;
            colors[target + 1] = particleColor[from + 1] * colorScale.g;
            colors[target + 2] = particleColor[from + 2] * colorScale.b;
            colors[target + 3] = particleColor[from + 3] * colorScale.a;
        }
    }
    const right = { x: 0, y: 0, z: 0 };
    const up = { x: 0, y: 0, z: 0 };
    const toView = { x: 0, y: 0, z: 0 };
    const along = { x: 0, y: 0, z: 0 };
    function writeQuad(slot, index, view) {
        const x = px[slot];
        const y = py[slot];
        const z = pz[slot];
        toView.x = view.x - x;
        toView.y = view.y - y;
        toView.z = view.z - z;
        const viewLength = Math.hypot(toView.x, toView.y, toView.z) || 1;
        toView.x /= viewLength;
        toView.y /= viewLength;
        toView.z /= viewLength;
        scaleAt(slot);
        let halfWidth = (scaleX[slot] * sizeScale.x) / 2;
        let halfHeight = (scaleY[slot] * sizeScale.y) / 2;
        // How far along `right` the quad's centre is pushed. Zero for every mode
        // but `stretched`, which anchors its head on the particle instead of
        // straddling it — see below.
        let shift = 0;
        /** Whether the sprite is laid down reversed along the stretch. */
        let flipU = false;
        if (mode === "horizontal") {
            // The plane square to world up. `worldRight` is that plane's U and
            // `cross(U, up)` is its V, which for an unrotated node is the X and Z
            // this used to write out as literals.
            right.x = worldRight.x;
            right.y = worldRight.y;
            right.z = worldRight.z;
            up.x = worldRight.y * worldUp.z - worldRight.z * worldUp.y;
            up.y = worldRight.z * worldUp.x - worldRight.x * worldUp.z;
            up.z = worldRight.x * worldUp.y - worldRight.y * worldUp.x;
        }
        else if (mode === "vertical") {
            // Yaw only: the horizontal perpendicular to the view, and world up.
            // Taken per particle rather than from one camera basis, so a card close
            // to the camera turns to face IT rather than to face the way the camera
            // is pointing — the same thing at any distance, and better up close.
            //
            // `cross(worldUp, toView)`, the same axis and the same sign as the
            // `billboard` branch below — see the note there for what the mirrored
            // one costs. Here `up` is world up rather than derived, so the mirror
            // did not turn the quad over; it drew every sprite back to front.
            right.x = worldUp.y * toView.z - worldUp.z * toView.y;
            right.y = worldUp.z * toView.x - worldUp.x * toView.z;
            right.z = worldUp.x * toView.y - worldUp.y * toView.x;
            if (Math.hypot(right.x, right.y, right.z) < 1e-6) {
                // Directly above or below: no yaw resolves it, so pick one.
                right.x = worldRight.x;
                right.y = worldRight.y;
                right.z = worldRight.z;
            }
            Vec3.normalize(right, right);
            up.x = worldUp.x;
            up.y = worldUp.y;
            up.z = worldUp.z;
        }
        else if (mode === "stretched" && Math.hypot(vx[slot], vy[slot], vz[slot]) > 1e-6) {
            const speedNow = Math.hypot(vx[slot], vy[slot], vz[slot]);
            along.x = vx[slot] / speedNow;
            along.y = vy[slot] / speedNow;
            along.z = vz[slot] / speedNow;
            // The stretch runs along the sprite's U axis, not its V — so `right` is
            // the velocity and `up` is the perpendicular, which is the opposite of
            // the other two modes.
            //
            // This is not a free choice. A streak texture is drawn the way a streak
            // is read, left to right along the image, so a sheet's frames are wide
            // and short; stretching down V instead would take a 128x16 line, squeeze
            // its length into the quad's width and smear its 16-pixel thickness over
            // the whole trail. It is also what the engines that ship this mode do.
            //
            // **u decreases with the velocity, and that is a correction.** This used
            // to read the other way — u increasing toward the head, on the reasoning
            // that a frame drawn left to right should point the way the particle is
            // going. Reported from play against the one consumer with a directional
            // stretched sheet: both the course fans and the wind power-up blew
            // visibly backwards while every heading in their data was correct, and
            // the stretch axis is the only thing those two share.
            //
            // Cocos stretches along the quad's V instead — `camUp = velocity *
            // velocityScale + normalize(velocity) * lengthScale * s.y` — so its
            // sprites are authored against a different axis AND a different sense
            // from the one this mode was written to. Stretching along U is still
            // right for the art (a 2x8 sheet's cells are wide and short, so U is the
            // line's own length); which END of U leads is what was wrong.
            flipU = true;
            right.x = along.x;
            right.y = along.y;
            right.z = along.z;
            Vec3.cross(along, toView, up);
            if (Math.hypot(up.x, up.y, up.z) < 1e-6) {
                // Flying straight at the camera: any perpendicular will do, and the
                // quad is edge-on enough that which one is not visible.
                const alongUp = along.x * worldUp.x + along.y * worldUp.y + along.z * worldUp.z;
                const helper = Math.abs(alongUp) < 0.9 ? worldUp : worldRight;
                Vec3.cross(along, helper, up);
            }
            Vec3.normalize(up, up);
            halfWidth = (scaleY[slot] * sizeScale.y * lengthScale) / 2;
            halfHeight = (scaleX[slot] * sizeScale.x) / 2;
            // A streak shows where a particle has BEEN, so its head sits ON the
            // particle and the tail runs back down the velocity. Centring it instead
            // draws half the trail in front of the thing making it.
            shift = -halfWidth;
        }
        else {
            // Square-on. Cross with world up first, so the quad's own up stays as
            // near vertical as the view allows rather than rolling with the camera.
            //
            // This IS `cross(worldUp, toView)` written out — `(0,1,0) x (tx,ty,tz)`
            // is `(tz, 0, -tx)` — and the sign is the whole of it. The mirrored
            // `(-tz, 0, tx)` points camera-LEFT, and because `up` is then derived
            // from it the quad came out turned a half circle about the view axis:
            // BOTH u and v reversed, which is a rotation and not a mirror, so it
            // reads as upside down rather than as back to front. Six of the seven
            // billboard sheets a consumer ships are radially symmetric — sparks,
            // snow, ring bursts — and a half turn is invisible on those, which is
            // why this stood for so long. It was found on a heart.
            right.x = worldUp.y * toView.z - worldUp.z * toView.y;
            right.y = worldUp.z * toView.x - worldUp.x * toView.z;
            right.z = worldUp.x * toView.y - worldUp.y * toView.x;
            if (Math.hypot(right.x, right.y, right.z) < 1e-6) {
                // Directly above or below: no yaw resolves it, so pick one.
                right.x = worldRight.x;
                right.y = worldRight.y;
                right.z = worldRight.z;
            }
            Vec3.normalize(right, right);
            Vec3.cross(toView, right, up);
            Vec3.normalize(up, up);
            // **The authored ROLL, about the view axis.** `rotation.z` used to reach
            // authored-mesh particles only, so a billboard drawn from a sheet whose
            // art is not square-on came out flat however it was authored — a stroke
            // puff authored at 75 degrees drew at 0 and read as the wrong shape at
            // the wrong size, because a long sprite laid across the view is not the
            // same picture as one laid along it.
            //
            // Rolled by turning the basis rather than the corners, so the sheet, the
            // shift and the size all ride along with no second place to keep in step.
            const roll = rotationZ[slot];
            if (roll !== 0) {
                const cos = Math.cos(roll);
                const sin = Math.sin(roll);
                const rx = right.x * cos + up.x * sin;
                const ry = right.y * cos + up.y * sin;
                const rz = right.z * cos + up.z * sin;
                up.x = up.x * cos - right.x * sin;
                up.y = up.y * cos - right.y * sin;
                up.z = up.z * cos - right.z * sin;
                right.x = rx;
                right.y = ry;
                right.z = rz;
            }
        }
        let frame = 0;
        if (sheet) {
            const t = age[slot] / life[slot];
            const progress = sheet.frameOverTime ? sheet.frameOverTime(t) : t * cycles * frames;
            frame = Math.min(frames - 1, Math.max(0, Math.floor(progress) % frames));
        }
        const column = sheet ? frame % sheet.columns : 0;
        const row = sheet ? Math.floor(frame / sheet.columns) : 0;
        const uLow = sheet ? column / sheet.columns : 0;
        const uHigh = sheet ? (column + 1) / sheet.columns : 1;
        // A stretched quad lays its sprite down reversed along the streak — see
        // `flipU`. Swapped here rather than by negating `right`, which would take
        // the shift and the perpendicular with it and turn the quad over instead of
        // mirroring the image on it.
        const u0 = flipU ? uHigh : uLow;
        const u1 = flipU ? uLow : uHigh;
        // `v = 0` is the top of the texture here, as everywhere in this engine, so
        // the sheet reads left to right and top to bottom the way it is drawn.
        const v0 = sheet ? row / sheet.rows : 0;
        const v1 = sheet ? (row + 1) / sheet.rows : 1;
        const base = index * 4;
        const corners = [
            [-halfWidth, halfHeight, u0, v0],
            [halfWidth, halfHeight, u1, v0],
            [halfWidth, -halfHeight, u1, v1],
            [-halfWidth, -halfHeight, u0, v1],
        ];
        for (let corner = 0; corner < 4; corner++) {
            const [across, along2, u, v] = corners[corner];
            const p = (base + corner) * 3;
            positions[p] = x + right.x * (across + shift) + up.x * along2;
            positions[p + 1] = y + right.y * (across + shift) + up.y * along2;
            positions[p + 2] = z + right.z * (across + shift) + up.z * along2;
            // Facing the camera, so an emitter drawn with a lit material is lit
            // evenly rather than going dark as it turns. Most callers use `unlit`.
            normals[p] = toView.x;
            normals[p + 1] = toView.y;
            normals[p + 2] = toView.z;
            const t = (base + corner) * 2;
            uvs[t] = u;
            uvs[t + 1] = v;
        }
    }
    function writeMesh(slot, index, view) {
        if (!source)
            return;
        scaleAt(slot);
        // The yaw that puts the model's front on the viewer, in place of the
        // authored one — see `faceCamera`. `toView` is this frame's particle-to-eye
        // vector, and `atan2(x, z)` is the turn about world up that aims +Z down
        // it, which is the same convention the rest of this engine reads a heading
        // in.
        let yaw = rotationY[slot];
        if (opts.faceCamera) {
            const toEyeX = view.x - px[slot];
            const toEyeZ = view.z - pz[slot];
            if (Math.abs(toEyeX) > 1e-6 || Math.abs(toEyeZ) > 1e-6) {
                yaw = Math.atan2(toEyeX, toEyeZ);
            }
        }
        const meshX = scaleX[slot] * sizeScale.x;
        const meshY = scaleY[slot] * sizeScale.y;
        const meshZ = scaleZ[slot] * sizeScale.z;
        let frame = 0;
        if (sheet) {
            const t = age[slot] / life[slot];
            const progress = sheet.frameOverTime ? sheet.frameOverTime(t) : t * cycles * frames;
            frame = Math.min(frames - 1, Math.max(0, Math.floor(progress) % frames));
        }
        const column = sheet ? frame % sheet.columns : 0;
        const row = sheet ? Math.floor(frame / sheet.columns) : 0;
        const u0 = sheet ? column / sheet.columns : 0;
        const v0 = sheet ? row / sheet.rows : 0;
        const du = sheet ? 1 / sheet.columns : 1;
        const dv = sheet ? 1 / sheet.rows : 1;
        const base = index * verticesPerParticle;
        for (let vertex = 0; vertex < verticesPerParticle; vertex++) {
            const sourcePosition = vertex * 3;
            rotate(source.positions[sourcePosition] * meshX, source.positions[sourcePosition + 1] * meshY, source.positions[sourcePosition + 2] * meshZ, rotationX[slot], yaw, rotationZ[slot], turned);
            const target = (base + vertex) * 3;
            positions[target] = px[slot] + turned.x;
            positions[target + 1] = py[slot] + turned.y;
            positions[target + 2] = pz[slot] + turned.z;
            const sourceNormal = source.normals;
            rotate((sourceNormal?.[sourcePosition] ?? 0) / Math.max(1e-6, Math.abs(meshX)), (sourceNormal?.[sourcePosition + 1] ?? 1) / Math.max(1e-6, Math.abs(meshY)), (sourceNormal?.[sourcePosition + 2] ?? 0) / Math.max(1e-6, Math.abs(meshZ)), rotationX[slot], rotationY[slot], rotationZ[slot], turned);
            const normalLength = Math.hypot(turned.x, turned.y, turned.z) || 1;
            normals[target] = turned.x / normalLength;
            normals[target + 1] = turned.y / normalLength;
            normals[target + 2] = turned.z / normalLength;
            const sourceUv = vertex * 2;
            const targetUv = (base + vertex) * 2;
            uvs[targetUv] = u0 + (source.uvs?.[sourceUv] ?? 0) * du;
            uvs[targetUv + 1] = v0 + (source.uvs?.[sourceUv + 1] ?? 0) * dv;
        }
    }
    function collapse(from) {
        // Every unused quad becomes four coincident vertices at the origin, which
        // rasterizes to nothing. Cheaper than shrinking the index buffer, and it
        // keeps the array lengths fixed so a version bump stays a rewrite.
        positions.fill(0, from * verticesPerParticle * 3);
    }
    return {
        mesh,
        get alive() {
            return alive;
        },
        pause() {
            emitting = false;
        },
        resume() {
            emitting = true;
        },
        reset() {
            age.fill(NaN);
            alive = 0;
            pending = 0;
            emissionTime = 0;
            burstStarted = false;
            collapse(0);
            mesh.version = (mesh.version ?? 0) + 1;
        },
        update(dtSeconds, view, up) {
            // Read every frame rather than at construction: a node's rotation can
            // change, and the caller recomputes this from its world matrix as it
            // recomputes `view`.
            worldUp.x = up?.x ?? 0;
            worldUp.y = up?.y ?? 1;
            worldUp.z = up?.z ?? 0;
            squareToUp();
            if (dtSeconds > 0) {
                for (let i = 0; i < capacity; i++) {
                    if (Number.isNaN(age[i]))
                        continue;
                    age[i] += dtSeconds;
                    if (age[i] >= life[i]) {
                        age[i] = NaN;
                        alive--;
                        continue;
                    }
                    vy[i] -= gravity * dtSeconds;
                    px[i] += vx[i] * dtSeconds;
                    py[i] += vy[i] * dtSeconds;
                    pz[i] += vz[i] * dtSeconds;
                    rotationX[i] += angularX[i] * dtSeconds;
                    rotationY[i] += angularY[i] * dtSeconds;
                    rotationZ[i] += angularZ[i] * dtSeconds;
                }
                if (emitting) {
                    const start = emissionTime;
                    const end = emissionTime + dtSeconds;
                    const activeRateSeconds = !looping && duration > 0
                        ? Math.max(0, Math.min(end, duration) - Math.min(start, duration))
                        : dtSeconds;
                    pending += opts.rate * activeRateSeconds;
                    // Whole particles only, with the fraction carried — otherwise a rate
                    // below one per frame emits nothing at all.
                    while (pending >= 1) {
                        pending -= 1;
                        spawn();
                    }
                    fireBursts(start, end, !burstStarted);
                    burstStarted = true;
                    emissionTime = end;
                }
            }
            let written = 0;
            for (let i = 0; i < capacity; i++) {
                if (Number.isNaN(age[i]))
                    continue;
                if (source)
                    writeMesh(i, written, view);
                else
                    writeQuad(i, written, view);
                colorAt(i, written);
                written++;
            }
            collapse(written);
            mesh.version = (mesh.version ?? 0) + 1;
        },
    };
}
