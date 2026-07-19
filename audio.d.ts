export type SfxBuilder = (ctx: AudioContext, now: number) => void;
export declare function ensureAudio(): AudioContext;
export declare function playSfx(build: SfxBuilder): void;
export interface MusicConfig {
    volume: number;
    stepMs: number;
    schedule: (step: number, when: number) => void;
    storageKey?: string;
}
export declare const music: {
    on: boolean;
    start(config: MusicConfig): void;
    setOn(on: boolean): void;
    note(freq: number, dur: number, type: OscillatorType, vol: number, when: number): void;
    kick(when: number): void;
    noiseHit(when: number, dur: number, vol: number, filterType: BiquadFilterType, freq: number): void;
};
