/** View-frustum culling: which nodes the camera can possibly see.
 *
 *  A renderer without this draws every mesh in the scene every frame, however
 *  far behind the camera it is. That is fine for a scene of a dozen meshes and
 *  it is the wrong shape for a level: cost is set by how much of the WORLD
 *  exists rather than by how much of it is on screen, so a bigger level is
 *  slower everywhere, including in the corner the player is looking at.
 *
 *  ## What it does and does not buy
 *
 *  It removes DRAW CALLS and the vertex work behind them. It does nothing about
 *  overdraw: geometry that is on screen still shades every pixel it covers, and
 *  a scene that is slow because one huge surface fills the view is not helped by
 *  any of this. So the win scales with how much of a level is off screen —
 *  which, for a game that looks at one part of a level at a time, is most of it.
 *
 *  ## Bounds, and why they are cheap
 *
 *  Every mesh gets a local axis-aligned box, computed once from its positions
 *  and cached against `MeshData.version` so a rewritten mesh — a particle batch,
 *  say — recomputes and a static one never does.
 *
 *  A node's world box is that local box through its world matrix, by the
 *  standard centre/extent transform: the centre goes through the matrix as a
 *  point, and the half-extent through the matrix's absolute value as a vector.
 *  It is the tightest box that is still axis-aligned in world space, and for a
 *  rotated mesh it is bigger than the mesh — which only ever means an object is
 *  kept that could have been dropped, never the reverse.
 *
 *  ## The test
 *
 *  Six planes off the view-projection (Gribb & Hartmann: each plane is a row of
 *  the matrix added to or subtracted from the w row), and a box is out when it
 *  lies entirely behind any one of them. That is conservative in the corners —
 *  a box can be outside the frustum while straddling every plane — and the
 *  false keep costs one draw, where a false drop would be a hole in the world.
 */
/** Cached per mesh, keyed by the version the bounds were computed at. */
const cache = new WeakMap();
/** One mesh's local box, computed once per version of the mesh.
 *
 *  Null for a mesh with no vertices, which cannot be culled meaningfully and
 *  cannot be drawn either. */
export function meshBounds(mesh) {
    const version = mesh.version ?? 0;
    const cached = cache.get(mesh);
    if (cached && cached.version === version)
        return cached.bounds;
    const positions = mesh.positions;
    let bounds = null;
    if (positions.length >= 3) {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        for (let at = 0; at + 2 < positions.length; at += 3) {
            const x = positions[at];
            const y = positions[at + 1];
            const z = positions[at + 2];
            if (x < minX)
                minX = x;
            if (y < minY)
                minY = y;
            if (z < minZ)
                minZ = z;
            if (x > maxX)
                maxX = x;
            if (y > maxY)
                maxY = y;
            if (z > maxZ)
                maxZ = z;
        }
        // A mesh whose positions are all NaN — or one collapsed to nothing by a
        // pooled emitter with no live particles — leaves the extremes untouched.
        if (Number.isFinite(minX) && Number.isFinite(maxX)) {
            bounds = {
                cx: (minX + maxX) / 2,
                cy: (minY + maxY) / 2,
                cz: (minZ + maxZ) / 2,
                ex: (maxX - minX) / 2,
                ey: (maxY - minY) / 2,
                ez: (maxZ - minZ) / 2,
            };
        }
    }
    cache.set(mesh, { version, bounds });
    return bounds;
}
/** The six planes of a view-projection matrix, normalized so the plane test is
 *  a real distance rather than an arbitrary scale.
 *
 *  `zeroToOne` picks the depth convention, and it is not cosmetic: the NEAR
 *  plane is the one row that differs. OpenGL-style clip space keeps `-w <= z`,
 *  so its near plane is `w + z`; WebGPU's keeps `0 <= z`, so its near plane is
 *  `z` alone. Passing the wrong one culls geometry just in front of the camera,
 *  or fails to cull anything behind it — pass the same flag the projection was
 *  built with.
 *
 *  `out` is filled and returned, so a renderer keeps one array for the life of
 *  the frame loop. */
export function frustumPlanes(viewProj, out, zeroToOne = false) {
    const m = viewProj;
    const planes = out ?? new Float32Array(24);
    // Column-major, as everywhere in this engine: `m[column * 4 + row]`.
    const set = (index, a, b, c, d) => {
        const length = Math.hypot(a, b, c) || 1;
        planes[index * 4] = a / length;
        planes[index * 4 + 1] = b / length;
        planes[index * 4 + 2] = c / length;
        planes[index * 4 + 3] = d / length;
    };
    set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
    set(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
    set(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
    set(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
    if (zeroToOne)
        set(4, m[2], m[6], m[10], m[14]);
    else
        set(4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
    set(5, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
    return planes;
}
/** Whether a mesh's local box, placed by `world`, is anywhere the frustum can
 *  see it.
 *
 *  Answers true for anything it cannot rule out — no bounds, no matrix, a
 *  degenerate transform — because the cost of keeping something needlessly is
 *  one draw call and the cost of dropping something wrongly is a hole in the
 *  scene. */
export function inFrustum(planes, bounds, world) {
    if (!bounds || !world)
        return true;
    const m = world;
    // The box's centre as a point through the matrix.
    const cx = m[0] * bounds.cx + m[4] * bounds.cy + m[8] * bounds.cz + m[12];
    const cy = m[1] * bounds.cx + m[5] * bounds.cy + m[9] * bounds.cz + m[13];
    const cz = m[2] * bounds.cx + m[6] * bounds.cy + m[10] * bounds.cz + m[14];
    // And the half-extent through its absolute value, which is the axis-aligned
    // box that contains the rotated one.
    const ex = Math.abs(m[0]) * bounds.ex + Math.abs(m[4]) * bounds.ey + Math.abs(m[8]) * bounds.ez;
    const ey = Math.abs(m[1]) * bounds.ex + Math.abs(m[5]) * bounds.ey + Math.abs(m[9]) * bounds.ez;
    const ez = Math.abs(m[2]) * bounds.ex + Math.abs(m[6]) * bounds.ey + Math.abs(m[10]) * bounds.ez;
    for (let plane = 0; plane < 6; plane++) {
        const a = planes[plane * 4];
        const b = planes[plane * 4 + 1];
        const c = planes[plane * 4 + 2];
        const d = planes[plane * 4 + 3];
        // How far the centre is from the plane, against how far the box reaches
        // towards it. Entirely on the outside is the only case that drops.
        const distance = a * cx + b * cy + c * cz + d;
        const reach = Math.abs(a) * ex + Math.abs(b) * ey + Math.abs(c) * ez;
        if (distance + reach < 0)
            return false;
    }
    return true;
}
