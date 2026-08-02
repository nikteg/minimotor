// Fonts demo: every way minimotor draws text.
//
// Canvas text is a typeface the browser rasterises. A BITMAP font is pixels you
// shipped, sliced out of an atlas — identical on every machine, crisp at any
// whole-number scale, and the only way to use the font a pixel-art pack came
// with, because those ship as a PNG rather than a .ttf.
//
// Tabs pick the page and the choice lives in `?page=`, so every demo below has
// its own link:
//
//   SCALE     the same string as canvas text and as a bitmap font, 1x..4x.
//             Watch the canvas rows soften and the bitmap rows stay exact.
//   TINTING   one white atlas, every colour. `color` recolours opaque pixels
//             through a cache, so a whole palette costs one blit each.
//   OUTLINE   haloes and drop shadows over deliberately noisy terrain — the
//             reason small text stays readable on top of a game.
//   LAYOUT    align, baseline, tracking, line height, wrapping, and the
//             measured box drawn around the text to prove it is exact.
//   DEFINING  proportional vs monospaced from ONE sheet, per-character
//             advances, a fallback glyph, and an ICON font whose characters
//             are pictures.
//
// The pixel font in `pixel-font.ts` is drawn by hand, 5x7, and baked to an
// atlas with `Sprites.atlas` at startup — no binary assets in this sample.
import { createDebug } from "minimotor/debug";
import { createInput } from "minimotor/input";
import { createUI } from "minimotor/ui";
import { Font, createApp } from "minimotor";
import { CELL, CHARS, bakeIcons, bakeSheet } from "./pixel-font.ts";

// `fullscreen` defaults to true; stated here because this sample's index.html
// mirrors the same rules statically, and the two are meant to be read together.
const game = createApp("game", { background: "#12141c", fullscreen: true });
createDebug(game, { initial: "performance" });
const { Draw, Loop, viewport } = game;
const Input = createInput(game);
const UI = createUI(game, Input);

// ---- defining the fonts ----
const sheet = bakeSheet();

// The everyday one. Glyphs are trimmed to their ink, so "I" advances 3px and
// "M" advances 5 from the same 5px grid; `tracking: 1` keeps them apart.
// `lineHeight` defaults to the cell height, which leaves multi-line text with
// no leading at all — 9 gives the 5x7 glyphs two pixels of air.
const pixel = Font.atlas(sheet, {
  cell: CELL,
  chars: CHARS,
  cols: 16,
  tracking: 1,
  lineHeight: 9,
});

// The same sheet, untrimmed. Every glyph is the full cell, so digits line up in
// a column — what a score or a timer wants so it stops jittering as it counts.
const mono = Font.atlas(sheet, {
  cell: CELL,
  chars: CHARS,
  cols: 16,
  trim: false,
  tracking: 1,
});

// A tighter variant that also fixes the one glyph trimming gets wrong: a
// trimmed "." is 2px of ink with no room after it.
const tight = Font.atlas(sheet, {
  cell: CELL,
  chars: CHARS,
  cols: 16,
  tracking: 1,
  advances: { ".": 3, ",": 3 },
  fallback: "?",
});

// Characters that are pictures. `Font.glyphs` takes arbitrary rects, so a font
// does not have to be a grid — or even be letters.
const icons = Font.glyphs(bakeIcons(), {
  glyphs: { "♥": [0, 0, 7, 7], "©": [7, 0, 7, 7], "⚿": [14, 0, 7, 7], "☠": [21, 0, 7, 7] },
  tracking: 2,
});

// ---- state ----
const PAGES = ["SCALE", "TINTING", "OUTLINE", "LAYOUT", "DEFINING"] as const;
const TITLES: Record<(typeof PAGES)[number], string> = {
  SCALE: "SCALE — canvas text vs bitmap font",
  TINTING: "TINTING — one white atlas, any colour",
  OUTLINE: "OUTLINE & SHADOW — legibility over noise",
  LAYOUT: "LAYOUT — align, baseline, tracking, wrap",
  DEFINING: "DEFINING — trim, advances, fallback, icons",
};
/** The page lives in `?page=`, so a link points at one demo and a reload keeps
 *  you where you were. `replaceState` rather than `pushState`: flipping tabs
 *  should not fill the back button with a trail. */
