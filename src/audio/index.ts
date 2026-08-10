// ---------- Audio ----------
// WebAudio helpers that own the `AudioContext`, timing and volume, with the
// mixer's lifetime tied to one app. `Audio.sfx` builds crash-safe sound
// effects, `Audio.music` schedules a song, `Audio.bus`/`Audio.master` mix, and
// `Audio.tone`/`Audio.engine` synthesize.
//
// EVERY SOUND THIS APP MAKES HANGS OFF ITS OWN BUSES. The page shares one
// `AudioContext` (browsers cap them), but the sfx bus, the music bus, any
// `Audio.bus(name)` and the `Audio.Music` step scheduler are all namespaced per
// app, so `Audio.master` reaches all of them and `destroy()` silences all of
// them. Two apps on one page never hear each other. The one deliberate
// exception is `Audio.Mixer`, the page-wide mixer itself — reach for it only
// when you actually mean "every app on this page".
//
//   const Audio = createAudio(app);
//   const sounds = Audio.sfx({
//     jump: { freq: { from: 300, to: 600 }, ms: 120 },
//     hit: { noise: true, ms: 80 },
//   });
//   sounds.jump.play();

import * as AudioModule from "./module.js";
import type {
  BusHandle,
  EngineHandle,
  EngineOptions,
  MusicHandle,
  MusicOptions,
  SampleHandle,
  SfxHandle,
  SfxSpec,
} from "./surface.js";
import type { MusicChannel } from "./music.js";
import type { App } from "@src/engine/app.js";

export interface AudioMaster {
  volume: number;
  muted: boolean;
  fade(volume: number, ms: number): void;
}

export type AudioApi = Omit<
  typeof AudioModule,
  "buses" | "master" | "bus" | "sfx" | "engine" | "music" | "createMusicChannel"
> & {
  readonly buses: { readonly sfx: BusHandle; readonly music: BusHandle };
  readonly master: AudioMaster;
  /** This app's procedural step scheduler, booked onto `buses.music`. */
  readonly Music: MusicChannel;
  bus(name: string, options?: { lowpass?: number; reverb?: number }): BusHandle;
  sfx<K extends string>(
    map: Record<K, SfxSpec>,
    options?: { bus?: BusHandle },
  ): Record<K, SfxHandle>;
  engine(options?: EngineOptions): EngineHandle;
  music(data: ArrayBuffer, options?: MusicOptions): MusicHandle;
  sample(data: ArrayBuffer, options?: { bus?: BusHandle }): SampleHandle;
  destroy(): void;
};

let nextAudioId = 1;

/** Create one isolated mixer surface over the page's shared AudioContext. */
export function createAudio(app: App): AudioApi {
  const prefix = `game-${nextAudioId++}:`;
  const sfxBus = AudioModule.bus(`${prefix}sfx`);
  const musicBus = AudioModule.bus(`${prefix}music`);
  // The step scheduler books notes straight onto the bus node, so it takes the
  // raw mixer bus behind the same name as the `musicBus` handle above — one
  // channel strip, two views of it.
  const music = AudioModule.createMusicChannel(AudioModule.Mixer.bus(`${prefix}music`));
  const stoppable = new Set<{ stop(): void }>();
  let masterVolume = 1;
  let masterMuted = false;

  const applyMaster = (ms = 0) => {
    const value = masterMuted ? 0 : masterVolume;
    sfxBus.fade(value, ms);
    musicBus.fade(value, ms);
  };

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    // Stop the scheduler FIRST: muting only drops the gain, so a running
    // channel would keep booking notes (and holding a page-level visibility
    // listener) for a canvas that no longer exists.
    music.stop();
    for (const handle of stoppable) handle.stop();
    stoppable.clear();
    sfxBus.muted = true;
    musicBus.muted = true;
  };

  const api: AudioApi = {
    Mixer: AudioModule.Mixer,
    Music: music,
    Recipes: AudioModule.Recipes,
    Sfx: AudioModule.Sfx,
    ensureAudio: AudioModule.ensureAudio,
    playSfx: AudioModule.playSfx,
    raw: AudioModule.raw,
    tone: AudioModule.tone,
    buses: { sfx: sfxBus, music: musicBus },
    master: {
      get volume() {
        return masterVolume;
      },
      set volume(value) {
        masterVolume = value;
        applyMaster();
      },
      get muted() {
        return masterMuted;
      },
      set muted(value) {
        masterMuted = value;
        applyMaster();
      },
      fade(value, ms) {
        masterVolume = value;
        applyMaster(ms);
      },
    },
    bus(name, options) {
      return AudioModule.bus(`${prefix}${name}`, options);
    },
    sfx(map, { bus = sfxBus } = {}) {
      return AudioModule.sfx(map, { bus });
    },
    engine({ bus = sfxBus, ...options } = {}) {
      const handle = AudioModule.engine({ ...options, bus });
      stoppable.add(handle);
      return handle;
    },
    music(data, { bus = musicBus, ...options } = {}) {
      const handle = AudioModule.music(data, { ...options, bus });
      stoppable.add(handle);
      return handle;
    },
    sample(data, { bus = sfxBus } = {}) {
      const handle = AudioModule.sample(data, { bus });
      stoppable.add(handle);
      return handle;
    },
    destroy,
  };
  app.onDestroy(destroy);
  return api;
}

export * from "./module.js";
