import { Audio, Mathf } from "minimotor";
import type { Bus } from "minimotor";

interface AudioState {
  player: { inCar: boolean; x: number; y: number };
  car: { x: number; y: number; vx: number; vy: number; angle: number };
  gameState: string;
}

type SfxBuild = (ctx: AudioContext, now: number, out: AudioNode) => void;

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(
    1,
    Math.max(1, Math.floor(ctx.sampleRate * seconds)),
    ctx.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createRoadAudio(getState: () => AudioState) {
  let roadAudioReady = false;
  Audio.Mixer.setMasterVolume(0.82);
  Audio.Mixer.compressor({ threshold: -15, ratio: 10, attack: 0.004, release: 0.18, knee: 5 });
  Audio.Mixer.reverb("road-city", { seconds: 0.72, decay: 2.8, wet: 0.18 });
  Audio.Mixer.delay("road-slap", { time: 0.095, feedback: 0.12, wet: 0.14 });
  const vehicleBus = Audio.Mixer.bus("road-vehicle");
  const combatBus = Audio.Mixer.bus("road-combat");
  const impactBus = Audio.Mixer.bus("road-impact");
  const pickupBus = Audio.Mixer.bus("road-pickup");
  const uiBus = Audio.Mixer.bus("road-ui");
  vehicleBus.setVolume(0.62);
  vehicleBus.addFilter("lowpass", 1800, 0.65);
  combatBus.setVolume(0.72);
  combatBus.send("road-slap", 0.16);
  combatBus.send("road-city", 0.07);
  impactBus.setVolume(0.78);
  impactBus.addFilter("lowpass", 3200, 0.55);
  impactBus.send("road-city", 0.18);
  pickupBus.setVolume(0.58);
  pickupBus.send("road-city", 0.2);
  uiBus.setVolume(0.48);
  uiBus.send("road-city", 0.08);

  function roadSfx(bus: Bus, build: SfxBuild) {
    if (!roadAudioReady) return;
    Audio.playSfx((ctx, now) => build(ctx, now, bus.input));
  }

  function gunSound(x: number, y: number, weapon = "pistol") {
    const { player, car } = getState();
    const listener = player.inCar ? car : player;
    const distance = Math.hypot(x - listener.x, y - listener.y);
    if (distance > 1400) return;
    const level = Mathf.clamp(1 - distance / 1500, 0.16, 1);
    const pan = Mathf.clamp((x - listener.x) / 700, -0.85, 0.85);
    roadSfx(combatBus, (ctx, now, out) => {
      const spatialGain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      spatialGain.gain.value = level;
      panner.pan.value = pan;
      spatialGain.connect(panner).connect(out);
      const crack = ctx.createBufferSource();
      const crackFilter = ctx.createBiquadFilter();
      const crackGain = ctx.createGain();
      const body = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      const mechanism = ctx.createOscillator();
      const mechanismGain = ctx.createGain();
      const shotgun = weapon === "shotgun";
      const smg = weapon === "smg";
      crack.buffer = noiseBuffer(ctx, shotgun ? 0.1 : 0.055);
      crackFilter.type = "bandpass";
      crackFilter.frequency.value = shotgun ? 1050 : smg ? 1900 : 1550;
      crackFilter.Q.value = shotgun ? 0.55 : 0.75;
      const crackDuration = shotgun ? 0.14 : smg ? 0.032 : 0.065;
      crackGain.gain.setValueAtTime(shotgun ? 0.29 : smg ? 0.105 : 0.18, now);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, now + crackDuration);
      body.type = "triangle";
      body.frequency.setValueAtTime(shotgun ? 125 : smg ? 235 : 185, now);
      body.frequency.exponentialRampToValueAtTime(shotgun ? 48 : smg ? 105 : 72, now + 0.075);
      const bodyDuration = shotgun ? 0.18 : smg ? 0.045 : 0.09;
      bodyGain.gain.setValueAtTime(shotgun ? 0.19 : smg ? 0.055 : 0.1, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + bodyDuration);
      mechanism.type = smg ? "square" : "sine";
      mechanism.frequency.setValueAtTime(shotgun ? 72 : smg ? 980 : 430, now + 0.008);
      mechanism.frequency.exponentialRampToValueAtTime(
        shotgun ? 38 : smg ? 520 : 260,
        now + (shotgun ? 0.16 : smg ? 0.035 : 0.08),
      );
      mechanismGain.gain.setValueAtTime(0.0001, now);
      mechanismGain.gain.exponentialRampToValueAtTime(
        shotgun ? 0.12 : smg ? 0.045 : 0.035,
        now + 0.009,
      );
      mechanismGain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + (shotgun ? 0.17 : smg ? 0.04 : 0.085),
      );
      crack.connect(crackFilter).connect(crackGain).connect(spatialGain);
      body.connect(bodyGain).connect(spatialGain);
      mechanism.connect(mechanismGain).connect(spatialGain);
      crack.start(now);
      body.start(now);
      mechanism.start(now);
      body.stop(now + bodyDuration + 0.01);
      mechanism.stop(now + (shotgun ? 0.18 : smg ? 0.05 : 0.095));
    });
  }

  function enemyDeathSound(x: number, y: number) {
    const { player, car } = getState();
    const listener = player.inCar ? car : player;
    const distance = Math.hypot(x - listener.x, y - listener.y);
    if (distance > 1500) return;
    roadSfx(impactBus, (ctx, now, out) => {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.gain.value = Mathf.clamp(1 - distance / 1700, 0.12, 0.8);
      pan.pan.value = Mathf.clamp((x - listener.x) / 750, -0.85, 0.85);
      gain.connect(pan).connect(out);
      const crunch = ctx.createBufferSource();
      const crunchFilter = ctx.createBiquadFilter();
      const crunchGain = ctx.createGain();
      const fall = ctx.createOscillator();
      const fallGain = ctx.createGain();
      crunch.buffer = noiseBuffer(ctx, 0.24);
      crunchFilter.type = "bandpass";
      crunchFilter.frequency.setValueAtTime(950, now);
      crunchFilter.frequency.exponentialRampToValueAtTime(260, now + 0.22);
      crunchFilter.Q.value = 0.65;
      crunchGain.gain.setValueAtTime(0.18, now);
      crunchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      fall.type = "sawtooth";
      fall.frequency.setValueAtTime(155, now);
      fall.frequency.exponentialRampToValueAtTime(44, now + 0.28);
      fallGain.gain.setValueAtTime(0.085, now);
      fallGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      crunch.connect(crunchFilter).connect(crunchGain).connect(gain);
      fall.connect(fallGain).connect(gain);
      crunch.start(now);
      fall.start(now);
      fall.stop(now + 0.31);
    });
  }

  function pickupSound() {
    roadSfx(pickupBus, (ctx, now, out) => {
      for (let i = 0; i < 3; i++) {
        const tone = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + i * 0.055;
        tone.type = "sine";
        tone.frequency.value = [440, 660, 880][i];
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.095, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        tone.connect(gain).connect(out);
        tone.start(start);
        tone.stop(start + 0.17);
      }
    });
  }

  function doorSound(entering: boolean) {
    roadSfx(uiBus, (ctx, now, out) => {
      const thud = ctx.createOscillator();
      const thudGain = ctx.createGain();
      const latch = ctx.createBufferSource();
      const latchFilter = ctx.createBiquadFilter();
      const latchGain = ctx.createGain();
      thud.type = "sine";
      thud.frequency.setValueAtTime(entering ? 105 : 125, now);
      thud.frequency.exponentialRampToValueAtTime(52, now + 0.11);
      thudGain.gain.setValueAtTime(0.12, now);
      thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      latch.buffer = noiseBuffer(ctx, 0.06);
      latchFilter.type = "highpass";
      latchFilter.frequency.value = 1200;
      latchGain.gain.setValueAtTime(0.07, now);
      latchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
      thud.connect(thudGain).connect(out);
      latch.connect(latchFilter).connect(latchGain).connect(out);
      thud.start(now);
      thud.stop(now + 0.14);
      latch.start(now);
    });
  }

  function carExplosionSound(x: number, y: number) {
    const { player, car } = getState();
    const listener = player.inCar ? car : player;
    const distance = Math.hypot(x - listener.x, y - listener.y);
    if (distance > 1900) return;
    const level = Mathf.clamp(1 - distance / 2100, 0.12, 1);
    roadSfx(impactBus, (ctx, now, out) => {
      const spatial = ctx.createGain();
      const pan = ctx.createStereoPanner();
      spatial.gain.value = level;
      pan.pan.value = Mathf.clamp((x - listener.x) / 850, -0.9, 0.9);
      spatial.connect(pan).connect(out);
      const blast = ctx.createBufferSource();
      const blastFilter = ctx.createBiquadFilter();
      const blastGain = ctx.createGain();
      const boom = ctx.createOscillator();
      const boomGain = ctx.createGain();
      const metal = ctx.createOscillator();
      const metalGain = ctx.createGain();
      blast.buffer = noiseBuffer(ctx, 0.58);
      blastFilter.type = "lowpass";
      blastFilter.frequency.setValueAtTime(2100, now);
      blastFilter.frequency.exponentialRampToValueAtTime(180, now + 0.52);
      blastGain.gain.setValueAtTime(0.34, now);
      blastGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
      boom.type = "sine";
      boom.frequency.setValueAtTime(82, now);
      boom.frequency.exponentialRampToValueAtTime(27, now + 0.5);
      boomGain.gain.setValueAtTime(0.3, now);
      boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.54);
      metal.type = "triangle";
      metal.frequency.setValueAtTime(310, now + 0.035);
      metal.frequency.exponentialRampToValueAtTime(95, now + 0.34);
      metalGain.gain.setValueAtTime(0.0001, now);
      metalGain.gain.exponentialRampToValueAtTime(0.07, now + 0.04);
      metalGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
      blast.connect(blastFilter).connect(blastGain).connect(spatial);
      boom.connect(boomGain).connect(spatial);
      metal.connect(metalGain).connect(spatial);
      blast.start(now);
      boom.start(now);
      metal.start(now);
      boom.stop(now + 0.55);
      metal.stop(now + 0.37);
    });
    Audio.Mixer.duck("road-vehicle", 0.85, { attackMs: 5, holdMs: 300, releaseMs: 900 });
    Audio.Mixer.duck("road-combat", 0.55, { attackMs: 8, holdMs: 180, releaseMs: 600 });
  }

  function damageSound(fatal = false) {
    roadSfx(impactBus, (ctx, now, out) => {
      const noise = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const pulse = ctx.createOscillator();
      const pulseGain = ctx.createGain();
      noise.buffer = noiseBuffer(ctx, fatal ? 0.3 : 0.14);
      filter.type = "lowpass";
      filter.frequency.value = fatal ? 520 : 900;
      gain.gain.setValueAtTime(fatal ? 0.2 : 0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (fatal ? 0.3 : 0.14));
      pulse.type = "sine";
      pulse.frequency.setValueAtTime(fatal ? 92 : 125, now);
      pulse.frequency.exponentialRampToValueAtTime(42, now + (fatal ? 0.32 : 0.12));
      pulseGain.gain.setValueAtTime(fatal ? 0.16 : 0.09, now);
      pulseGain.gain.exponentialRampToValueAtTime(0.0001, now + (fatal ? 0.34 : 0.13));
      noise.connect(filter).connect(gain).connect(out);
      pulse.connect(pulseGain).connect(out);
      noise.start(now);
      pulse.start(now);
      pulse.stop(now + (fatal ? 0.35 : 0.14));
    });
    if (fatal) {
      Audio.Mixer.duck("road-vehicle", 0.75, { attackMs: 20, holdMs: 250, releaseMs: 700 });
      Audio.Mixer.duck("road-combat", 0.45, { attackMs: 15, holdMs: 140, releaseMs: 450 });
    }
  }

  function joinSound() {
    roadSfx(uiBus, (ctx, now, out) => {
      const air = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const airGain = ctx.createGain();
      const tone = ctx.createOscillator();
      const toneGain = ctx.createGain();
      air.buffer = noiseBuffer(ctx, 0.36);
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(420, now);
      filter.frequency.exponentialRampToValueAtTime(1900, now + 0.3);
      filter.Q.value = 0.6;
      airGain.gain.setValueAtTime(0.0001, now);
      airGain.gain.exponentialRampToValueAtTime(0.055, now + 0.05);
      airGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
      tone.type = "sine";
      tone.frequency.setValueAtTime(220, now + 0.08);
      tone.frequency.exponentialRampToValueAtTime(440, now + 0.3);
      toneGain.gain.setValueAtTime(0.0001, now);
      toneGain.gain.exponentialRampToValueAtTime(0.045, now + 0.1);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      air.connect(filter).connect(airGain).connect(out);
      tone.connect(toneGain).connect(out);
      air.start(now);
      tone.start(now);
      tone.stop(now + 0.36);
    });
  }

  function radioSound() {
    roadSfx(uiBus, (ctx, now, out) => {
      const tone = ctx.createOscillator();
      const gain = ctx.createGain();
      tone.type = "square";
      tone.frequency.setValueAtTime(760, now);
      tone.frequency.setValueAtTime(980, now + 0.045);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      tone.connect(gain).connect(out);
      tone.start(now);
      tone.stop(now + 0.11);
    });
  }

  // The shared arcade engine model (click-train + tonal body + a speed-driven
  // road-rumble layer), routed to the vehicle bus. Telemetry is fed each frame
  // from the car's Gizmos.car controller (see updateEngineSound).
  let engine: ReturnType<typeof Audio.engine> | null = null;
  function ensureEngineSound() {
    engine ??= Audio.engine({
      bus: vehicleBus.name,
      gears: 5,
      idleHz: 38,
      revHz: 120,
      rumble: 0.5,
      volume: 0.5,
    });
  }
  function updateEngineSound(engineLoad: number, tireSlip: number) {
    if (!engine) return;
    const { player, car, gameState } = getState();
    const speed = Math.abs(car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle));
    engine.update({
      throttle: engineLoad,
      load: engineLoad,
      speed,
      maxSpeed: 620,
      slip: Mathf.clamp(tireSlip / 300, 0, 1),
    });
    // Audio.engine always idles; gate the whole vehicle bus so there's no engine
    // hum while on foot or dead.
    vehicleBus.setVolume(gameState === "alive" && player.inCar ? 0.62 : 0);
  }
  function crashSound(speed: number) {
    Audio.Mixer.duck("road-vehicle", Mathf.clamp(speed / 900, 0.12, 0.5), {
      attackMs: 8,
      holdMs: 45,
      releaseMs: 260,
    });
    Audio.playSfx((ctx, now) => {
      const out = impactBus.input;
      const length = Math.floor(ctx.sampleRate * 0.24);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const envelope = Math.exp((-8 * i) / length);
        data[i] = (Math.random() * 2 - 1) * envelope;
      }
      const noise = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const thump = ctx.createOscillator();
      const thumpGain = ctx.createGain();
      noise.buffer = buffer;
      filter.type = "lowpass";
      filter.frequency.value = 420 + Math.min(900, speed);
      gain.gain.setValueAtTime(Math.min(0.28, 0.07 + speed / 2200), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.23);
      thump.type = "sine";
      thump.frequency.setValueAtTime(85 + Math.min(55, speed * 0.08), now);
      thump.frequency.exponentialRampToValueAtTime(38, now + 0.16);
      thumpGain.gain.setValueAtTime(Math.min(0.16, 0.05 + speed / 3500), now);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      noise.connect(filter).connect(gain).connect(out);
      thump.connect(thumpGain).connect(out);
      noise.start(now);
      thump.start(now);
      thump.stop(now + 0.2);
    });
  }

  function unlockRoadAudio() {
    roadAudioReady = true;
    ensureEngineSound();
  }

  return {
    carExplosionSound,
    crashSound,
    damageSound,
    doorSound,
    enemyDeathSound,
    gunSound,
    joinSound,
    pickupSound,
    radioSound,
    unlockRoadAudio,
    updateEngineSound,
  };
}
