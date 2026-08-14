// ---------- Public audio surface ----------
// Typed sfx maps, tweakable recipes, buffer music, and buses:
//
//   const sfx = Audio.sfx({
//     jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
//     coin: Audio.Recipes.coin(),
//   });
//   sfx.jump.play();
//   sfx.coin.play({ pitch: [0.95, 1.15] });      // tuple = per-play jitter
//
//   const music = Audio.music(art.theme, { loop: true, volume: 0.5 });
//   music.play();  music.fade(0.15, 200);        // ducking = scene policy
//
//   Audio.buses.music.volume = 0.6;              // settings-screen knobs
//   Audio.buses.music.duckUnder(Audio.buses.sfx, { amount: 0.3 });
//
// The unlock ceremony is invisible (#35): the first pointer/key gesture
// unlocks the context. Pre-unlock one-shots drop with a dev warn (a stale
// blip is worse than silence); a pre-unlock `music.play()` starts on unlock.
// Audio runs in REAL time — deliberately outside the clock system (#37).
import { audioCtx, ensureAudio } from "./context.js";
import { tone } from "./sfx.js";
import { Mixer } from "./mixer.js";
// ---------- Unlock ----------
let unlockWired = false;
let unlocked = false;
const onUnlock = [];
function wireUnlock() {
    if (unlockWired || typeof window === "undefined")
        return;
    unlockWired = true;
    const unlock = () => {
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
        unlocked = true;
        try {
            ensureAudio();
        }
        catch {
            /* no WebAudio (tests) */
        }
        for (const fn of onUnlock.splice(0))
            fn();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
}
function isUnlocked() {
    return unlocked || audioCtx?.state === "running";
}
const duckRules = new Map(); // trigger bus → rules
function fireDucks(triggerBus) {
    const rules = duckRules.get(triggerBus);
    if (!rules)
        return;
    for (const rule of rules) {
        Mixer.bus(rule.target).duck(rule.amount, { holdMs: rule.ms });
    }
}
function busHandle(name) {
    return {
        name,
        get volume() {
            return Mixer.bus(name).volume;
        },
        set volume(v) {
            Mixer.bus(name).setVolume(v);
        },
        get muted() {
            return Mixer.bus(name).muted;
        },
        set muted(m) {
            Mixer.bus(name).setMuted(m);
        },
        fade(volume, ms) {
            Mixer.bus(name).setVolume(volume, ms);
        },
        duckUnder(trigger, opts = {}) {
            const rules = duckRules.get(trigger.name) ?? [];
            rules.push({
                target: name,
                amount: opts.amount ?? 0.5,
                ms: opts.ms ?? 300,
            });
            duckRules.set(trigger.name, rules);
        },
    };
}
/** The default buses — platform knobs that always exist. */
export const buses = {
    sfx: busHandle("sfx"),
    music: busHandle("music"),
};
/** The master output. */
export const master = {
    get volume() {
        return Mixer.masterVolume;
    },
    set volume(v) {
        Mixer.setMasterVolume(v);
    },
    get muted() {
        return Mixer.muted;
    },
    set muted(m) {
        Mixer.setMuted(m);
    },
};
/** A custom content bus (cave reverb, radio filter). `lowpass` inserts a
 *  low-pass filter at the given cutoff in Hz; `reverb` adds a per-bus reverb
 *  send at the given wet mix 0..1. Omit both for a plain bus. */
export function bus(name, opts = {}) {
    const b = Mixer.bus(name);
    if (opts.lowpass !== undefined)
        b.addFilter("lowpass", opts.lowpass);
    if (opts.reverb !== undefined) {
        Mixer.reverb(`${name}:reverb`, { wet: opts.reverb });
        b.send(`${name}:reverb`, opts.reverb);
    }
    return busHandle(name);
}
/** The raw AudioContext — the drop-to-WebAudio escape hatch. Null until the
 *  first unlock/use. */
export function raw() {
    return audioCtx;
}
/** Resolve a jitterable knob: a number is used as-is, a `[min, max]` tuple
 *  rolls once. Rolled ONE level up from `playSpec` so every layer of a sound
 *  shares the same roll — a chord that detuned per voice would be out of tune
 *  with itself. */
function roll(v) {
    if (typeof v === "number")
        return v;
    if (Array.isArray(v))
        return v[0] + Math.random() * (v[1] - v[0]);
    return 1;
}
function scaleFreq(freq, k, stretch) {
    if (freq === undefined)
        return undefined;
    if (typeof freq === "number")
        return freq * k;
    if (Array.isArray(freq)) {
        return freq.map((step) => ({
            value: step.hz * k,
            at: ((step.atMs ?? 0) / 1000) * stretch,
            curve: step.glide ?? "step",
        }));
    }
    // An omitted sweep `ms` leaves `time` undefined, which `tone` reads as "over
    // the whole note" — the sweep then stretches with the envelope for free.
    return {
        from: freq.from * k,
        to: freq.to * k,
        time: freq.ms === undefined ? undefined : (freq.ms / 1000) * stretch,
    };
}
function playSpec(spec, opts, busName, k, stretch, delayS = 0) {
    const t = {
        wave: spec.noise ? "noise" : (spec.shape ?? "sine"),
        freq: scaleFreq(spec.freq, k, stretch),
        gain: opts.volume ?? spec.volume ?? 0.3,
        attack: spec.attackMs === undefined ? undefined : (spec.attackMs / 1000) * stretch,
        release: Math.max(0.01, ((spec.ms ?? 250) / 1000) * stretch),
        filter: spec.filter,
        detune: spec.detune,
        bus: busName,
        delay: delayS,
    };
    tone(t);
    for (const layer of spec.layers ?? []) {
        playSpec(layer, { ...opts, volume: opts.volume ?? layer.volume }, busName, k, stretch, delayS + ((layer.delayMs ?? 0) / 1000) * stretch);
    }
}
/** Build a typed sfx map: each key becomes an `SfxHandle` (`sfx.jump.play()`).
 *  Specs are plain `SfxSpec` data — write them by hand or start from
 *  `Recipes`. All sounds route to `opts.bus`, defaulting to the sfx bus
 *  (`Audio.buses.sfx`); `PlayOptions.bus` can reroute a single play.
 *
 *      const sfx = Audio.sfx({
 *        jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
 *        coin: Audio.Recipes.coin(),
 *      });
 *      sfx.jump.play();
 *      sfx.coin.play({ pitch: [0.95, 1.15] }); // tuple = per-play jitter */
export function sfx(map, opts = {}) {
    wireUnlock();
    const defaultBus = opts.bus ?? buses.sfx;
    const out = {};
    for (const name of Object.keys(map)) {
        const spec = map[name];
        out[name] = {
            spec,
            play(playOpts = {}) {
                if (!isUnlocked()) {
                    console.warn(`createAudio: "${name}" dropped — audio unlocks on the first gesture`);
                    return;
                }
                const busName = (playOpts.bus ?? defaultBus).name;
                playSpec(spec, playOpts, busName, roll(playOpts.pitch), roll(playOpts.stretch));
                fireDucks(busName);
            },
        };
    }
    return out;
}
// A real engine isn't a sustained tone — it's a train of discrete cylinder
// *firings* whose rate rises with RPM, coloured by fixed body/exhaust
// resonances that DON'T move with RPM (the model behind Andy Farnell's engine
// patch in "Designing Sound"). Two mistakes make a synth engine sound "weird":
// gliding an oscillator (a sustained tone, not firings), or pitch-shifting a
// tonal loop (the timbre chipmunks as it revs). We avoid both: the loop is a
// train of broadband *clicks* (so changing their rate via `playbackRate` shifts
// the firing rate without pitching the colour), jittered so it isn't robotic,
// then run through FIXED resonant band-pass "formants" that give the constant
// engine growl. We ship no audio assets — the loop is built procedurally.
// Uneven inter-firing gaps: a cross-plane V8 fires on an irregular pattern,
// which is what gives a muscle car its lumpy "potato-potato" burble rather than
// an even drone. The gaps sum to 8 so the loop is one full 8-cylinder cycle.
const FIRING_GAPS = [1.3, 0.7, 0.7, 1.3, 1.3, 0.7, 0.7, 1.3];
function engineCycle(ctx) {
    const sr = ctx.sampleRate;
    const unit = Math.round(sr * 0.02); // base gap; ~ firing period at rate 1
    const len = unit * FIRING_GAPS.reduce((a, b) => a + b, 0);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const click = Math.max(4, Math.round(sr * 0.0022)); // ~2.2ms broadband thump
    let pos = 0;
    for (const gap of FIRING_GAPS) {
        // Jitter timing & amplitude per firing so it isn't a robotic pulse.
        const jitter = Math.round((Math.random() - 0.5) * unit * 0.1);
        const start = Math.max(0, Math.round(pos) + jitter);
        const amp = 0.75 + Math.random() * 0.4;
        for (let i = 0; i < click && start + i < len; i++) {
            const env = Math.exp(-i / (click * 0.4)); // sharp attack, fast decay
            d[start + i] += (Math.random() * 2 - 1) * env * amp; // broadband click
        }
        pos += gap * unit;
    }
    return buf;
}
/** A continuous, gear-shifting engine — a looping train of synthesized cylinder
 *  firings whose `playbackRate` climbs with RPM, coloured by a bank of fixed
 *  resonant formants (so it revs without chipmunking) and a load-opening
 *  low-pass, plus a slip-driven noise layer that screeches on the limit.
 *  Persistent (unlike the one-shot `sfx`) — real-time, outside the clock system.
 *  Feed it telemetry:
 *
 *    const engine = Audio.engine({ gears: 6 });
 *    // each frame: engine.update({ throttle, speed: car.speed, maxSpeed, slip }); */
export function engine(opts = {}) {
    wireUnlock();
    const idleHz = opts.idleHz ?? 42;
    const revHz = opts.revHz ?? 165;
    const gears = Math.max(1, opts.gears ?? 5);
    const drive = opts.drive ?? 1;
    const volume = opts.volume ?? 0.5;
    const rumbleLevel = opts.rumble ?? 0;
    const busName = typeof opts.bus === "string" ? opts.bus : (opts.bus ?? buses.sfx).name;
    let n = null;
    let stopped = false;
    function build() {
        try {
            const ctx = ensureAudio();
            const out = Mixer.bus(busName).input;
            const sr = ctx.sampleRate;
            const gain = ctx.createGain();
            gain.gain.value = 0;
            gain.connect(out);
            // Master low-pass: engine body, opens (brightens) as it revs under load.
            const lp = ctx.createBiquadFilter();
            lp.type = "lowpass";
            lp.frequency.value = 700;
            lp.Q.value = 0.7;
            lp.connect(gain);
            // --- Harmonic body (source-filter): a sawtooth at the firing fundamental
            // gives a continuous low rumble that rises with revs, plus a sine sub an
            // octave down for weight. This is the "voice" that stops the engine from
            // being just isolated clicks (farts). Frequencies are set directly, so
            // they track RPM without the buffer's playbackRate → no chipmunking.
            const saw = ctx.createOscillator();
            saw.type = "sawtooth";
            saw.frequency.value = idleHz;
            const sawGain = ctx.createGain();
            sawGain.gain.value = 0.16;
            saw.connect(sawGain).connect(lp);
            saw.start();
            const sub = ctx.createOscillator();
            sub.type = "sine";
            sub.frequency.value = idleHz / 2;
            const subGain = ctx.createGain();
            subGain.gain.value = 0.85; // heavy sub → deep muscle-car chest
            sub.connect(subGain).connect(lp);
            sub.start();
            // --- Firing texture: the click train through FIXED resonant formants adds
            // the mechanical rasp/growl on top of the body. `textureGain` keeps it a
            // seasoning, not the whole sound.
            const cycle = engineCycle(ctx);
            const firingBase = sr / Math.round(sr * 0.02); // firings/sec at rate 1
            const motor = ctx.createBufferSource();
            motor.buffer = cycle;
            motor.loop = true;
            motor.start();
            const textureGain = ctx.createGain();
            textureGain.gain.value = 0.6;
            textureGain.connect(lp);
            const formants = [
                [58, 10, 1.0], // deep boom / exhaust body (muscle-car chest)
                [120, 8, 0.55], // mid burble
                [240, 5, 0.25], // upper rasp — kept low so it stays dark, not fizzy
            ];
            for (const [freq, q, g] of formants) {
                const bp = ctx.createBiquadFilter();
                bp.type = "bandpass";
                bp.frequency.value = freq;
                bp.Q.value = q;
                const fg = ctx.createGain();
                fg.gain.value = g;
                motor.connect(bp).connect(fg).connect(textureGain);
            }
            // A touch of the dry click train keeps the mechanical attack/edge.
            const dry = ctx.createGain();
            dry.gain.value = 0.15;
            motor.connect(dry).connect(textureGain);
            // Tyre-skid layer: band-passed white noise, its own gain (slip-driven).
            const nb = ctx.createBuffer(1, sr, sr);
            const nd = nb.getChannelData(0);
            for (let i = 0; i < nd.length; i++)
                nd[i] = Math.random() * 2 - 1;
            const skid = ctx.createBufferSource();
            skid.buffer = nb;
            skid.loop = true;
            const skidFilter = ctx.createBiquadFilter();
            skidFilter.type = "bandpass";
            skidFilter.frequency.value = 1400;
            skidFilter.Q.value = 0.8;
            const skidGain = ctx.createGain();
            skidGain.gain.value = 0;
            skid.connect(skidFilter).connect(skidGain).connect(out);
            skid.start();
            // Optional road-rumble layer: a second tap off the same noise, low-passed
            // and gained by speed — road/tyre roar under the engine (off unless set).
            let rumbleSrc;
            let rumbleGain;
            let rumbleFilter;
            if (rumbleLevel > 0) {
                rumbleSrc = ctx.createBufferSource();
                rumbleSrc.buffer = nb;
                rumbleSrc.loop = true;
                rumbleFilter = ctx.createBiquadFilter();
                rumbleFilter.type = "lowpass";
                rumbleFilter.frequency.value = 220;
                rumbleGain = ctx.createGain();
                rumbleGain.gain.value = 0;
                rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(out);
                rumbleSrc.start();
            }
            return {
                ctx,
                firingBase,
                motor,
                textureGain,
                saw,
                sub,
                lp,
                gain,
                skid,
                skidGain,
                skidFilter,
                rumbleSrc,
                rumbleGain,
                rumbleFilter,
            };
        }
        catch {
            return null; // no WebAudio — silent, non-fatal
        }
    }
    return {
        update(d) {
            if (stopped)
                return;
            if (!n && isUnlocked())
                n = build();
            if (!n)
                return;
            const throttle = Math.max(0, Math.min(1, d.throttle ?? 0));
            const norm = d.maxSpeed ? Math.max(0, Math.min(1, (d.speed ?? 0) / d.maxSpeed)) : 0;
            const load = Math.max(0, Math.min(1, d.load ?? throttle));
            const slip = Math.max(0, Math.min(1, d.slip ?? 0));
            // Rev = fractional position within the current gear (snaps down on shift).
            const gearRev = (norm * gears) % 1;
            const hz = idleHz + (revHz - idleHz) * (0.25 + 0.75 * gearRev) * (0.6 + 0.4 * drive * load);
            const t = n.ctx.currentTime;
            const ramp = (p, v, tau = 0.06) => p.setTargetAtTime(v, t, tau);
            // Tonal body tracks the firing fundamental directly (no chipmunking); the
            // click texture's playbackRate carries the firing RATE (fixed formants).
            ramp(n.saw.frequency, hz, 0.05);
            ramp(n.sub.frequency, hz / 2, 0.05);
            ramp(n.motor.playbackRate, Math.max(0.05, hz / n.firingBase), 0.05);
            // Firing texture grows with revs/load; softer at idle so it isn't farty.
            ramp(n.textureGain.gain, 0.35 + 0.5 * norm + 0.25 * load, 0.08);
            // Master low-pass opens with rpm & load — kept low-slung so the engine
            // stays dark and chesty (muscle car) rather than bright/buzzy.
            ramp(n.lp.frequency, 420 + norm * 1200 + load * 1100 * drive);
            ramp(n.gain.gain, volume * (0.55 + 0.45 * load) * (0.6 + 0.4 * norm), 0.1);
            // Skid: only real slip, quadratic so light cornering stays quiet, and well
            // under the engine so it never dominates.
            ramp(n.skidGain.gain, Math.min(0.12, slip * slip * 0.14) * volume, 0.05);
            // Road rumble: opens and swells with speed (norm), sitting under the body.
            if (n.rumbleGain && n.rumbleFilter) {
                ramp(n.rumbleFilter.frequency, 200 + norm * 700, 0.12);
                ramp(n.rumbleGain.gain, rumbleLevel * (0.15 + 0.85 * norm) * volume, 0.12);
            }
        },
        stop() {
            stopped = true;
            if (!n)
                return;
            try {
                n.motor.stop();
                n.saw.stop();
                n.sub.stop();
                n.skid.stop();
                n.rumbleSrc?.stop();
                n.gain.disconnect();
            }
            catch {
                /* already torn down */
            }
            n = null;
        },
    };
}
/** Build a reusable recorded sound from an encoded audio buffer. Decoding is
 * lazy and happens once; subsequent plays create cheap independent buffer
 * sources so rapid impacts do not cut each other off. */
export function sample(data, opts = {}) {
    wireUnlock();
    const defaultBus = opts.bus ?? buses.sfx;
    let decoded = null;
    let decoding = null;
    let pending = [];
    const active = new Set();
    async function decode() {
        if (decoded)
            return decoded;
        if (!decoding) {
            decoding = (async () => {
                try {
                    const result = await ensureAudio().decodeAudioData(data.slice(0));
                    decoded = result;
                    return result;
                }
                catch {
                    return null;
                }
                finally {
                    decoding = null;
                }
            })();
        }
        return decoding;
    }
    function start(buffer, options) {
        try {
            const ctx = ensureAudio();
            const busName = (options.bus ?? defaultBus).name;
            const gain = ctx.createGain();
            gain.gain.value = Math.max(0, options.volume ?? 1);
            gain.connect(Mixer.bus(busName).input);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = Math.max(0.05, options.pitch ?? 1);
            source.connect(gain);
            active.add(source);
            source.onended = () => {
                active.delete(source);
                try {
                    gain.disconnect();
                }
                catch {
                    /* already disconnected */
                }
            };
            source.start();
            fireDucks(busName);
        }
        catch {
            /* A missing or blocked audio device must never stop the game loop. */
        }
    }
    function flush(buffer) {
        const plays = pending;
        pending = [];
        if (buffer)
            for (const options of plays)
                start(buffer, options);
    }
    return {
        play(options = {}) {
            if (!isUnlocked())
                return;
            pending.push(options);
            void decode().then(flush);
        },
        stop() {
            pending = [];
            for (const source of active) {
                try {
                    source.stop();
                }
                catch {
                    /* already stopped */
                }
            }
            active.clear();
        },
    };
}
/** A music track from a loaded asset (`Assets.load` audio entries are
 *  ArrayBuffers, decoded lazily here). */
export function music(data, opts = {}) {
    wireUnlock();
    let source = null;
    let gain = null;
    let decoded = null;
    let wantPlaying = false;
    let starting = false;
    async function start() {
        if (source || starting || !wantPlaying)
            return;
        starting = true;
        try {
            const ctx = ensureAudio();
            decoded ?? (decoded = await ctx.decodeAudioData(data.slice(0)));
            if (!wantPlaying || source)
                return;
            gain = ctx.createGain();
            gain.gain.value = opts.volume ?? 1;
            const busName = (opts.bus ?? buses.music).name;
            gain.connect(Mixer.bus(busName).input);
            source = ctx.createBufferSource();
            source.buffer = decoded;
            source.loop = opts.loop ?? false;
            source.connect(gain);
            source.onended = () => {
                if (!source?.loop) {
                    source = null;
                    wantPlaying = false;
                }
            };
            source.start();
            fireDucks(busName);
        }
        catch {
            wantPlaying = false; // no WebAudio — stay silent, stay alive
        }
        finally {
            starting = false;
        }
    }
    return {
        play() {
            if (wantPlaying)
                return; // idempotent
            wantPlaying = true;
            if (isUnlocked())
                void start();
            else
                onUnlock.push(() => void start());
        },
        stop() {
            wantPlaying = false;
            source?.stop();
            source = null;
        },
        fade(volume, ms) {
            const ctx = audioCtx;
            if (!gain || !ctx)
                return;
            gain.gain.cancelScheduledValues(ctx.currentTime);
            gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + ms / 1000);
        },
        get playing() {
            return source !== null;
        },
    };
}
