// ---------- Nine-slice analysis ----------
//
// Why this exists: a wrong nine-slice is a *pixel* defect — a 1px slit where a
// repeat wraps, a border that shifts phase halfway along an edge, a corner that
// eats one column of the edge art. At 1× in a screenshot those are invisible,
// which is exactly why they survive review. So none of the reporting here is
// visual: every defect is reduced to integers (a period, an offset, an x
// coordinate) that can be asserted on and acted on.
//
// The central observation is that a nine-slice edge is *periodic art*.
// `drawNineSlice` tiles the centre band of each edge at width `centerW`
// (`repeatSlice`, src/ui/core/theme.ts), clipping the final partial tile. That
// is seamless if and only if `centerW` is a whole number of the band's own
// repeat period. When it is not, the art jumps phase at every tile boundary and
// you get the classic slit — and the period is directly measurable, so the
// corrected inset is directly computable.
//
// Columns and rows are compared as whole units and interned into ids, so an
// axis becomes a short string like `ABCDCDCDCDBA`. Period, insets and phase
// breaks all fall out of that one representation, and it prints small enough to
// put in front of an agent verbatim.

import type { Pixels } from "./png.js";

export interface Rect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One nine-slice frame to check, named for reporting. */
export interface RegionInput {
  name: string;
  rect: Rect;
  /** Omit to run in discovery mode: the analyser proposes insets instead. */
  insets?: Insets;
}

export interface Finding {
  level: "error" | "warning" | "info";
  region: string;
  code: string;
  message: string;
  /** Concrete corrected value, when one is derivable. */
  fix?: string;
}

export interface AxisReport {
  axis: "x" | "y";
  /** One character per column (x) or row (y); identical art shares a letter. */
  keys: string;
  /** Declared leading inset — `left` on x, `top` on y. */
  lead: number;
  trail: number;
  center: number;
  /** True repeat period of the declared centre band, in pixels. Equal to
   *  `center` when the band has no internal repeat at all. */
  period: number;
  /** Whether `period` is a real repeat rather than "the whole band". */
  periodic: boolean;
  /** Whether the art yielded a centre band to derive insets from. */
  derived: boolean;
  /** Insets implied by the art itself. */
  suggestedLead: number;
  suggestedTrail: number;
  /** Wrap discontinuity relative to the band's own internal variation. */
  seam: number;
  /** Every column/row where the composed edge changes phase, at `size`. */
  breaks: number[];
}

export interface RegionReport {
  name: string;
  rect: Rect;
  insets: Insets;
  suggested: Insets;
  x: AxisReport;
  y: AxisReport;
  findings: Finding[];
}

/** Read one pixel as premultiplied RGBA, so fully transparent pixels compare
 *  equal whatever RGB garbage an exporter left in them. */
function premultiplied(image: Pixels, x: number, y: number, out: number[]): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return;
  }
  const at = (y * image.width + x) * 4;
  const alpha = image.data[at + 3];
  const factor = alpha / 255;
  out[0] = Math.round(image.data[at] * factor);
  out[1] = Math.round(image.data[at + 1] * factor);
  out[2] = Math.round(image.data[at + 2] * factor);
  out[3] = alpha;
}

/** Intern each column (or row) of a rect so identical art shares an id. */
export function sliceIds(image: Pixels, rect: Rect, axis: "x" | "y"): number[] {
  const count = axis === "x" ? rect.sw : rect.sh;
  const depth = axis === "x" ? rect.sh : rect.sw;
  const ids: number[] = [];
  const seen = new Map<string, number>();
  const pixel = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    const parts: number[] = [];
    for (let j = 0; j < depth; j++) {
      const x = rect.sx + (axis === "x" ? i : j);
      const y = rect.sy + (axis === "x" ? j : i);
      premultiplied(image, x, y, pixel);
      parts.push(pixel[0], pixel[1], pixel[2], pixel[3]);
    }
    const key = parts.join(",");
    let id = seen.get(key);
    if (id === undefined) {
      id = seen.size;
      seen.set(key, id);
    }
    ids.push(id);
  }
  return ids;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Render interned ids as a one-character-per-pixel strip. */
export const idStrip = (ids: readonly number[]): string =>
  ids.map((id) => (id < ALPHABET.length ? ALPHABET[id] : "#")).join("");

