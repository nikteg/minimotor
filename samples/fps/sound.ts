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
  /** The four beats of a reload — see `RELOAD_STAGES` in `fps.ts`. */
  magOut: SfxHandle;
  magDrop: SfxHandle;
  magIn: SfxHandle;
  boltRack: SfxHandle;
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
    // A reload is FOUR events, not one, and hearing them separately is what
    // makes it read as a mechanism rather than as a noise: the catch releases,
    // the empty magazine falls and bounces, a fresh one seats, and the bolt is
    // racked. They are played by the reload timer at the moments they happen
    // (see `RELOAD_STAGES`), so the sound is the animation — a player learns
    // exactly how far through they are without looking at the bar.

    // 1. The catch. Small, sharp, mechanical; the sound of a button, not a gun.
    magOut: {
      noise: true,
      ms: 55,
      attackMs: 0,
      volume: 0.2,
      filter: { type: "bandpass", freq: 1900, q: 4 },
      layers: [{ shape: "square", freq: 620, ms: 28, attackMs: 0, volume: 0.07 }],
    },
    // 2. The empty magazine falling clear — hollow, and it BOUNCES, which is
    // the detail that makes it sound like an object rather than a sample.
    magDrop: {
      noise: true,
      ms: 120,
      attackMs: 0,
      volume: 0.17,
      filter: { type: "lowpass", freq: { from: 2200, to: 380 }, q: 1.4 },
      layers: [
        { shape: "triangle", freq: { from: 300, to: 190 }, ms: 90, attackMs: 0, volume: 0.09 },
        {
          noise: true,
          ms: 70,
          attackMs: 0,
          volume: 0.08,
          delayMs: 85,
          filter: { type: "bandpass", freq: 1500, q: 2 },
        },
      ],
    },
    // 3. A fresh one seated. The heaviest of the four: low, solid, no ring.
    magIn: {
      noise: true,
      ms: 130,
      attackMs: 0,
      volume: 0.26,
      filter: { type: "lowpass", freq: { from: 2400, to: 300 }, q: 1.6 },
      layers: [
        { shape: "square", freq: { from: 240, to: 120 }, ms: 90, attackMs: 0, volume: 0.13 },
      ],
    },
    // 4. The bolt: pulled back, then released to slam forward 70 ms later. Two
    // metallic transients in quick succession is the whole character of it, and
    // one of them alone just sounds like another click.
    boltRack: {
      noise: true,
      ms: 65,
      attackMs: 0,
      volume: 0.19,
      filter: { type: "bandpass", freq: { from: 2400, to: 3400 }, q: 3 },
      layers: [
        {
          noise: true,
          ms: 95,
          attackMs: 0,
          volume: 0.24,
          delayMs: 70,
          filter: { type: "bandpass", freq: { from: 3200, to: 900 }, q: 2.2 },
        },
        {
          shape: "square",
          freq: { from: 420, to: 170 },
          ms: 70,
          attackMs: 0,
          volume: 0.1,
          delayMs: 70,
        },
      ],
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

// ---------- The one sampled sound ----------
// Everything above is synthesized from a spec, which is right for a gunshot:
// it has to fire eleven times a second and vary every time. A fart is the
// opposite — one long, detailed, irregular event — and the layered-oscillator
// version of it always sounded like a kazoo. So this one is a real 16-bit WAV.
//
// It is generated rather than recorded: `assets/make-fart.mjs` writes it, and
// re-running that script reproduces the committed file byte for byte. That
// keeps the repo free of a sample of unclear provenance while still giving the
// per-sample control a spec cannot reach — a pulse train whose period wanders,
// turbulence gated by that pulse, and a resonant filter closing as the pitch
// sags. Swapping in an actual recording means replacing the file; nothing here
// changes.

/** Where the ears are. Fed from the camera every frame — without it every
 *  panned source is judged against a listener still facing −Z at the origin,
 *  which is silently wrong the moment the player turns around. */
export interface Ears {
  /** Head position in world space. */
  x: number;
  y: number;
  z: number;
  /** The direction the head faces, as a unit vector. */
  fx: number;
  fy: number;
  fz: number;
}

/** A sampled one-shot, played in 3D. */
export interface Sample {
  /** Ready to play. False until the fetch and decode finish. */
  readonly loaded: boolean;
  /** Point the listener at where the player's head is and what it faces. */
  listen(ears: Ears): void;
  /** Play at a world position. `gain` is a plain multiplier on top of the
   *  distance model — 1 for normal, more to make something carry. `rate`
   *  detunes and stretches in one (0.8 = lower AND longer). */
  playAt(at: { x: number; y: number; z: number }, gain?: number, rate?: number): void;
}

/** Load `url` and play it into a bus drowning in reverb.
 *
 *  The reverb is an aux SEND at full level on a bus with a long generated
 *  impulse, not a filter on the sample: the dry hit still arrives on time and
 *  the tail blooms behind it, which is what makes a small arena sound like a
 *  much larger and more regrettable one. */
export function createSample(Audio: AudioApi, url: string, reverbSeconds = 5.5): Sample {
  const bus = Audio.bus("fart");
  Audio.Mixer.reverb("fps-cavern", { seconds: reverbSeconds, decay: 1.15, wet: 0.95 });
  Audio.Mixer.bus(bus.name).send("fps-cavern", 1);

  let buffer: AudioBuffer | null = null;
  let started = false;
  let ears: Ears | null = null;

  // Decoding needs an AudioContext, and there is none until the page has had a
  // gesture — so the fetch starts now and the decode waits for the first play.
  const bytes = fetch(url)
    .then((r) => r.arrayBuffer())
    .catch(() => null);

  const ensure = (): void => {
    if (started) return;
    const ctx = Audio.raw();
    if (!ctx) return;
    started = true;
    void bytes.then((data) => {
      if (data)
        ctx.decodeAudioData(data.slice(0)).then(
          (decoded) => (buffer = decoded),
          () => {},
        );
    });
  };

  return {
    get loaded() {
      return buffer !== null;
    },
    listen(next) {
      ears = next;
      // Decoding is kicked off from HERE, not from the first `playAt`. There is
      // no AudioContext until the page has had a gesture, so the decode cannot
      // happen at construction — but `listen` runs every frame, which means it
      // fires on the first frame after the player's first click and the buffer
      // is ready long before anything wants to play it. Starting it on demand
      // instead makes the first one silent, every session.
      ensure();
      const ctx = Audio.raw();
      if (!ctx) return;
      const l = ctx.listener;
      // Two APIs for one thing. The AudioParam form is the current spec and is
      // the only one that can be ramped; `setPosition`/`setOrientation` are
      // deprecated but are still what Safari implements. Feature-detect rather
      // than pick, or this is silent on one browser or the other.
      if (l.positionX) {
        l.positionX.value = next.x;
        l.positionY.value = next.y;
        l.positionZ.value = next.z;
        l.forwardX.value = next.fx;
        l.forwardY.value = next.fy;
        l.forwardZ.value = next.fz;
        l.upX.value = 0;
        l.upY.value = 1;
        l.upZ.value = 0;
      } else {
        l.setPosition(next.x, next.y, next.z);
        l.setOrientation(next.fx, next.fy, next.fz, 0, 1, 0);
      }
    },
    playAt(at, gain = 1, rate = 1) {
      ensure();
      const ctx = Audio.raw();
      if (!ctx || !buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;

      // A real panner rather than a volume curve. HRTF gives the browser's
      // head-related transfer function, which is what puts a sound BEHIND you
      // rather than merely quiet — the one cue a scalar volume can never carry,
      // and the whole point of doing this in a shooter.
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      // Inverse distance is the physical law and it is unusable in a 28-metre
      // arena: everything is either deafening or gone. `linear` with a rolloff
      // tuned to the arena keeps the near field playable, and `maxDistance`
      // does the culling `atDistance` used to do by hand.
      panner.distanceModel = "linear";
      panner.refDistance = 2;
      panner.maxDistance = EARSHOT;
      panner.rolloffFactor = 1;
      if (panner.positionX) {
        panner.positionX.value = at.x;
        panner.positionY.value = at.y;
        panner.positionZ.value = at.z;
      } else {
        panner.setPosition(at.x, at.y, at.z);
      }

      const level = ctx.createGain();
      // Being farted at from INSIDE your own head is the one case the distance
      // model gets wrong: at zero distance a linear model is already at full
      // gain, but it is also perfectly centred and therefore weirdly flat. A
      // small boost when the source is on top of you restores the shock.
      const d = ears ? Math.hypot(at.x - ears.x, at.y - ears.y, at.z - ears.z) : 0;
      level.gain.value = gain * (d < 1 ? 1.6 : 1);

      source.connect(level).connect(panner).connect(Audio.Mixer.bus(bus.name).input);
      source.start();
    },
  };
}