function pageFromUrl(): number {
  const want = new URL(location.href).searchParams.get("page")?.toUpperCase();
  const found = PAGES.indexOf(want as (typeof PAGES)[number]);
  return found < 0 ? 0 : found;
}

function pageToUrl(index: number) {
  const url = new URL(location.href);
  url.searchParams.set("page", PAGES[index].toLowerCase());
  history.replaceState(null, "", url);
}

/** Top of the content panel: below the tab strip, plus breathing room. */
const PANEL_TOP = 72;

let page = pageFromUrl();
let scale = 3;
let noise = true;
let time = 0;

const PALETTE = ["#ff6b6b", "#ffd43b", "#69db7c", "#4dabf7", "#da77f2", "#ffffff"];

/** Deliberately busy terrain, so the outline page is arguing against something
 *  real rather than against a flat background. */
function drawNoise(x: number, y: number, w: number, h: number) {
  let seed = 1;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 90; i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const r = 6 + rand() * 22;
    Draw.circle(cx, cy, r, `hsl(${Math.floor(rand() * 360)} 55% ${35 + rand() * 25}%)`);
  }
}

/** A flowed caption in ordinary canvas text — the sample's own prose, as
 *  opposed to the bitmap font it is describing. */
function label(text: string) {
  UI.text(text, { size: 12, color: "dim" });
}

/** A prose paragraph, wrapped by the UI rather than hand-broken — the caption
 *  equivalent of what `font.wrap` does for the bitmap side. */
function note(text: string, w = COL * 2) {
  UI.text(text, { size: 12, color: "dim", wrap: true, w });
}

/** Width of a page column. Explicit, because an auto-sized column inside a
 *  row shares the space out and then ellipsizes the captions to fit it. */
const COL = 560;

/** The two-column band each page is built from. */
function columns(children: () => void) {
  UI.row({ gap: 60 }, children);
}

/** What `Draw.text` accepts, minus the things a flowed caller decides. */
type BitmapStyle = Omit<Parameters<typeof Draw.text>[1], "x" | "y" | "font">;

// ---- pages ----
// Every page is a tree of `UI.col`/`UI.row` with gaps, so nothing here does
// arithmetic on coordinates. Bitmap text joins that flow through `glyphs`
// below — the one piece of glue this whole sample needs.

/** Flow a run of bitmap text as if it were a widget.
 *
 *  `Draw.text` paints wherever it is told, which is the right contract for a
 *  renderer and no use inside a layout. So: reserve a slot the measured size
 *  of the glyphs with an empty `UI.text`, read back the rect the layout gave
 *  it, and draw into that. `measureBlock` is exact, so the slot is exact. */
function glyphs(str: string, style: BitmapStyle = {}, font: Font.BitmapFont = pixel): void {
  const scale = style.scale ?? 1;
  const box = font.measureBlock(str);
  UI.text("", { w: Math.max(1, box.w * scale), h: Math.max(1, box.h * scale) });
  const at = UI.lastRect();
  if (at) Draw.text(str, { ...style, x: at.x, y: at.y, font });
}

/** Reserve a slot of a known size and hand back its rect, for the few demos
 *  that must draw a marker line or a backdrop around their own content. */
function slot(w: number, h: number): { x: number; y: number; w: number; h: number } {
  UI.text("", { w, h });
  return UI.lastRect() ?? { x: 0, y: 0, w, h };
}