/** Smallest repeat period of `ids[from, to)`, or the segment length when the
 *  segment does not repeat within itself.
 *
 *  A period is only believed when the segment holds two full cycles of it.
 *  Without that bar a 16px band whose last two columns happen to match its
 *  first two "has period 14" on two comparisons, and every such coincidence
 *  becomes a phantom slit report. */
export function bandPeriod(ids: readonly number[], from: number, to: number): number {
  const length = to - from;
  if (length <= 0) return 0;
  for (let period = 1; period <= length >> 1; period++) {
    let matches = true;
    for (let i = from + period; i < to && matches; i++) matches = ids[i] === ids[i - period];
    if (matches) return period;
  }
  return length;
}

/** The longest periodic run in the middle of an axis, which is what the two
 *  outer insets have to exclude.
 *
 *  Two guards keep this from proposing nonsense insets. A run must be two full
 *  periods long, so an accidental pair of matching columns cannot pass as a
 *  repeat; and it must span the axis midpoint, because the centre band of a
 *  nine-slice is by definition the middle of the frame. Without the second
 *  guard, a long incidental repeat down at one end of a busy sprite gets
 *  proposed as the centre and the suggested insets come out absurd. */
export function longestPeriodicRun(
  ids: readonly number[],
): { start: number; end: number; period: number } | undefined {
  const n = ids.length;
  const middle = n >> 1;
  let best: { start: number; end: number; period: number } | undefined;
  for (let period = 1; period <= Math.floor(n / 2); period++) {
    let runStart = -1;
    for (let i = period; i <= n; i++) {
      const matching = i < n && ids[i] === ids[i - period];
      if (matching && runStart < 0) runStart = i;
      if (!matching && runStart >= 0) {
        const start = runStart - period;
        const end = i; // exclusive
        if (end - start >= 2 * period && start <= middle && end > middle) {
          const length = end - start;
          const bestLength = best ? best.end - best.start : -1;
          if (length > bestLength || (length === bestLength && best && period < best.period)) {
            best = { start, end, period };
          }
        }
        runStart = -1;
      }
    }
  }
  return best;
}

