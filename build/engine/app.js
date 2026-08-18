import { applyFullscreen, preventNavigation } from "../engine/fullscreen.js";
import { createClockApi } from "../clock/index.js";
import { createWebGL2Renderer } from "./render/webgl2.js";
import { createDraw } from "./draw.js";
import { createLoop } from "./loop.js";
import { isEditableTarget } from "./dom.js";
// Two fresh presses within this window count as a double-press / double-click;
// the pointer variant also requires the second press to land within
// DOUBLE_CLICK_SLOP logical px of the first.
const DOUBLE_PRESS_MS = 300;
const DOUBLE_CLICK_SLOP = 24;
/** `PointerEvent.button` for the right mouse button. Touches report 0. */
const SECONDARY_BUTTON = 2;
/** Spiral-of-death guard: the most simulated time one frame may spend catching
 *  up; any further backlog is dropped (better a one-off slow-motion hitch than
 *  a feedback loop of ever-longer frames). Expressed in MILLISECONDS, not in
 *  steps — the budget is about how long the loop is allowed to block, which
 *  doesn't change just because a game runs a finer step. (This is 5 steps at
 *  the default 60fps, which is where the number comes from.) */
const MAX_CATCHUP_MS = (5 * 1000) / 60;
const DEFAULT_PREVENT_KEYS = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
function resolveCanvas(canvas) {
    if (typeof canvas !== "string")
        return canvas;
    const el = document.getElementById(canvas);
    if (!el)
        throw new Error(`Minimotor: canvas "#${canvas}" not found in the DOM`);
    return el;
}
function buildRuntime(options) {
    const pauseOnPortrait = options.pauseOnPortrait ?? false;
    const fps = options.stepsPerSecond ?? options.fps ?? 60;
    if (!Number.isFinite(fps) || fps <= 0) {
        throw new RangeError("Minimotor: stepsPerSecond must be a finite number greater than 0");
    }
    const stepMs = 1000 / fps;
    let maxFps = options.maxFps ?? 0;
    /** Time since the last frame that was actually DRAWN, which is what the drawn
     *  frame is handed as its delta. Equal to the frame delta when uncapped. */
    let sinceDraw = 0;
    const maxCatchupSteps = Math.max(1, Math.round(MAX_CATCHUP_MS / stepMs));
    const canvas = resolveCanvas(options.canvas);
    const fitWindow = options.fitWindow !== false;
    // The viewport is a LIVE object: same identity forever, fields mutated in
    // place on resize — holders never go stale.
    const viewport = readViewport(canvas, options.resolution, fitWindow);
    const ctx = viewport.ctx;
    const background = options.background ?? null;
    const barColor = options.barColor ?? "#000";
    const letterboxed = !!options.resolution;
    const rendererOpt = options.renderer ?? "canvas";
    let sceneRenderer = null;
    if (rendererOpt === "webgl" || rendererOpt === "auto") {
        sceneRenderer = createWebGL2Renderer(canvas, {
            background,
            required: rendererOpt === "webgl",
        });
    }
    if (background && !sceneRenderer)
        canvas.style.background = background;
    // Touches on the app's canvas belong to the app (widgets run their own
    // scroll/drag physics). Without `touch-action:none`, mobile browsers claim a
    // touch drag for native panning/zoom — iOS Safari then fires `pointercancel`
    // and stops sending moves, so every swipe gesture dies after a few px. The
    // user-select/callout bits keep long presses from opening the iOS text
    // loupe/callout on the canvas. (The fullscreen CSS sets the same, page-wide.)
    canvas.style.touchAction = "none";
    canvas.style.userSelect = "none";
    canvas.style.setProperty("-webkit-user-select", "none");
    canvas.style.setProperty("-webkit-touch-callout", "none");
    /** Re-apply the base (letterbox) transform — logical coords → device px.
     *  Used at frame start and by screen-space UI escaping a camera block. */
    const resetTransform = () => {
        // The letterbox offset is generally fractional; round the DEVICE-space
        // translation so the frame origin sits on a whole device pixel (logical
        // coordinates are untouched — only the origin snaps).
        ctx.setTransform(viewport.dpr * viewport.scale, 0, 0, viewport.dpr * viewport.scale, Math.round(viewport.dpr * viewport.offsetX), Math.round(viewport.dpr * viewport.offsetY));
    };
    const clearFrame = () => {
        if (letterboxed) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = barColor;
            if (background || sceneRenderer) {
                // The play area gets its own `background` fill below — paint only the
                // actual bar strips (device px) instead of the whole canvas. With a
                // GL scene the overlay play area stays transparent, so bars-only is
                // required even when `background` is omitted.
                const ox = Math.round(viewport.dpr * viewport.offsetX);
                const oy = Math.round(viewport.dpr * viewport.offsetY);
                const right = ox + viewport.w * viewport.scale * viewport.dpr;
                const bottom = oy + viewport.h * viewport.scale * viewport.dpr;
                if (ox > 0)
                    ctx.fillRect(0, 0, ox, canvas.height);
                if (right < canvas.width)
                    ctx.fillRect(right, 0, canvas.width - right, canvas.height);
                if (oy > 0)
                    ctx.fillRect(0, 0, canvas.width, oy);
                if (bottom < canvas.height)
                    ctx.fillRect(0, bottom, canvas.width, canvas.height - bottom);
            }
            else {
                // No background → the engine doesn't clear the play area; the full-
                // canvas bar fill doubles as the frame clear. Keep it.
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            ctx.restore();
        }
        if (sceneRenderer) {
            // Overlay play area must stay transparent so the GL scene shows through.
            if (typeof ctx.clearRect === "function")
                ctx.clearRect(0, 0, viewport.w, viewport.h);
        }
        else if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, viewport.w, viewport.h);
        }
    };
    // Run the app's draw callback, clipped to the logical viewport when the
    // stage is letterboxed — otherwise a following camera or a world larger than
    // the stage spills past the WxH box into the bars.
    const drawClipped = () => {
        if (!letterboxed) {
            callbacks.draw(ctx);
            return;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, viewport.w, viewport.h);
        ctx.clip();
        try {
            callbacks.draw(ctx);
        }
        finally {
            ctx.restore();
        }
    };
    // ---- Input state (polled; edge sets are cleared once a step consumes them) ----
    const heldKeys = new Set();
    const pressedKeys = new Set();
    const releasedKeys = new Set();
    // Double-press: a fresh press within DOUBLE_MS of the previous fresh press of
    // the same key (auto-repeat ignored). Cleared with the other edge sets, so
    // `doublePressed` is true for exactly one step, like `pressed`.
    const doublePressedKeys = new Set();
    const lastKeyDownAt = new Map();
    const heldKeyValues = new Set();
    const pressedKeyValues = new Set();
    const releasedKeyValues = new Set();
    const keyValueByCode = new Map();
    const keys = {
        down: (code) => heldKeys.has(code),
        pressed: (code) => pressedKeys.has(code),
        released: (code) => releasedKeys.has(code),
        doublePressed: (code) => doublePressedKeys.has(code),
        keyDown: (key) => heldKeyValues.has(key),
        keyPressed: (key) => pressedKeyValues.has(key),
        keyReleased: (key) => releasedKeyValues.has(key),
    };
    const ptr = {
        x: -1,
        y: -1,
        inside: false,
        down: false,
        pressed: false,
        released: false,
        doublePressed: false,
        frameDoublePressed: false,
        frameReleased: false,
        framePressed: false,
        stepPressed: false,
        stepReleased: false,
        pressX: -1,
        pressY: -1,
        wheel: 0,
        secondaryDown: false,
        secondaryPressed: false,
        secondaryReleased: false,
    };
    let lastPointerDownAt = Number.NEGATIVE_INFINITY;
    let lastPointerDownX = 0;
    let lastPointerDownY = 0;
    const pointer = {
        get x() {
            return ptr.x;
        },
        get y() {
            return ptr.y;
        },
        get inside() {
            return ptr.inside;
        },
        get down() {
            return ptr.down;
        },
        get pressed() {
            return ptr.pressed;
        },
        get released() {
            return ptr.released;
        },
        get doublePressed() {
            return ptr.doublePressed;
        },
        get frameDoublePressed() {
            return ptr.frameDoublePressed;
        },
        get frameReleased() {
            return ptr.frameReleased;
        },
        get framePressed() {
            return ptr.framePressed;
        },
        get stepPressed() {
            return ptr.stepPressed;
        },
        get stepReleased() {
            return ptr.stepReleased;
        },
        get pressX() {
            return ptr.pressX;
        },
        get pressY() {
            return ptr.pressY;
        },
        get wheel() {
            return ptr.wheel;
        },
        secondary: {
            get down() {
                return ptr.secondaryDown;
            },
            get pressed() {
                return ptr.secondaryPressed;
            },
            get released() {
                return ptr.secondaryReleased;
            },
        },
        get touches() {
            return touchesLive;
        },
    };
    const touchById = new Map();
    const touchPool = [];
    const touchesLive = [];
    let primaryId = null;
    function eventPointerId(e) {
        if ("pointerId" in e && typeof e.pointerId === "number") {
            return e.pointerId;
        }
        return undefined;
    }
    function pointerIdOrMouse(e) {
        return eventPointerId(e) ?? 1;
    }
    // ---- Frame state ----
    let frameDelta = stepMs;
    const timings = { updateMs: 0, drawMs: 0, steps: 0 };
    let paused = false;
    let callbacks = null;
    let running = false;
    let destroyed = false;
    let lastTime = 0;
    let accumulator = 0;
    let stepsElapsed = 0;
    const preventKeys = new Set(options.preventKeys ?? DEFAULT_PREVENT_KEYS);
    const onKeyDown = (e) => {
        // Native controls backing UI.textInput/UI.select own their keystrokes.
        // Do not prevent Space/arrows or leak typing into app actions.
        if (isEditableTarget(e.target))
            return;
        if (preventKeys.has(e.code))
            e.preventDefault();
        if (!heldKeys.has(e.code)) {
            pressedKeys.add(e.code); // ignore auto-repeat
            pressedKeyValues.add(e.key);
            heldKeyValues.add(e.key);
            keyValueByCode.set(e.code, e.key);
            const t = performance.now();
            if (t - (lastKeyDownAt.get(e.code) ?? Number.NEGATIVE_INFINITY) <= DOUBLE_PRESS_MS) {
                doublePressedKeys.add(e.code);
            }
            lastKeyDownAt.set(e.code, t);
        }
        heldKeys.add(e.code);
    };
    const onKeyUp = (e) => {
        heldKeys.delete(e.code); // also clear a held key if focus changed mid-hold
        const key = keyValueByCode.get(e.code) ?? e.key;
        keyValueByCode.delete(e.code);
        heldKeyValues.delete(key);
        if (isEditableTarget(e.target))
            return;
        releasedKeys.add(e.code);
        releasedKeyValues.add(key);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // getBoundingClientRect forces a layout read; pointermove fires at 100+ Hz,
    // so cache the rect and re-read only after resize/scroll.
    let canvasRect = null;
    const invalidateRect = () => {
        canvasRect = null;
    };
    const clientToLogical = (e) => {
        if (!canvasRect)
            canvasRect = canvas.getBoundingClientRect();
        // Client → canvas-CSS px (normalize any CSS stretch), then invert the
        // letterbox base transform (offset + scale) to logical coordinates.
        const cw = canvas.width / viewport.dpr;
        const ch = canvas.height / viewport.dpr;
        const cssX = canvasRect.width > 0 ? ((e.clientX - canvasRect.left) * cw) / canvasRect.width : 0;
        const cssY = canvasRect.height > 0 ? ((e.clientY - canvasRect.top) * ch) / canvasRect.height : 0;
        const x = (cssX - viewport.offsetX) / viewport.scale;
        const y = (cssY - viewport.offsetY) / viewport.scale;
        const inside = x >= 0 && y >= 0 && x <= viewport.w && y <= viewport.h;
        return { x, y, inside };
    };
    const applyPrimaryPos = (x, y, inside) => {
        ptr.x = x;
        ptr.y = y;
        ptr.inside = inside;
    };
    const setPointer = (e) => {
        const p = clientToLogical(e);
        applyPrimaryPos(p.x, p.y, p.inside);
    };
    const addTouch = (id, x, y) => {
        let t = touchById.get(id);
        if (t) {
            t.x = x;
            t.y = y;
            t.down = true;
            return t;
        }
        t = touchPool.pop() ?? { id: 0, x: 0, y: 0, down: true };
        t.id = id;
        t.x = x;
        t.y = y;
        t.down = true;
        touchById.set(id, t);
        touchesLive.push(t);
        return t;
    };
    const dropTouch = (id) => {
        const t = touchById.get(id);
        if (!t)
            return false;
        touchById.delete(id);
        const i = touchesLive.indexOf(t);
        if (i >= 0)
            touchesLive.splice(i, 1);
        t.down = false;
        touchPool.push(t);
        return true;
    };
    const dropAllTouches = () => {
        for (const t of touchesLive) {
            t.down = false;
            touchPool.push(t);
        }
        touchesLive.length = 0;
        touchById.clear();
        primaryId = null;
    };
    const adoptPrimary = (id) => {
        primaryId = id;
        const t = touchById.get(id);
        if (!t)
            return;
        applyPrimaryPos(t.x, t.y, t.x >= 0 && t.y >= 0 && t.x <= viewport.w && t.y <= viewport.h);
    };
    const markDoublePress = () => {
        ptr.doublePressed = true; // one update step (consumed like `pressed`)
        ptr.frameDoublePressed = true; // whole frame, for draw-phase UI
    };
    /** Believe `buttons` over the events we were given, for a MOUSE.
     *
     *  `pointerup` is bound to the window, which catches a release anywhere on
     *  the page — but not one outside it. Press a button, drag off the window,
     *  let go: no event ever arrives and the button stays down for ever. Held
     *  buttons drive drags, so the symptom is a camera that will not stop
     *  turning, reported from play as *"if both pointers are held down, and then
     *  released, the camera gets stuck in rotate mode"*.
     *
     *  Every pointer event carries `buttons`, a live bitmask of what is held
     *  right now — 1 primary, 2 secondary — so the next move over the page says
     *  what was missed. Dropped WITHOUT minting a release edge, exactly as
     *  `onPointerCancel` does and for the same reason: a release nobody saw must
     *  not read as a click.
     *
     *  Mouse only. A touch pointer reports `buttons: 1` while it is down and
     *  vanishes when it lifts, so there is nothing to reconcile and a stale
     *  `buttons` from a lifted finger would drop a live one.
     *
     *  Gated on `pointerType` being MOUSE rather than on it not being touch, and
     *  that is deliberate: `buttons` is 0 both when nothing is held and when the
     *  event never set it, and those cannot be told apart. A synthetic
     *  `MouseEvent` — what a page driving the canvas by hand sends, and what most
     *  of this repo's own tests dispatch — carries neither field, so reading it
     *  as a mouse with no buttons held would cancel every drag on its first move.
     *  A real `PointerEvent` always carries both. */
    const reconcileButtons = (e) => {
        if (e.pointerType !== "mouse")
            return;
        const held = e.buttons ?? 0;
        if (ptr.secondaryDown && (held & 2) === 0)
            ptr.secondaryDown = false;
        if (ptr.down && (held & 1) === 0 && touchById.size > 0) {
            dropAllTouches();
            ptr.down = false;
        }
    };
    const onPointerMove = (e) => {
        const p = clientToLogical(e);
        reconcileButtons(e);
        const id = pointerIdOrMouse(e);
        const tracked = touchById.get(id);
        if (tracked) {
            tracked.x = p.x;
            tracked.y = p.y;
        }
        if (touchById.size === 0 || id === primaryId)
            applyPrimaryPos(p.x, p.y, p.inside);
    };
    const onPointerDown = (e) => {
        const p = clientToLogical(e);
        // The right button is its own gesture. Letting it mint a primary press
        // means every UI button fires on right-click and every drag handler starts
        // on one, which is never what an app wants.
        if (e.button === SECONDARY_BUTTON) {
            applyPrimaryPos(p.x, p.y, p.inside);
            if (!ptr.secondaryDown)
                ptr.secondaryPressed = true;
            ptr.secondaryDown = true;
            return;
        }
        const id = pointerIdOrMouse(e);
        addTouch(id, p.x, p.y);
        if (primaryId !== null && id !== primaryId)
            return;
        primaryId = id;
        applyPrimaryPos(p.x, p.y, p.inside);
        const t = performance.now();
        // Fast-path / touch double-tap: a second press within DOUBLE_PRESS_MS and
        // close to the first. The native `dblclick` listener below additionally
        // fires on the OS's own double-click interval (usually wider) so a mouse
        // double-click matches the user's system setting exactly — the two union.
        if (t - lastPointerDownAt <= DOUBLE_PRESS_MS &&
            Math.hypot(p.x - lastPointerDownX, p.y - lastPointerDownY) <= DOUBLE_CLICK_SLOP) {
            markDoublePress();
        }
        lastPointerDownAt = t;
        lastPointerDownX = p.x;
        lastPointerDownY = p.y;
        ptr.down = true;
        ptr.pressed = true;
        ptr.framePressed = true; // survives the steps; cleared at frame end
        ptr.stepPressed = true; // survives until a STEP has seen it
        // Where the press landed, which is not where the pointer will be by the
        // time a step reads it: a flick moves several pixels inside one frame.
        ptr.pressX = p.x;
        ptr.pressY = p.y;
    };
    // The browser's `dblclick` respects the OS double-click SPEED and slop — the
    // faithful "same as on my system" window, which no API exposes to read.
    const onDblClick = (e) => {
        setPointer(e);
        markDoublePress();
    };
    // `deltaY` is only in PIXELS when `deltaMode` says so. Firefox reports a
    // mouse notch as 3 LINES and a page key as 1 PAGE; taking the raw number
    // makes the same gesture ~33× weaker there than in Chrome, which reads as
    // "the wheel doesn't work" rather than as a units bug. A macOS trackpad
    // swipe is already pixels — many small deltas — and needs no conversion.
    const LINE_PX = 16;
    const onWheel = (e) => {
        const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? viewport.h : 1;
        ptr.wheel += e.deltaY * scale;
    };
    const onPointerUp = (e) => {
        const p = clientToLogical(e);
        if (e.button === SECONDARY_BUTTON) {
            applyPrimaryPos(p.x, p.y, p.inside);
            if (ptr.secondaryDown)
                ptr.secondaryReleased = true;
            ptr.secondaryDown = false;
            return;
        }
        const id = pointerIdOrMouse(e);
        const wasPrimary = id === primaryId;
        dropTouch(id);
        if (touchById.size === 0) {
            primaryId = null;
            applyPrimaryPos(p.x, p.y, p.inside);
            ptr.down = false;
            ptr.released = true;
            ptr.frameReleased = true; // survives the steps; cleared at frame end
            ptr.stepReleased = true; // survives until a STEP has seen it
            return;
        }
        if (wasPrimary)
            adoptPrimary(touchesLive[0].id);
    };
    // The browser stole the gesture mid-drag (system pan/zoom, a notification
    // pull, the iOS loupe): no pointerup ever comes, only this. Drop `down` so
    // in-flight drags end cleanly instead of sticking until the next tap — but
    // mint NO release edge (a canceled gesture must not read as a click). The
    // event's coordinates are unreliable per spec, so the position stays put.
    // A cancel without `pointerId` (tests, some synthetic events) drops every
    // active pointer, matching the old single-pointer behaviour.
    const onPointerCancel = (e) => {
        const id = eventPointerId(e);
        if (id === undefined) {
            dropAllTouches();
            ptr.down = false;
            ptr.secondaryDown = false;
            return;
        }
        const wasPrimary = id === primaryId;
        dropTouch(id);
        ptr.secondaryDown = false;
        if (touchById.size === 0) {
            primaryId = null;
            ptr.down = false;
            return;
        }
        if (wasPrimary)
            adoptPrimary(touchesLive[0].id);
    };
    // iOS runs its own zoom/selection gestures even under `touch-action:none`:
    // pinch (`gesturestart`/`change`/`end`), double-tap zoom (the second tap's
    // `touchend`) and the double-tap-and-HOLD loupe (the second tap's
    // `touchstart`, plus `selectstart`). Swallow them ON THE CANVAS ONLY —
    // unlike the fullscreen guards (page-wide, see fullscreen.ts), a windowed
    // canvas must leave the rest of the page's gestures alone. Pointer events
    // fire BEFORE their touch counterparts, so the engine's input — including
    // its pointerdown-timing double-press — is unaffected; and the UI's hidden
    // native editors are separate elements, so their taps never land here.
    let lastTouchStartAt = -Infinity;
    let lastTouchEndAt = -Infinity;
    const stopGesture = (e) => e.preventDefault();
    const onTouchStart = (e) => {
        const now = performance.now();
        if (now - lastTouchStartAt <= 300 && e.touches.length === 1)
            e.preventDefault();
        lastTouchStartAt = now;
    };
    const onTouchEnd = (e) => {
        const now = performance.now();
        if (now - lastTouchEndAt <= 300)
            e.preventDefault();
        lastTouchEndAt = now;
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    // A right-drag on the canvas belongs to the app, and the native menu popping
    // up on press cancels it before the first move arrives. Canvas only — the
    // rest of the page keeps its menu.
    canvas.addEventListener("contextmenu", stopGesture);
    canvas.addEventListener("dblclick", onDblClick);
    window.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    /** Losing the window ends every gesture in flight.
     *
     *  The other half of `reconcileButtons`. That one heals on the next move over
     *  the page, which is the right answer for a release that happened outside
     *  the window — but it needs a move to arrive, and a gesture interrupted by
     *  alt-tab, a system dialog or a notification may get none for a long time.
     *  Meanwhile a held button is still driving whatever it was driving.
     *
     *  Dropped with no release edge, `onPointerCancel`'s rule: the app never saw
     *  a release and must not act as though it had. Registered unconditionally
     *  rather than beside the pause handling, which is behind options an app may
     *  not have asked for — this is correctness, not a policy. */
    const onWindowBlur = () => {
        dropAllTouches();
        ptr.down = false;
        ptr.secondaryDown = false;
    };
    window.addEventListener("blur", onWindowBlur);
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
        canvas.addEventListener(type, stopGesture, { passive: false });
    }
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("selectstart", stopGesture);
    window.addEventListener("scroll", invalidateRect, true);
    /** Drop edge-triggered input once the update step it belongs to has run, so a
     *  press fires for exactly one step (never twice when a slow frame runs
     *  multiple steps). */
    function consumeEdges() {
        pressedKeys.clear();
        releasedKeys.clear();
        doublePressedKeys.clear();
        pressedKeyValues.clear();
        releasedKeyValues.clear();
        ptr.pressed = false;
        ptr.released = false;
        ptr.doublePressed = false;
        ptr.secondaryPressed = false;
        ptr.secondaryReleased = false;
    }
    const stepHandlers = new Set();
    const stepStartHandlers = new Set();
    const frameHandlers = new Set();
    const destroyHandlers = new Set();
    const resizeHandlers = new Set();
    // Per-frame cursor request (setCursor): applied at frame end, then reset —
    // a hover cursor clears itself the frame the hover stops. The HIGHEST
    // priority wins (ties → last writer), so e.g. a drop target's "copy" beats a
    // drag source's "grabbing" no matter which draws first.
    let cursorRequest = null;
    let cursorPriority = -1;
    /** Fixed steps run since the last `endFrame`, which is what says whether the
     *  frame-latched step edges have been observed yet. */
    let stepsThisFrame = 0;
    const endFrame = () => {
        for (const h of frameHandlers)
            h();
        const cursor = cursorRequest ?? "";
        if (canvas.style.cursor !== cursor)
            canvas.style.cursor = cursor;
        cursorRequest = null;
        cursorPriority = -1;
        ptr.frameReleased = false;
        ptr.framePressed = false;
        ptr.frameDoublePressed = false;
        // **Only once a STEP has seen them.** A frame shorter than one fixed step
        // runs the loop zero times, and clearing here regardless would drop the
        // press entirely for any reader that runs in `update` — which is every
        // reader that has to act on the world rather than on the UI. At 120 steps
        // a second on a 120 Hz display that is not an edge case, it is every other
        // frame. See `stepPressed`.
        if (stepsThisFrame > 0) {
            ptr.stepPressed = false;
            ptr.stepReleased = false;
        }
        stepsThisFrame = 0;
        ptr.wheel = 0;
    };
    // Raw resize events fire continuously during a window drag, and readViewport
    // touches the canvas backing store — coalesce to at most one readViewport
    // per animation frame (the running loop applies the flag at frame start; a
    // stopped/paused-loop stage schedules a one-off rAF so it still adapts).
    let resizeDirty = false;
    let resizeRaf = 0;
    /** Returns whether it actually re-read the viewport, which the loop needs:
     *  reassigning `canvas.width`/`height` reallocates and CLEARS the backing
     *  store, so a frame that resizes and is then skipped by the frame-rate cap
     *  shows an empty canvas. Dragging a window edge with a cap on produced a
     *  steady flicker that way — every skipped frame was a cleared one. */
    const applyResize = () => {
        if (!resizeDirty)
            return false;
        resizeDirty = false;
        Object.assign(viewport, readViewport(canvas, options.resolution, fitWindow)); // live: mutate in place
        canvasRect = null;
        sceneRenderer?.resize();
        for (const h of resizeHandlers)
            h(viewport);
        return true;
    };
    const handleResize = () => {
        resizeDirty = true;
        if (running || resizeRaf)
            return;
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            applyResize();
        });
    };
    window.addEventListener("resize", handleResize);
    // iOS doesn't fire resize on 180° rotation between landscape orientations.
    const handleOrient = () => {
        handleResize();
        setTimeout(handleResize, 300);
    };
    window.addEventListener("orientationchange", handleOrient);
    screen.orientation?.addEventListener?.("change", handleOrient);
    // Embedded canvases (`fullscreen: false`) follow the element's CSS box, which
    // can change without a window resize. Window resize still re-reads.
    let boxObserver = null;
    if (!fitWindow && typeof ResizeObserver === "function") {
        boxObserver = new ResizeObserver(handleResize);
        boxObserver.observe(canvas);
    }
    let portraitMq = null;
    let portraitApply = null;
    if (pauseOnPortrait) {
        portraitMq = window.matchMedia("(orientation: portrait) and (pointer: coarse)");
        portraitApply = () => {
            paused = portraitMq.matches;
        };
        portraitMq.addEventListener?.("change", portraitApply);
        portraitApply();
    }
    let rafHandle = 0;
    function loop(time) {
        if (!running)
            return;
        // Schedule the next frame FIRST: an exception in the user's update()/draw()
        // then surfaces without silently killing the loop.
        rafHandle = requestAnimationFrame(loop);
        const resized = applyResize(); // coalesced viewport re-read (at most once per frame)
        if (!lastTime)
            lastTime = time;
        if (paused) {
            lastTime = time;
            accumulator = 0;
            frameDelta = 0;
            // No step will consume edge input while paused — drop it so a key pressed
            // mid-pause doesn't fire pressed() on the first step after resume(). The
            // frame-latched pair goes with it, for the same reason and by the same
            // rule: nothing observed it and nothing is going to.
            consumeEdges();
            ptr.stepPressed = false;
            ptr.stepReleased = false;
            clearFrame();
            sceneRenderer?.beginFrame();
            drawClipped();
            sceneRenderer?.endFrame();
            endFrame(); // pause menus hit-test and scroll in draw too
            return;
        }
        let elapsed = time - lastTime;
        lastTime = time;
        if (elapsed > 250)
            elapsed = 250;
        frameDelta = elapsed;
        accumulator += elapsed;
        let steps = 0;
        const updStart = performance.now();
        while (accumulator >= stepMs) {
            if (++steps > maxCatchupSteps) {
                // Already this far behind, more catch-up only digs the hole deeper —
                // drop the backlog and let the app run slow-motion for one frame.
                accumulator = 0;
                break;
            }
            stepsElapsed += 1;
            stepsThisFrame += 1;
            for (const h of stepStartHandlers)
                h(); // poll-only inputs sample here
            callbacks.update();
            for (const h of stepHandlers)
                h(); // timers / tweens advance one step
            // Each step observes the current press, then it's consumed — so pressed()
            // is true for exactly one step, even if this frame runs several.
            consumeEdges();
            accumulator -= stepMs;
        }
        timings.updateMs = performance.now() - updStart;
        timings.steps = Math.min(steps, maxCatchupSteps);
        // The cap goes here, AFTER the steps: the simulation keeps its rate and
        // only the picture is skipped. Half a step of slack, because a 30 fps cap
        // on a 60 Hz display otherwise misses every second frame by a hair of
        // scheduling jitter and settles at 20.
        // …unless this frame resized. `applyResize` cleared the canvas above, so
        // skipping the draw now would put an empty surface on screen until the cap
        // lets the next one through — which is a flicker for as long as the drag
        // lasts, not a dropped frame nobody sees.
        sinceDraw += elapsed;
        if (maxFps > 0 && !resized && sinceDraw < 1000 / maxFps - stepMs / 2)
            return;
        // The drawn frame is handed the whole gap, so an animation that moves by
        // `frameDelta` moves at the same speed capped or not. Input edges are
        // rolled in `endFrame()` below, which a skipped frame never reaches, so a
        // press that lands between two drawn frames survives to be seen.
        frameDelta = sinceDraw;
        sinceDraw = 0;
        clearFrame();
        sceneRenderer?.beginFrame();
        const drawStart = performance.now();
        drawClipped();
        timings.drawMs = performance.now() - drawStart;
        sceneRenderer?.endFrame();
        endFrame();
    }
    const app = {
        canvas,
        ctx,
        get viewport() {
            return viewport;
        },
        keys,
        pointer,
        renderer: sceneRenderer ? "webgl" : "canvas",
        sceneRenderer,
        get frameDelta() {
            return frameDelta;
        },
        get maxFps() {
            return maxFps;
        },
        set maxFps(next) {
            const wanted = Number.isFinite(next) && next > 0 ? next : 0;
            // Assigning the value it already has does nothing, so a game is free to
            // write this every frame from a settings object without starving the
            // draw by restarting the window each time.
            if (wanted === maxFps)
                return;
            maxFps = wanted;
            sinceDraw = 0;
        },
        get interpolation() {
            return accumulator / stepMs;
        },
        get step() {
            return stepMs;
        },
        get steps() {
            return stepsElapsed;
        },
        get paused() {
            return paused;
        },
        timings,
        onResize(handler) {
            resizeHandlers.add(handler);
            return () => resizeHandlers.delete(handler);
        },
        onStep(handler) {
            stepHandlers.add(handler);
            return () => stepHandlers.delete(handler);
        },
        onStepStart(handler) {
            stepStartHandlers.add(handler);
            return () => stepStartHandlers.delete(handler);
        },
        onFrame(handler) {
            frameHandlers.add(handler);
            return () => frameHandlers.delete(handler);
        },
        setCursor(cursor, priority = 0) {
            if (priority >= cursorPriority) {
                cursorRequest = cursor;
                cursorPriority = priority;
            }
        },
        resetTransform,
        onDestroy(handler) {
            destroyHandlers.add(handler);
            return () => destroyHandlers.delete(handler);
        },
        run(cb) {
            if (destroyed)
                throw new Error("Minimotor: this app was destroyed — build a new one");
            callbacks = cb;
            if (!running) {
                running = true;
                // Fresh clock: without this, a stop() → run() would see a huge elapsed
                // (up to the 250 ms cap) and fire a burst of catch-up steps.
                lastTime = 0;
                accumulator = 0;
                rafHandle = requestAnimationFrame(loop);
            }
            return app;
        },
        pause() {
            paused = true;
        },
        resume() {
            paused = false;
        },
        stop() {
            running = false;
            // Cancel the pending frame: a stop() → run() within the same frame must
            // not end up with two scheduled loops.
            globalThis.cancelAnimationFrame?.(rafHandle);
            rafHandle = 0;
        },
        destroy() {
            if (destroyed)
                return;
            destroyed = true;
            running = false;
            globalThis.cancelAnimationFrame?.(rafHandle);
            rafHandle = 0;
            globalThis.cancelAnimationFrame?.(resizeRaf);
            resizeRaf = 0;
            canvas.style.cursor = "";
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerCancel);
            window.removeEventListener("blur", onWindowBlur);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("scroll", invalidateRect, true);
            window.removeEventListener("resize", handleResize);
            window.removeEventListener("orientationchange", handleOrient);
            screen.orientation?.removeEventListener?.("change", handleOrient);
            boxObserver?.disconnect();
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("contextmenu", stopGesture);
            canvas.removeEventListener("dblclick", onDblClick);
            canvas.removeEventListener("wheel", onWheel);
            for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
                canvas.removeEventListener(type, stopGesture);
            }
            canvas.removeEventListener("touchstart", onTouchStart);
            canvas.removeEventListener("touchend", onTouchEnd);
            canvas.removeEventListener("selectstart", stopGesture);
            if (portraitMq && portraitApply)
                portraitMq.removeEventListener?.("change", portraitApply);
            sceneRenderer?.destroy();
            sceneRenderer = null;
            for (const h of destroyHandlers)
                h();
            stepHandlers.clear();
            stepStartHandlers.clear();
            frameHandlers.clear();
            resizeHandlers.clear();
            destroyHandlers.clear();
        },
    };
    return app;
}
function readViewport(canvas, resolution, fitWindow = true) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cssW;
    let cssH;
    if (fitWindow) {
        cssW = window.innerWidth;
        cssH = window.innerHeight;
        // Reassigning canvas.width/height reallocates (and clears) the backing
        // store even when the value is unchanged — skip it when nothing moved.
        canvas.style.width = cssW + "px";
        canvas.style.height = cssH + "px";
    }
    else {
        cssW = canvas.clientWidth;
        cssH = canvas.clientHeight;
        if (cssW <= 0 || cssH <= 0) {
            // Not laid out yet (jsdom, hidden): fall back to the window so tests and
            // a canvas that has not received a CSS box still get a usable surface.
            cssW = window.innerWidth;
            cssH = window.innerHeight;
        }
    }
    const deviceW = Math.round(cssW * dpr);
    const deviceH = Math.round(cssH * dpr);
    if (canvas.width !== deviceW)
        canvas.width = deviceW;
    if (canvas.height !== deviceH)
        canvas.height = deviceH;
    const ctx = canvas.getContext("2d");
    // Safe-area insets (from fullscreenCSS's `--sai-*` custom properties; non-zero
    // only when the viewport meta carries viewport-fit=cover, e.g. on notched iOS).
    const rootStyle = getComputedStyle(document.documentElement);
    const sai = (name) => parseFloat(rootStyle.getPropertyValue(name)) || 0;
    const safeTop = sai("--sai-top");
    const safeRight = sai("--sai-right");
    const safeBottom = sai("--sai-bottom");
    const safeLeft = sai("--sai-left");
    // iPhone landscape reports the notch inset on BOTH sides; tag which edge
    // actually holds it (dataset.notch) for anything that wants to know. The
    // letterbox itself centers within the symmetric insets, so the notch always
    // lands in a bar regardless of side.
    if (/iPhone/.test(navigator.userAgent)) {
        let angle = null;
        const win = window;
        if (typeof win.orientation === "number")
            angle = win.orientation;
        else if (screen.orientation && typeof screen.orientation.angle === "number")
            angle = screen.orientation.angle;
        document.documentElement.dataset.notch =
            angle === 90 ? "left" : angle === -90 || angle === 270 ? "right" : "none";
    }
    // The notch-free rectangle, in CSS px — the letterbox fits INSIDE this.
    const availX = safeLeft;
    const availY = safeTop;
    const availW = Math.max(1, cssW - safeLeft - safeRight);
    const availH = Math.max(1, cssH - safeTop - safeBottom);
    // Letterbox: a fixed logical resolution fitted (uniform, centered) into the
    // SAFE rectangle; otherwise the logical size IS the CSS box (the window when
    // fullscreen, the element's layout size when not).
    let w = cssW;
    let h = cssH;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    if (resolution) {
        w = resolution.w;
        h = resolution.h;
        scale = Math.min(availW / w, availH / h);
        offsetX = availX + (availW - w * scale) / 2;
        offsetY = availY + (availH - h * scale) / 2;
    }
    // Base transform maps logical coords → device pixels (dpr × letterbox).
    // The offset is rounded to a whole device pixel so drawing doesn't land on
    // subpixels (the fractional letterbox offset would otherwise blur everything).
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, Math.round(dpr * offsetX), Math.round(dpr * offsetY));
    return {
        canvas,
        ctx,
        w,
        h,
        dpr,
        safeLeft,
        safeTop,
        safeRight,
        safeBottom,
        scale,
        offsetX,
        offsetY,
    };
}
/** Create one isolated app. */
export function createApp(canvas, { fullscreen = true, preventNavigation: navigation = false, pauseWhenHidden, pauseWhenBlurred, ...runtimeOptions } = {}) {
    if (fullscreen)
        applyFullscreen();
    if (navigation)
        preventNavigation(true);
    const runtime = buildRuntime({ canvas, ...runtimeOptions, fitWindow: fullscreen });
    let visible = typeof document === "undefined" || document.visibilityState !== "hidden";
    let focused = typeof document === "undefined" || document.hasFocus();
    const app = {
        canvas: runtime.canvas,
        ctx: runtime.ctx,
        viewport: runtime.viewport,
        Draw: createDraw(runtime, runtime.sceneRenderer),
        Loop: createLoop(runtime),
        Clock: createClockApi(runtime),
        Keys: runtime.keys,
        Pointer: runtime.pointer,
        renderer: runtime.renderer,
        get timings() {
            return runtime.timings;
        },
        Mouse: runtime.pointer,
        get visible() {
            return visible;
        },
        get focused() {
            return focused;
        },
        resetTransform: () => runtime.resetTransform(),
        setCursor: (cursor, priority) => runtime.setCursor(cursor, priority),
        onResize: (handler) => runtime.onResize(handler),
        onStep: (handler) => runtime.onStep(handler),
        onStepStart: (handler) => runtime.onStepStart(handler),
        onFrame: (handler) => runtime.onFrame(handler),
        onDestroy: (handler) => runtime.onDestroy(handler),
        destroy: () => runtime.destroy(),
    };
    if (typeof document !== "undefined" && typeof window !== "undefined") {
        // Auto-pause has to be able to UNDO itself, or tabbing away freezes the app
        // for good. It also must not lift a pause it didn't cause, so it tracks
        // ownership: it resumes only the pause it took, and declines to take one
        // when the app is already paused by game code (a pause menu survives a tab
        // switch). The one ambiguity a single flag can't resolve — game code pausing
        // *while* auto-paused — resolves in favor of resuming.
        let pausedByLifecycle = false;
        const syncLifecycle = () => {
            visible = document.visibilityState !== "hidden";
            focused = document.hasFocus();
            const shouldPause = (pauseWhenHidden && !visible) || (pauseWhenBlurred && !focused);
            if (shouldPause) {
                if (!app.Loop.paused) {
                    app.Loop.pause();
                    pausedByLifecycle = true;
                }
            }
            else if (pausedByLifecycle) {
                pausedByLifecycle = false;
                app.Loop.resume();
            }
        };
        document.addEventListener("visibilitychange", syncLifecycle);
        window.addEventListener("focus", syncLifecycle);
        window.addEventListener("blur", syncLifecycle);
        runtime.onDestroy(() => {
            document.removeEventListener("visibilitychange", syncLifecycle);
            window.removeEventListener("focus", syncLifecycle);
            window.removeEventListener("blur", syncLifecycle);
        });
    }
    return app;
}
