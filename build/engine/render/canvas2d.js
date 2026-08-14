// ---------- Canvas2D scene adapter ----------
// The default renderer has no separate scene layer: `Draw.sprite` / `sprites` /
// `tiles` / `particles` keep their original Canvas2D loops in `draw.ts`. This
// no-op exists so the `SceneRenderer` interface has a canvas-side inhabitant; it
// is not wired by `createApp`.
export function createCanvas2DRenderer() {
    return {
        kind: "canvas",
        beginFrame() { },
        endFrame() { },
        resize() { },
        setTransform(_m) { },
        sprites(_list, _opts) { },
        blitImage() { },
        fillQuad(_dx, _dy, _dw, _dh, _rgba) { },
        setClip() { },
        destroy() { },
    };
}
