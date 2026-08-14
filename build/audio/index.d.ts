import * as AudioModule from "./module.js";
import type { BusHandle, EngineHandle, EngineOptions, MusicHandle, MusicOptions, SampleHandle, SfxHandle, SfxSpec } from "./surface.js";
import type { MusicChannel } from "./music.js";
import type { App } from "../engine/app.js";
export interface AudioMaster {
    volume: number;
    muted: boolean;
    fade(volume: number, ms: number): void;
}
export type AudioApi = Omit<typeof AudioModule, "buses" | "master" | "bus" | "sfx" | "engine" | "music" | "createMusicChannel"> & {
    readonly buses: {
        readonly sfx: BusHandle;
        readonly music: BusHandle;
    };
    readonly master: AudioMaster;
    /** This app's procedural step scheduler, booked onto `buses.music`. */
    readonly Music: MusicChannel;
    bus(name: string, options?: {
        lowpass?: number;
        reverb?: number;
    }): BusHandle;
    sfx<K extends string>(map: Record<K, SfxSpec>, options?: {
        bus?: BusHandle;
    }): Record<K, SfxHandle>;
    engine(options?: EngineOptions): EngineHandle;
    music(data: ArrayBuffer, options?: MusicOptions): MusicHandle;
    sample(data: ArrayBuffer, options?: {
        bus?: BusHandle;
    }): SampleHandle;
    destroy(): void;
};
/** Create one isolated mixer surface over the page's shared AudioContext. */
export declare function createAudio(app: App): AudioApi;
export * from "./module.js";