/** Mean absolute premultiplied difference between two columns (or rows). */
function sliceDistance(image: Pixels, rect: Rect, axis: "x" | "y", a: number, b: number): number {
  const depth = axis === "x" ? rect.sh : rect.sw;
  const left = [0, 0, 0, 0];
  const right = [0, 0, 0, 0];
  let total = 0;
  for (let j = 0; j < depth; j++) {
    premultiplied(image, rect.sx + (axis === "x" ? a : j), rect.sy + (axis === "x" ? j : a), left);
    premultiplied(image, rect.sx + (axis === "x" ? b : j), rect.sy + (axis === "x" ? j : b), right);
    for (let c = 0; c < 4; c++) total += Math.abs(left[c] - right[c]);
  }
  return total / (depth * 4);
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

function analyzeAxis(
  image: Pixels,
  rect: Rect,
  axis: "x" | "y",
  lead: number,
  trail: number,
): AxisReport {
  const ids = sliceIds(image, rect, axis);
  const n = ids.length;
  const center = n - lead - trail;
  const run = longestPeriodicRun(ids);
  const period = center > 0 ? bandPeriod(ids, lead, n - trail) : 0;

  // What the eye meets at a tile boundary: the band's last slice butted against
  // its first. Scale it against the band's own internal step so that busy art
  // is not flagged for being busy.
  let seam = 0;
  if (center > 1) {
    const steps: number[] = [];
    for (let i = lead + 1; i < n - trail; i++)
      steps.push(sliceDistance(image, rect, axis, i - 1, i));
    const wrap = sliceDistance(image, rect, axis, n - trail - 1, lead);
    seam = wrap / Math.max(median(steps), 1);
  }

  return {
    axis,
    keys: idStrip(ids),
    lead,
    trail,
    center,
    period,
    periodic: center > 1 && period < center,
    derived: !!run,
    suggestedLead: run ? run.start : lead,
    suggestedTrail: run ? n - run.end : trail,
    seam,
    breaks: [],
  };
}

const alphaAt = (image: Pixels, x: number, y: number): number =>
  x < 0 || y < 0 || x >= image.width || y >= image.height
    ? 0
    : image.data[(y * image.width + x) * 4 + 3];

/** Tight bounding box of non-transparent pixels inside a rect, in rect-local
 *  coordinates. Undefined when the rect holds no opaque pixel at all. */
export function contentBounds(image: Pixels, rect: Rect): Rect | undefined {
  let minX = rect.sw;
  let minY = rect.sh;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rect.sh; y++) {
    for (let x = 0; x < rect.sw; x++) {
      if (alphaAt(image, rect.sx + x, rect.sy + y) === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return undefined;
  return { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
}

/** True when non-transparent art sits immediately outside the rect, which puts
 *  a neighbouring sprite one off-by-one away from bleeding into the frame. */
function touchesNeighbour(image: Pixels, rect: Rect): boolean {
  for (let x = rect.sx - 1; x <= rect.sx + rect.sw; x++) {
    if (alphaAt(image, x, rect.sy - 1) > 0) return true;
    if (alphaAt(image, x, rect.sy + rect.sh) > 0) return true;
  }
  for (let y = rect.sy; y < rect.sy + rect.sh; y++) {
    if (alphaAt(image, rect.sx - 1, y) > 0) return true;
    if (alphaAt(image, rect.sx + rect.sw, y) > 0) return true;
  }
  return false;
}

interface AxisNames {
  lead: keyof Insets;
  trail: keyof Insets;
  span: "width" | "height";
}

const AXIS_NAMES: Record<"x" | "y", AxisNames> = {
  x: { lead: "left", trail: "right", span: "width" },
  y: { lead: "top", trail: "bottom", span: "height" },
};

function axisFindings(name: string, report: AxisReport, size: number): Finding[] {
  const { lead: leadName, trail: trailName, span } = AXIS_NAMES[report.axis];
  const findings: Finding[] = [];

  if (report.center <= 0) {
    findings.push({
      level: "error",
      region: name,
      code: "no-center",
      message:
        `${leadName}+${trailName} (${report.lead}+${report.trail}) leaves no centre band in a ` +
        `${size}px ${span}. drawNineSlice tiles a zero-${span} slice, which never consumes any ` +
        `destination space — repeatSlice spins forever.`,
      fix: `reduce ${leadName}/${trailName} so ${leadName}+${trailName} < ${size}`,
    });
    return findings;
  }

  const edges = report.axis === "x" ? "top/bottom" : "left/right";

  if (report.periodic && report.center % report.period !== 0) {
    const shrink = report.center % report.period;
    findings.push({
      level: "error",
      region: name,
      code: "phase-break",
      message:
        `centre band is ${report.center}px but its art repeats every ${report.period}px. ` +
        `Tiling ${report.center}px steps the pattern out of phase at every wrap — a visible ` +
        `slit every ${report.center}px along the ${edges} edge.`,
      fix: `${trailName}: ${report.trail} → ${report.trail + shrink} (centre ${report.center} → ${report.center - shrink}, a multiple of ${report.period})`,
    });
  } else if (report.seam > 3) {
    // Either the band has no internal repeat (so tiling butts its last slice
    // against its first) or it repeats in phase but its ends still disagree.
    // Both read the same way on screen; only the wording differs.
    findings.push({
      level: "warning",
      region: name,
      code: report.periodic ? "wrap-seam" : "unwrapped-band",
      message: report.periodic
        ? `${edges} centre band tiles in phase, but its first and last slice differ ` +
          `${report.seam.toFixed(1)}× more than neighbouring slices inside it — the wrap ` +
          `will still read as an edge.`
        : `${edges} centre band is ${report.center}px of unique art with no internal repeat, ` +
          `so it is tiled whole. Its last slice differs ${report.seam.toFixed(1)}× more from its ` +
          `first than neighbouring slices do — a seam every ${report.center}px.`,
      fix: `make the band wrap (match slice ${report.center - 1} to slice 0), or narrow it to the part that does`,
    });
  }

  if (report.derived) {
    const bandEnd = size - report.trail;
    const runStart = report.suggestedLead;
    const runEnd = size - report.suggestedTrail;

    // The declared corners reach past the frame's own repeating unit into flat
    // edge art. Nothing renders wrong — the frame just cannot go as small as it
    // could. Report only the side that is actually generous: the two sides are
    // independent, and a frame is routinely slack on one and tight on the other.
    const generous: string[] = [];
    const shrink: string[] = [];
    if (runStart < report.lead) {
      generous.push(`${leadName} reaches ${report.lead - runStart}px past it`);
      shrink.push(`${leadName}: ${report.lead} → ${report.suggestedLead}`);
    }
    if (runEnd > bandEnd) {
      generous.push(`${trailName} reaches ${runEnd - bandEnd}px past it`);
      shrink.push(`${trailName}: ${report.trail} → ${report.suggestedTrail}`);
    }
    if (generous.length) {
      findings.push({
        level: "info",
        region: name,
        code: "inset-generous",
        message:
          `the frame's repeating unit runs ${runStart}–${runEnd} and ${generous.join(", ")}. ` +
          `Renders correctly; it only raises the frame's minimum ${span}.`,
        fix: shrink.join(", "),
      });
    }

    // The declared centre is wider than the repeating unit, so the surplus
    // slices tile along with it. Whether that is a bug depends on what they
    // are: more of the same texture is a tile doing its job, whereas art the
    // repeating unit never contains is corner detail that will now recur down
    // the edge. That distinction is measurable — check how much of the surplus
    // the repeating unit already uses.
    const unit = new Set(report.keys.slice(runStart, runEnd));
    const surplus =
      report.keys.slice(report.lead, Math.min(runStart, bandEnd)) +
      report.keys.slice(Math.max(runEnd, report.lead), bandEnd);
    // Only accuse the surplus when the run is at least as much evidence as the
    // art it is accusing. Symmetric art has a tiny period-1 run at its exact
    // midpoint — two matching slices in the middle of a gradient — and without
    // this the whole band gets called corner detail on that basis, with a
    // suggested inset that would leave the frame no centre at all.
    if ((report.lead < runStart || bandEnd > runEnd) && runEnd - runStart >= surplus.length) {
      const familiar = [...surplus].filter((slice) => unit.has(slice)).length / surplus.length;
      const foreign = familiar < 0.5;

      // Narrowing the centre onto the repeating unit is only a fix if what is
      // left is a whole number of that unit's periods. Snapping to the run's
      // bounds alone can hand back a band that tiles out of phase — trading a
      // warning for an error. Trim the trailing inset until it divides.
      const codes = [...report.keys].map((slice) => slice.charCodeAt(0));
      const runPeriod = bandPeriod(codes, runStart, runEnd) || 1;
      const whole = Math.floor((runEnd - runStart) / runPeriod) * runPeriod;
      const widen: string[] = [];
      if (report.lead !== runStart) widen.push(`${leadName}: ${report.lead} → ${runStart}`);
      const newTrail = size - runStart - whole;
      if (report.trail !== newTrail) widen.push(`${trailName}: ${report.trail} → ${newTrail}`);
      findings.push({
        level: foreign ? "warning" : "info",
        region: name,
        code: "centre-too-wide",
        message:
          `centre band spans ${report.lead}–${bandEnd} but the art only repeats over ` +
          `${runStart}–${runEnd}. The ${surplus.length} surplus slice(s) tile along with it, ` +
          (foreign
            ? `and none of them appear in the repeating unit — that is corner detail, and it ` +
              `will recur every ${report.center}px down the ${edges} edge.`
            : `and ${Math.round(familiar * 100)}% of them are slices the repeating unit already ` +
              `uses, so this reads as a texture tile rather than a defect.`),
        fix: widen.join(", "),
      });
    }
  }

  return findings;
}

/** Insets implied purely by the art, for a region that declares none. */
export function deriveInsets(image: Pixels, rect: Rect): Insets {
  const x = longestPeriodicRun(sliceIds(image, rect, "x"));
  const y = longestPeriodicRun(sliceIds(image, rect, "y"));
  return {
    left: x ? x.start : 0,
    right: x ? rect.sw - x.end : 0,
    top: y ? y.start : 0,
    bottom: y ? rect.sh - y.end : 0,
  };
}

/** Check one nine-slice frame against its source art. */
export function analyzeRegion(image: Pixels, input: RegionInput): RegionReport {
  const { name, rect } = input;
  const findings: Finding[] = [];
  const derived = deriveInsets(image, rect);
  const insets = input.insets ?? derived;

  const outside =
    rect.sx < 0 ||
    rect.sy < 0 ||
    rect.sw <= 0 ||
    rect.sh <= 0 ||
    rect.sx + rect.sw > image.width ||
    rect.sy + rect.sh > image.height;
  if (outside) {
    findings.push({
      level: "error",
      region: name,
      code: "out-of-bounds",
      message: `rect ${rect.sx},${rect.sy} ${rect.sw}×${rect.sh} does not fit the ${image.width}×${image.height} atlas`,
    });
  }

  for (const [key, value] of Object.entries(insets)) {
    if (!Number.isInteger(value) || value < 0) {
      findings.push({
        level: "error",
        region: name,
        code: "bad-inset",
        message: `inset ${key}=${value} must be a non-negative integer; canvas samples fractional source rects with filtering, which smears the corner`,
      });
    }
  }

  const x = analyzeAxis(image, rect, "x", insets.left, insets.right);
  const y = analyzeAxis(image, rect, "y", insets.top, insets.bottom);

  if (!outside) {
    findings.push(...axisFindings(name, x, rect.sw), ...axisFindings(name, y, rect.sh));

    const content = contentBounds(image, rect);
    if (!content) {
      findings.push({
        level: "error",
        region: name,
        code: "empty",
        message: "every pixel in the region is transparent — the rect points at blank atlas space",
      });
    } else if (content.sx > 0 || content.sy > 0 || content.sw < rect.sw || content.sh < rect.sh) {
      const tight = {
        sx: rect.sx + content.sx,
        sy: rect.sy + content.sy,
        sw: content.sw,
        sh: content.sh,
      };
      findings.push({
        level: "warning",
        region: name,
        code: "transparent-margin",
        message:
          `the rect includes ${content.sx}px left / ${content.sy}px top / ` +
          `${rect.sw - content.sx - content.sw}px right / ${rect.sh - content.sy - content.sh}px bottom ` +
          `of empty space. Those pixels become a transparent gutter drawn around the frame.`,
        fix: `rect: ${tight.sx},${tight.sy} ${tight.sw}×${tight.sh}`,
      });
    } else if (touchesNeighbour(image, rect)) {
      findings.push({
        level: "info",
        region: name,
        code: "no-padding",
        message:
          "art fills the rect edge-to-edge and the atlas has opaque pixels right outside it — " +
          "correct as long as the rect is exact, but any off-by-one samples the neighbour",
      });
    }
  }

  return { name, rect, insets, suggested: derived, x, y, findings };
}

/** Flag frames whose source rects overlap, which is nearly always a copy-paste
 *  slip in a hand-written atlas manifest. */
export function overlaps(regions: readonly RegionInput[]): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i].rect;
      const b = regions[j].rect;
      const hit =
        a.sx < b.sx + b.sw && b.sx < a.sx + a.sw && a.sy < b.sy + b.sh && b.sy < a.sy + a.sh;
      if (!hit) continue;
      // Skins alias deliberately — a slider track reusing the bar track art, a
      // panel title cut from the top of the panel. Only a *partial* overlap is
      // the copy-paste slip worth a warning.
      const same = a.sx === b.sx && a.sy === b.sy && a.sw === b.sw && a.sh === b.sh;
      const nested =
        (a.sx >= b.sx &&
          a.sy >= b.sy &&
          a.sx + a.sw <= b.sx + b.sw &&
          a.sy + a.sh <= b.sy + b.sh) ||
        (b.sx >= a.sx && b.sy >= a.sy && b.sx + b.sw <= a.sx + a.sw && b.sy + b.sh <= a.sy + a.sh);
      findings.push({
        level: same || nested ? "info" : "warning",
        region: regions[i].name,
        code: same ? "alias" : nested ? "nested" : "overlap",
        message: same
          ? `same source rect as "${regions[j].name}" — the two frames share art`
          : nested
            ? `source rect is cut from the same art as "${regions[j].name}" (${b.sx},${b.sy} ${b.sw}×${b.sh})`
            : `source rect partially overlaps "${regions[j].name}" (${b.sx},${b.sy} ${b.sw}×${b.sh}) — frames should not share pixels by halves`,
      });
    }
  }
  return findings;
}