function pageScale() {
  const line = "MINIMOTOR 2026";
  columns(() => {
    UI.col({ gap: 10, w: COL }, () => {
      label("Canvas text — the browser rasteriser softens and rounds it");
      for (const s of [1, 2, 3, 4]) UI.text(line, { size: 7 * s, color: "#8d99ae" });
    });
    UI.col({ gap: 10, w: COL }, () => {
      label("Bitmap font — drawImage, pixel-snapped, exact at every step");
      for (const s of [1, 2, 3, 4]) glyphs(line, { scale: s, color: "#ffd43b" });
      // Inside the column, not after the band. A container only learns its own
      // height from the previous frame, so anything placed AFTER one slides
      // into position on frame two — put the closing note in a column and
      // there is no "after".
      note(
        `The pixel row is ${pixel.measure(line)}px wide at 1x and exactly ` +
          `${pixel.measure(line) * 4}px at 4x — no subpixel drift to accumulate.`,
        COL,
      );
    });
  });
}

function pageTinting() {
  columns(() => {
    UI.col({ gap: 8, w: COL }, () => {
      label("One white atlas. `color` tints opaque pixels through a per-colour cache.");
      for (const colour of PALETTE) {
        // The sheet has no "#", so the hex is written without one on purpose —
        // the DEFINING page is where missing glyphs get their own demo.
        glyphs(`TINTED ${colour.slice(1).toUpperCase()}`, { scale: 3, color: colour });
      }
    });
    UI.col({ gap: 14, w: COL }, () => {
      label("A palette animated per frame costs one cached blit each.");
      // Per-glyph colour needs a per-glyph pen, so this one reserves the whole
      // word as a single slot and walks it by each glyph's advance.
      const word = "RAINBOW";
      const at = slot(pixel.measure(word) * 5, pixel.lineHeight * 5);
      let pen = at.x;
      for (let i = 0; i < word.length; i++) {
        const hue = Math.floor((time * 60 + i * 40) % 360);
        Draw.text(word[i], {
          x: pen,
          y: at.y,
          font: pixel,
          scale: 5,
          color: `hsl(${hue} 90% 65%)`,
        });
        pen += (pixel.glyph(word[i])!.advance + pixel.tracking) * 5;
      }

      label("Icons tint too — they are just glyphs.");
      UI.row({ gap: 24 }, () => {
        glyphs("♥♥♥", { scale: 4, color: "#ff6b6b" }, icons);
        glyphs("©", { scale: 4, color: "#ffd43b" }, icons);
        glyphs("☠", { scale: 4, color: "#adb5bd" }, icons);
      });
    });
  });
}

function pageOutline() {
  // Scale and backdrop belong to THIS page, so their controls live on it
  // rather than in a global key legend for options four pages away.
  // The row takes its height from the controls in it — an auto-sized container
  // is measured in the frame it draws, so the band below sits right from the
  // first one.
  const CTRL = 26;
  UI.row({ gap: 8 }, () => {
    if (UI.button("−", { w: 30, h: CTRL, disabled: scale <= 1 })) scale -= 1;
    if (UI.button("+", { w: 30, h: CTRL, disabled: scale >= 8 })) scale += 1;
    UI.text(`scale ${scale}x`, { size: 13, h: CTRL });
    if (UI.button(noise ? "noise: on" : "noise: off", { w: 104, h: CTRL })) noise = !noise;
  });

  // `color` and `outline` are two independent tints of the same atlas, so the
  // interesting rows are the ones that use BOTH — a coloured fill inside a
  // contrasting halo is what a real HUD ships, not white-on-black.
  const rows: [string, BitmapStyle][] = [
    ["NO OUTLINE", { color: "#ffffff" }],
    ["ROUND OUTLINE", { color: "#ffffff", outline: "#000" }],
    ["CROSS OUTLINE", { color: "#ffffff", outline: "#000", outlineStyle: "cross" }],
    ["GOLD IN BLACK", { color: "#ffd43b", outline: "#000", outlineWidth: 2 }],
    ["BLACK IN GOLD", { color: "#12141c", outline: "#ffd43b", outlineWidth: 2 }],
    ["MINT IN PLUM", { color: "#69f0c8", outline: "#5f3dc4", outlineWidth: 2 }],
    ["DROP SHADOW", { color: "#ffffff", shadow: { x: 2, y: 2 }, shadowColor: "#000" }],
    [
      "TINT, HALO, SHADOW",
      { color: "#ff6b6b", outline: "#2b0a0a", shadow: { x: 3, y: 3 }, shadowColor: "#00000088" },
    ],
  ];

  // The noise has to be painted BEHIND the rows, so the whole block takes one
  // slot: the layout still owns where it sits and how big it is, and only the
  // stacking inside it is manual.
  const step = pixel.lineHeight * scale + 12;
  const band = slot(620, rows.length * step);
  if (noise) drawNoise(band.x, band.y, band.w, band.h);
  rows.forEach(([text, style], i) => {
    Draw.text(text, { ...style, x: band.x + 16, y: band.y + i * step, font: pixel, scale });
  });

  note(
    "Outlines grow OUTWARD from glyphs that were already placed, so `measure` is " +
      "unchanged and layout code never has to know about them. Thickness is in FONT " +
      "pixels, not device pixels — change the scale above and the halo grows with the " +
      "glyphs instead of thinning to a hairline. `round` haloes all eight neighbours " +
      "(9 blits), `cross` only the four orthogonal ones (5); both tint from the same " +
      "cached recolour of the atlas.",
  );
}

