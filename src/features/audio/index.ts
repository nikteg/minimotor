// ---------- Audio ----------
// WebAudio helpers that own the `AudioContext`, timing and volume, with the
// mixer's lifetime tied to one app. `Audio.sfx` builds crash-safe sound
// effects, `Audio.music` schedules a song, `Audio.bus`/`Audio.master` mix, and
// `Audio.tone`/`Audio.engine` synthesize.
//
//   const Audio = createAudio(app);
//   const sounds = Audio.sfx({
//     jump: { freq: { from: 300, to: 600 }, ms: 120 },
//     hit: { noise: true, ms: 80 },
//   });
//   sounds.jump.play();

import * as AudioModule from "../../audio/index.js";
import type {
  BusHandle,
  EngineHandle,
  EngineOptions,
  MusicHandle,
  MusicOptions,
  SfxHandle,
  SfxSpec,
} from "../../audio/api.js";
import type { App } from "../../engine/app.js";

export interface AudioMaster {
  volume: number;
  muted: boolean;
  fade(volume: number, ms: number): void;
}

export type AudioApi = Omit<
  typeof AudioModule,
  "buses" | "master" | "bus" | "sfx" | "engine" | "music"
> & {
  readonly buses: { readonly sfx: BusHandle; readonly music: BusHandle };
  readonly master: AudioMaster;
  bus(name: string, options?: { lowpass?: number; reverb?: number }): BusHandle;
  sfx<K extends string>(
    map: Record<K, SfxSpec>,
    options?: { bus?: BusHandle },
  ): Record<K, SfxHandle>;
  engine(options?: EngineOptions): EngineHandle;
  music(data: ArrayBuffer, options?: MusicOptions): MusicHandle;
  destroy(): void;
};

let nextAudioId = 1;

/** Create one isolated mixer surface over the page's shared AudioContext. */
export function createAudio(app: App): AudioApi {
  const prefix = `game-${nextAudioId++}:`;
  const sfxBus = AudioModule.bus(`${prefix}sfx`);
  const musicBus = AudioModule.bus(`${prefix}music`);
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
    for (const handle of stoppable) handle.stop();
    stoppable.clear();
    sfxBus.muted = true;
    musicBus.muted = true;
  };

  const api: AudioApi = {
    ...AudioModule,
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
    sfx(map, options = {}) {
      return AudioModule.sfx(map, { bus: options.bus ?? sfxBus });
    },
    engine(options = {}) {
      const handle = AudioModule.engine({
        ...options,
        bus: options.bus ?? sfxBus,
      });
      stoppable.add(handle);
      return handle;
    },
    music(data, options = {}) {
      const handle = AudioModule.music(data, {
        ...options,
        bus: options.bus ?? musicBus,
      });
      stoppable.add(handle);
      return handle;
    },
    destroy,
  };
  app.onDestroy(destroy);
  return api;
}
