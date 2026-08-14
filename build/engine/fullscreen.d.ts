/** Minimal CSS string to include in a <style> tag or inline. */
export declare const fullscreenCSS = "\n  /* Publish the safe-area insets as custom properties so the engine's\n     readViewport can letterbox INSIDE the notch-free rectangle. These are only\n     non-zero when the viewport meta carries viewport-fit=cover (ensureViewportMeta). */\n  :root {\n    --sai-top: env(safe-area-inset-top, 0px);\n    --sai-right: env(safe-area-inset-right, 0px);\n    --sai-bottom: env(safe-area-inset-bottom, 0px);\n    --sai-left: env(safe-area-inset-left, 0px);\n  }\n  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }\n  html, body {\n    width: 100%; height: 100%; overflow: hidden;\n    background: #000; touch-action: none;\n    overscroll-behavior: none;\n    /* No hold-to-select / callout / magnifier hijacking touches (iOS). */\n    -webkit-user-select: none; user-select: none;\n    -webkit-touch-callout: none;\n  }\n  canvas {\n    display: block;\n    position: absolute;\n    top: 0; left: 0;\n    /* Kill browser gestures on the canvas itself (double-tap / pinch / long-press\n       zoom on iOS) \u2014 html/body alone don't cover a touch that lands on the canvas.\n       The safe-area insets are handled by the letterbox transform, not by shifting\n       the canvas, so it stays a clean full-window surface. */\n    touch-action: none;\n    -webkit-user-select: none; user-select: none;\n    -webkit-touch-callout: none;\n  }\n";
/** Inject fullscreen styles into the document <head>, fix the viewport meta and
 *  block zoom gestures. Safe to call multiple times (idempotent). */
export declare function applyFullscreen(): void;
/** Stop stray browser navigation — the back/forward the OS fires on a two-finger
 *  trackpad swipe or a touch overscroll — so the app doesn't lose its state to an
 *  accidental gesture. Sets `overscroll-behavior: none` on the document and
 *  swallows horizontal-dominant wheel events (the trackpad swipe-back signal);
 *  vertical scrolling and the engine's own wheel input are untouched. Pass
 *  `false` to release. Idempotent. */
export declare function preventNavigation(prevent?: boolean): void;