function pageLayout() {
  // Flat on purpose: one column of siblings, no nested groups. Nesting plain
  // `row`/`col` is free — they are measured in the frame they draw — but a
  // `group` paints a backdrop under its children, so it has to size itself
  // from the previous frame, and a group inside a group takes two frames to
  // settle with everything after it sliding on the way. Every other page here
  // is one level deep; this one matches.
  columns(() => {
    UI.col({ gap: 14, w: COL }, () => {
      label("align, around the marked x");
      // One slot holds all three rows so they share a single marker line.
      const step = pixel.lineHeight * 3 + 10;
      const box = slot(320, step * 3);
      const mid = box.x + box.w / 2;
      Draw.line(mid, box.y - 4, mid, box.y + box.h, "#495057", 1);
      (["left", "center", "right"] as const).forEach((align, i) => {
        Draw.text(align.toUpperCase(), {
          x: mid,
          y: box.y + i * step,
          font: pixel,
          scale: 3,
          align,
          color: "#4dabf7",
        });
      });

      label("baseline, around the marked y");
      const line = slot(440, 60);
      const by = line.y + line.h / 2;
      Draw.line(line.x, by, line.x + line.w, by, "#495057", 1);
      (["top", "middle", "bottom"] as const).forEach((baseline, i) => {
        Draw.text(baseline.toUpperCase(), {
          x: line.x + 8 + i * 150,
          y: by,
          font: pixel,
          scale: 2,
          baseline,
          color: "#69db7c",
        });
      });
    });

    UI.col({ gap: 14, w: COL }, () => {
      label("tracking");
      glyphs("TIGHT TEXT", { scale: 3, tracking: 0 });
      glyphs("LOOSE TEXT", { scale: 3, tracking: 3 });

      // `wrap` breaks on width in PIXELS and `measureBlock` gives the box back,
      // so framing the text proves the two agree.
      const limit = 150;
      label(`wrap to ${limit}px, then measureBlock — the box is drawn from it`);
      const lines = pixel.wrap(
        "A BITMAP FONT MEASURES IN PIXELS SO WRAPPING IS EXACT AND NEVER GUESSES",
        limit,
      );
      const block = pixel.measureBlock(lines.join("\n"));
      const box = slot(block.w * 2 + 6, block.h * 2 + 6);
      Draw.rectStroke(box.x, box.y, box.w, box.h, "#495057", 1);
      Draw.text(lines.join("\n"), { x: box.x + 3, y: box.y + 3, font: pixel, scale: 2 });
      label(`${lines.length} lines, box ${block.w}×${block.h} at 1x — nothing spills it`);

      // Last in the column deliberately: this is the only nested container on
      // the page, and a nested container is exactly what needs an extra frame
      // to measure. With nothing after it, that costs nobody a shift.
      label("line height");
      UI.row({ gap: 40 }, () => {
        glyphs("TIGHT\nLINES", { scale: 3, lineHeight: 7 });
        glyphs("LOOSE\nLINES", { scale: 3, lineHeight: 13, color: "#da77f2" });
      });
    });
  });
}

