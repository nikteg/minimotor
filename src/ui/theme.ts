// ---------- Theme tokens ----------
// The shared palette/metrics every on-canvas surface styles from — `ui`
// widgets and the on-screen gamepad both read it, so it lives in core rather
// than inside either one. The helpers that PAINT with these tokens (and so
// need text measurement) stay in `ui/core/theme.ts`.

/** Every color, font and metric the widgets use. Override any subset with
 *  `setTheme`; per-widget style options still win over the theme. */
export interface Theme {
  /** Font family for all widget text. */
  font: string;
  /** Base label size in px; widget fonts scale from it. */
  fontSize: number;
  /** Highlight color: active tab underline, hover borders, fills, knobs. */
  accent: string;
  /** Dimmer accent for resting knobs/thumbs. */
  accentSoft: string;
  /** Primary text. */
  text: string;
  /** Secondary text: captions, inactive tabs, disabled hints. */
  textDim: string;
  /** Disabled label text. */
  textDisabled: string;
  /** Widget fill when idle. */
  bg: string;
  /** Widget fill when hovered. */
  bgHover: string;
  /** Widget fill when held/pressed — also the recessed tone for insets
   *  (checkbox well) and disabled/inactive fills. */
  bgActive: string;
  /** Widget border when not hovered. */
  border: string;
  /** Panel/modal/tooltip background. */
  panelBg: string;
  /** Track behind sliders/scrollbars/bars. */
  track: string;
  /** The modal backdrop. */
  dim: string;
  /** Fill of a `variant: "primary"` button (its label is `bgActive`). */
  primary: string;
  /** Fill of a `variant: "danger"` button (its label is `text`). */
  danger: string;
  /** Border thickness in px for buttons/panels/toggles/tabs. Default 2. */
  borderWidth: number;
  /** Corner radius in px (0 = square). Default 0. */
  radius: number;
  /** Horizontal padding added around auto-sized button labels. Default 28. */
  buttonPadX: number;
  /** Default inner padding (px) for bordered content containers — the `group`
   *  body inset. Override per call with `pad`. Structural flow containers
   *  (`row`/`col`) intentionally stay flush (pad 0) so widgets align to their
   *  slot edges; use a `group` (or an explicit `pad`) when you want a box that
   *  insets its content. Default 8. */
  pad: number;
  /** Default inset (px) applied by `UI.text` when no `pad`/`padX`/`padY` is
   *  given. 0 keeps a label flush with its slot (so it lines up with sibling
   *  widgets and HUD columns); raise it for a global label inset. Default 0. */
  textPad: number;
}

/** The built-in `Theme` — the base every `setTheme` override is merged over
 *  (so overrides never compound) and the reset target for `getTheme`. */
export const defaultTheme: Theme = {
  font: "monospace",
  fontSize: 13,
  accent: "#4ecdc4",
  accentSoft: "#3a8f89",
  text: "#e8f0f4",
  textDim: "#7d8894",
  textDisabled: "#5a6a75",
  bg: "#24384a",
  bgHover: "#2c4356",
  bgActive: "#1d2b36",
  border: "#3a5568",
  panelBg: "rgba(13,18,26,0.92)",
  track: "rgba(255,255,255,0.12)",
  dim: "rgba(0,0,0,0.55)",
  primary: "#4ecdc4",
  danger: "#ff6b6b",
  borderWidth: 2,
  radius: 0,
  buttonPadX: 28,
  pad: 8,
  textPad: 0,
};

export let theme: Theme = { ...defaultTheme };

/** Restyle every widget at once. Overrides are merged over the DEFAULT theme
 *  (not the current one), so two `setTheme` calls don't compound. */
export function setTheme(overrides: Partial<Theme>): void {
  theme = { ...defaultTheme, ...overrides };
}

/** The active theme (live object — read, don't mutate). */
export function getTheme(): Theme {
  return theme;
}
