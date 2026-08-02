// ---------- The sound bank ----------
// Every sound here is synthesized from a plain `SfxSpec` — no audio files, so
// the sample stays a single import and the specs are readable as data. They are
// grouped in one place because a shooter's audio is a MIX, not a list: the
// gunshot has to leave room for the hit confirm that lands 40 ms later, and
// tuning that means seeing the volumes next to each other.
//
// Two conventions worth keeping:
//
//   `pitch` and `stretch` take `[min, max]` tuples, and every sound that can
//   play twice in a second uses them. A gunshot that is bit-identical eleven
//   times in a row stops sounding like a gun and starts sounding like a sample
//   being retriggered, which is the single biggest tell of synthesized audio.
//
//   Anything another player causes is routed through `atDistance`, which is
//   this sample's whole spatialisation model: one volume curve, no panner. It
//   is honest about being cheap — but a remote shot that is as loud as your own
//   is much worse than one that is merely not to your left.

import type { AudioApi, SfxHandle } from "minimotor/audio";

/** How far away another player can be and still be heard at all. Past this the
 *  play is skipped outright rather than played at zero, which keeps a busy
 *  room from booking a voice per shot per player. */
const EARSHOT = 34;

export interface Sounds {
  /** Our own gunshot. */
  shot: SfxHandle;
  /** Someone else's, heard across the arena. */
  shotFar: SfxHandle;
  /** The trigger on an empty chamber. */
  dry: SfxHandle;
  reloadOut: SfxHandle;
  reloadIn: SfxHandle;
  /** Confirms a hit on a player. */
  hitPlayer: SfxHandle;
  /** Confirms a hit on a range target. */
  hitTarget: SfxHandle;
  /** Taking damage. */
  hurt: SfxHandle;
  death: SfxHandle;
  spawn: SfxHandle;
  /** A footfall; pitch-jittered on every play. */
  step: SfxHandle;
  /** UI: the terminal's switches and the menu's buttons. */
  click: SfxHandle;
  /** Joining or leaving a room. */
  join: SfxHandle;
  leave: SfxHandle;
}

export function createSounds(Audio: AudioApi): Sounds {
  return Audio.sfx({
    // A gunshot is a transient plus a body: the noise burst IS the shot, and
    // the low sine under it is what makes it read as a rifle rather than as
    // static. `attackMs: 0` on both — any fade-in at all sounds like a cough.
    shot: {
      noise: true,
      ms: 150,
      attackMs: 0,
      volume: 0.32,
      filter: { type: "lowpass", freq: { from: 5200, to: 320 }, q: 1.2 },
      layers: [
        { shape: "sawtooth", freq: { from: 190, to: 55 }, ms: 130, attackMs: 0, volume: 0.22 },
        // The crack that arrives a hair late and gives it a tail.
        {
          noise: true,
          ms: 240,
          attackMs: 0,
          volume: 0.09,
          delayMs: 18,
          filter: { type: "highpass", freq: 1600 },
        },
      ],
    },
    // Distance eats the top end first, which is most of what makes a far shot
    // sound far. Quieter AND duller, not merely quieter.
    shotFar: {
      noise: true,
      ms: 260,
      attackMs: 0,
      volume: 0.3,
      filter: { type: "lowpass", freq: { from: 900, to: 160 }, q: 0.8 },
      layers: [{ shape: "sine", freq: { from: 120, to: 48 }, ms: 220, attackMs: 0, volume: 0.18 }],
    },
    dry: {
      noise: true,
      ms: 45,
      attackMs: 0,
      volume: 0.16,
      filter: { type: "bandpass", freq: 2600, q: 3 },
    },
    // Two halves, played a beat apart by the reload timer rather than as one
    // long sound — so the second click lands when the magazine is actually in.
    reloadOut: {
      noise: true,
      ms: 70,
      attackMs: 0,
      volume: 0.18,
      filter: { type: "bandpass", freq: 1100, q: 2.5 },
    },
    reloadIn: {
      noise: true,
      ms: 110,
      attackMs: 0,
      volume: 0.24,
      filter: { type: "lowpass", freq: { from: 2600, to: 500 }, q: 1.5 },
      layers: [{ shape: "square", freq: { from: 260, to: 150 }, ms: 70, volume: 0.1, delayMs: 30 }],
    },
    // Short, bright and ABOVE the gunshot's band, so it survives being played
    // 40 ms into the shot that caused it.
    hitPlayer: { shape: "square", freq: { from: 1500, to: 2100 }, ms: 70, volume: 0.2 },
    hitTarget: {
      shape: "sine",
      freq: 1046,
      ms: 180,
      volume: 0.2,
      layers: [{ shape: "sine", freq: 1568, ms: 200, volume: 0.16, delayMs: 60 }],
    },
    // Damage is felt low. Nothing above 400 Hz, so it does not compete with the
    // shot that delivered it.
    hurt: {
      noise: true,
      ms: 220,
      attackMs: 0,
      volume: 0.34,
      filter: { type: "lowpass", freq: { from: 700, to: 90 } },
      layers: [{ shape: "sine", freq: { from: 160, to: 70 }, ms: 260, volume: 0.24 }],
    },
    death: {
      shape: "sawtooth",
      freq: { from: 260, to: 45 },
      ms: 900,
      volume: 0.3,
      filter: { type: "lowpass", freq: { from: 1400, to: 120 } },
    },
    spawn: {
      shape: "square",
      freq: { from: 330, to: 1320 },
      ms: 260,
      volume: 0.18,
      layers: [{ shape: "sine", freq: 1760, ms: 220, volume: 0.12, delayMs: 120 }],
    },
    // Quiet on purpose: a footstep you notice is a footstep that will drive you
    // mad within a minute. It is here to be missed when it stops.
    step: {
      noise: true,
      ms: 90,
      attackMs: 0,
      volume: 0.07,
      filter: { type: "lowpass", freq: { from: 1500, to: 260 }, q: 1.2 },
    },
    click: {
      noise: true,
      ms: 30,
      attackMs: 0,
      volume: 0.12,
      filter: { type: "highpass", freq: 4200 },
    },
    join: { shape: "sine", freq: { from: 520, to: 780 }, ms: 200, volume: 0.16 },
    leave: { shape: "sine", freq: { from: 780, to: 400 }, ms: 240, volume: 0.16 },
  });
}

/** Volume for something happening `distance` metres away, or 0 for out of
 *  earshot. Inverse-square is correct and sounds wrong in a 28-metre arena —
 *  everything is either deafening or silent — so this is a squared linear
 *  falloff, which keeps the near field usable. */
export function atDistance(distance: number, base = 1): number {
  if (distance >= EARSHOT) return 0;
  const t = 1 - distance / EARSHOT;
  return base * t * t;
}