/** Reproduce `drawNineSlice` (src/ui/core/theme.ts) on the CPU, including its
 *  clipped final tile and its scale-the-whole-frame fallback below the minimum
 *  size. Nearest-neighbour, because the renderer disables smoothing. */
export function compose(image: Pixels, rect: Rect, insets: Insets, w: number, h: number): Pixels {
  const out: Pixels = { width: w, height: h, data: new Uint8Array(w * h * 4) };
  const blit = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    for (let y = 0; y < dh; y++) {
      const source = sy + Math.min(sh - 1, Math.floor((y * sh) / dh));
      for (let x = 0; x < dw; x++) {
        const from = (source * image.width + sx + Math.min(sw - 1, Math.floor((x * sw) / dw))) * 4;
        const to = ((dy + y) * w + dx + x) * 4;
        if (dx + x < 0 || dx + x >= w || dy + y < 0 || dy + y >= h) continue;
        out.data[to] = image.data[from];
        out.data[to + 1] = image.data[from + 1];
        out.data[to + 2] = image.data[from + 2];
        out.data[to + 3] = image.data[from + 3];
      }
    }
  };
  const tile = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => {
    if (sw <= 0 || sh <= 0) return;
    for (let y = 0; y < dh; y += sh) {
      for (let x = 0; x < dw; x += sw) {
        blit(
          sx,
          sy,
          Math.min(sw, dw - x),
          Math.min(sh, dh - y),
          dx + x,
          dy + y,
          Math.min(sw, dw - x),
          Math.min(sh, dh - y),
        );
      }
    }
  };

  const { left, top, right, bottom } = insets;
  const { sx, sy, sw, sh } = rect;
  if (w < left + right || h < top + bottom) {
    blit(sx, sy, sw, sh, 0, 0, w, h);
    return out;
  }
  const centerW = sw - left - right;
  const centerH = sh - top - bottom;
  const dw = w - left - right;
  const dh = h - top - bottom;

  blit(sx, sy, left, top, 0, 0, left, top);
  blit(sx + sw - right, sy, right, top, w - right, 0, right, top);
  blit(sx, sy + sh - bottom, left, bottom, 0, h - bottom, left, bottom);
  blit(sx + sw - right, sy + sh - bottom, right, bottom, w - right, h - bottom, right, bottom);
  tile(sx + left, sy, centerW, top, left, 0, dw, top);
  tile(sx + left, sy + sh - bottom, centerW, bottom, left, h - bottom, dw, bottom);
  tile(sx, sy + top, left, centerH, 0, top, left, dh);
  tile(sx + sw - right, sy + top, right, centerH, w - right, top, right, dh);
  tile(sx + left, sy + top, centerW, centerH, left, top, dw, dh);
  return out;
}

