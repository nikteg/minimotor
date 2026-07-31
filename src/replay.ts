export interface ReplayRecording<T = unknown> {
  readonly frames: readonly T[];
}

export interface ReplayApi {
  readonly recording: boolean;
  readonly playing: boolean;
  start(): void;
  record<T>(frame: T): void;
  stop<T>(): ReplayRecording<T>;
  play<T>(recording: ReplayRecording<T>): void;
  next<T>(): T | undefined;
  reset(): void;
}

export function createReplay(): ReplayApi {
  let frames: unknown[] = [];
  let recording = false;
  let playback: readonly unknown[] | null = null;
  let cursor = 0;
  return {
    get recording() {
      return recording;
    },
    get playing() {
      return playback !== null;
    },
    start() {
      frames = [];
      recording = true;
      playback = null;
      cursor = 0;
    },
    record(frame) {
      if (recording) frames.push(structuredClone(frame));
    },
    stop<T>() {
      recording = false;
      return { frames: structuredClone(frames) as T[] };
    },
    play(value) {
      recording = false;
      playback = value.frames;
      cursor = 0;
    },
    next<T>() {
      if (!playback) return undefined;
      const value = playback[cursor++] as T | undefined;
      if (cursor >= playback.length) playback = null;
      return value;
    },
    reset() {
      frames = [];
      recording = false;
      playback = null;
      cursor = 0;
    },
  };
}