function pageDefining() {
  // The counter argument, made rather than asserted: the same digits drawn
  // both ways, ticking.
  const digits = String(Math.floor(time * 7) % 100000).padStart(5, "0");
  columns(() => {
    UI.col({ gap: 8, w: COL }, () => {
      label("Same sheet, trimmed (proportional) — 'I' inks 3px, 'M' inks 5");
      glyphs("IIIII MMMMM", { scale: 4, color: "#ffd43b" });
      label("Same sheet, trim: false (monospaced) — a score that cannot jitter");
      glyphs("IIIII MMMMM", { scale: 4, color: "#4dabf7" }, mono);
      label("counting — proportional drifts, monospaced does not");
      glyphs(digits, { scale: 4, color: "#ff6b6b" });
      glyphs(digits, { scale: 4, color: "#69db7c" }, mono);
    });

    UI.col({ gap: 8, w: COL }, () => {
      label("advances: {'.': 3} — the one glyph trimming gets wrong");
      glyphs("MR. SMITH", { scale: 3 });
      glyphs("MR. SMITH", { scale: 3, color: "#ffd43b" }, tight);
      label("fallback: '?' — characters the sheet never had");
      glyphs("HEY #@€", { scale: 3 });
      glyphs("HEY #@€", { scale: 3, color: "#ffd43b" }, tight);
      label("Font.glyphs — arbitrary rects, so glyphs can be pictures");
      glyphs("♥♥♥ © ⚿ ☠", { scale: 4, color: "#f783ac" }, icons);
      label(
        `${pixel.chars.length} glyphs in the sheet · Font.ASCII covers ${Font.ASCII.length} · ` +
          `cell ${CELL.w}×${CELL.h}, line height ${pixel.lineHeight}`,
      );
    });
  });
}

const RENDER: Record<(typeof PAGES)[number], () => void> = {
  SCALE: pageScale,
  TINTING: pageTinting,
  OUTLINE: pageOutline,
  LAYOUT: pageLayout,
  DEFINING: pageDefining,
};

Loop.run({
  update() {
    time += Loop.step / 1000;
  },

  draw() {
    // Tabs first: `UI.tabs` returns the (possibly changed) index, so the URL
    // is only rewritten when the selection actually moved.
    const picked = UI.tabs({ x: 24, y: 16, items: [...PAGES], active: page });
    if (picked !== page) {
      page = picked;
      pageToUrl(page);
    }

    UI.panel(
      {
        x: 8,
        y: PANEL_TOP,
        w: viewport.w - 16,
        h: viewport.h - PANEL_TOP - 16,
        pad: 20,
        gap: 20,
      },
      () => {
        // The heading is drawn with the BITMAP font and every other word on the
        // page with canvas text, so both paths are always up for comparison.
        // The sheet has no lowercase and no em-dash, hence the upcase and scrub.
        glyphs(TITLES[PAGES[page]].toUpperCase().replace(/[^A-Z0-9 .,!?:'()/+%-]/g, " "), {
          scale: 3,
          color: "#ffffff",
          outline: "#000000",
        });
        // Scope the page's widget ids to the page.
        //
        // An auto-sized container caches its measured size under a key, and
        // without an explicit id that key is its STRUCTURAL position —
        // "panel > row #0". Every page's column band sits at that same
        // position, so switching tabs hands the incoming page the outgoing
        // one's cached size, and it lays out wrong for exactly one frame.
        // Scoping by page name gives each its own cache entry, so a tab you
        // return to is right immediately.
        UI.idScope(PAGES[page], RENDER[PAGES[page]]);
      },
    );
  },
});