/** Where a composed frame actually breaks phase. This is the empirical check:
 *  it reads the rendered result rather than the declaration, so it catches
 *  anything the geometry analysis above missed. */
export function phaseBreaks(
  image: Pixels,
  rect: Rect,
  insets: Insets,
  size: { w: number; h: number },
): { top: number[]; left: number[] } {
  const composed = compose(image, rect, insets, size.w, size.h);
  const scan = (axis: "x" | "y"): number[] => {
    const band: Rect =
      axis === "x"
        ? { sx: 0, sy: 0, sw: size.w, sh: Math.max(1, insets.top) }
        : { sx: 0, sy: 0, sw: Math.max(1, insets.left), sh: size.h };
    const ids = sliceIds(composed, band, axis);
    const lead = axis === "x" ? insets.left : insets.top;
    const trail = axis === "x" ? insets.right : insets.bottom;
    const period = bandPeriod(
      sliceIds(image, rect, axis),
      lead,
      (axis === "x" ? rect.sw : rect.sh) - trail,
    );
    const breaks: number[] = [];
    if (period <= 0) return breaks;
    for (let i = lead + period; i < ids.length - trail; i++) {
      if (ids[i] !== ids[i - period]) breaks.push(i);
    }
    return breaks;
  };
  return { top: scan("x"), left: scan("y") };
}
