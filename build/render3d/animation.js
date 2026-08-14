// ---------- Keyframe animation ----------
// Tracks over node transforms, in the shape glTF stores them: parallel arrays
// of times and values rather than an array of keyframe objects. That is not
// premature optimisation — it is the format a loader already has, and turning
// it into objects would allocate per keyframe for no gain, since sampling only
// ever reads two of them.
//
// A clip does not own a playhead. `sampleClip` takes the time, so the caller
// decides whether that time comes from the fixed step, an interpolated render
// clock, a scrub bar or a network snapshot — the same choice the rest of the
// engine leaves open.
import { Quat } from "../math/quat.js";
/** Build a clip and derive its duration from the tracks — the duration is
 *  almost always "as long as the longest track", and computing it by hand is
 *  a reliable source of a clip that ends a frame early. */
export function createClip(name, tracks, duration) {
    const derived = duration ??
        tracks.reduce((max, t) => Math.max(max, t.times.length ? t.times[t.times.length - 1] : 0), 0);
    return { name, duration: derived, tracks };
}
const scratchA = { x: 0, y: 0, z: 0, w: 1 };
const scratchB = { x: 0, y: 0, z: 0, w: 1 };
/** Write a clip's value at `time` into the scene's nodes.
 *
 *  Does NOT update world matrices — call `updateWorldMatrices` after sampling
 *  every clip you intend to apply, so that layering two clips costs one
 *  hierarchy walk rather than two.
 *
 *  `loop` wraps the time into the clip; false clamps to the ends, which is
 *  what a one-shot needs so it settles on its final pose instead of snapping
 *  back to the first frame. */
export function sampleClip(scene, clip, time, loop = true) {
    let t = time;
    if (clip.duration > 0) {
        // A negative time (rewinding, or a clock that started mid-frame) must wrap
        // forward, which `%` alone does not do in JS.
        if (loop)
            t = ((time % clip.duration) + clip.duration) % clip.duration;
        else
            t = Math.min(clip.duration, Math.max(0, time));
    }
    for (const track of clip.tracks) {
        const node = scene.nodes[track.node];
        if (!node)
            continue;
        applyTrack(node, track, t);
    }
}
function applyTrack(node, track, t) {
    const times = track.times;
    const n = times.length;
    if (n === 0)
        return;
    const stride = track.property === "rotation" ? 4 : 3;
    const v = track.values;
    // Find the keyframe pair bracketing t.
    let i1 = upperBound(times, t);
    if (i1 <= 0)
        return writeKey(node, track, v, 0, stride);
    if (i1 >= n)
        return writeKey(node, track, v, n - 1, stride);
    const i0 = i1 - 1;
    if (track.interpolation === "step")
        return writeKey(node, track, v, i0, stride);
    const span = times[i1] - times[i0];
    // Two keys at the same time is a legal hard cut; dividing by the span would
    // give NaN, so take the later one.
    const alpha = span > 0 ? (t - times[i0]) / span : 1;
    if (track.property === "rotation") {
        Quat.set(scratchA, v[i0 * 4], v[i0 * 4 + 1], v[i0 * 4 + 2], v[i0 * 4 + 3]);
        Quat.set(scratchB, v[i1 * 4], v[i1 * 4 + 1], v[i1 * 4 + 2], v[i1 * 4 + 3]);
        Quat.slerp(scratchA, scratchB, alpha, node.rotation);
        return;
    }
    const target = track.property === "position" ? node.position : node.scale;
    const a = i0 * 3;
    const b = i1 * 3;
    target.x = v[a] + (v[b] - v[a]) * alpha;
    target.y = v[a + 1] + (v[b + 1] - v[a + 1]) * alpha;
    target.z = v[a + 2] + (v[b + 2] - v[a + 2]) * alpha;
}
function writeKey(node, track, v, index, stride) {
    const o = index * stride;
    if (track.property === "rotation") {
        Quat.set(node.rotation, v[o], v[o + 1], v[o + 2], v[o + 3]);
        return;
    }
    const target = track.property === "position" ? node.position : node.scale;
    target.x = v[o];
    target.y = v[o + 1];
    target.z = v[o + 2];
}
/** Index of the first element strictly greater than `t`. Binary search rather
 *  than a linear scan with a cached cursor: a scrub bar and a networked replay
 *  both jump around, and a cursor that assumes forward playback is wrong
 *  exactly when it matters. */
function upperBound(times, t) {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
}
/** A rotation track that spins a node about an axis, as three keys a third of
 *  a turn apart.
 *
 *  Three keys, not two: slerp takes the SHORTEST arc, so a full turn expressed
 *  as start → end would find the two identical and never move, and a half turn
 *  would pick an arbitrary direction. Thirds make each hop unambiguous. */
export function spinTrack(node, seconds, axis = { x: 0, y: 1, z: 0 }) {
    const q = Quat.create();
    const values = new Float32Array(4 * 4);
    const times = new Float32Array(4);
    for (let i = 0; i < 4; i++) {
        Quat.fromAxisAngle(q, axis.x, axis.y, axis.z, (i / 3) * Math.PI * 2);
        values.set([q.x, q.y, q.z, q.w], i * 4);
        times[i] = (i / 3) * seconds;
    }
    return { node, property: "rotation", times, values };
}
