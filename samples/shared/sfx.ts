import type { AudioApi } from "minimotor/audio";

export function createSfx(Audio: AudioApi) {
  function notes(sequence: number[], type: OscillatorType = "triangle", volume = 0.14) {
    sequence.forEach((freq, i) => {
      Audio.tone({
        wave: type,
        freq,
        gain: volume,
        attack: 0.008,
        release: 0.15,
        delay: i * 0.065,
      });
    });
  }
  return {
    pickup: () => notes([523, 659, 784, 1047], "sine", 0.16),
    click: () => notes([420, 680], "square", 0.09),
    zap: () => notes([1040, 760, 410, 160], "sawtooth", 0.12),
    hit: () => notes([150, 90], "square", 0.2),
    wave: () => notes([392, 523, 659, 784], "triangle", 0.15),
    win: () => notes([523, 659, 784, 1047, 1319], "sine", 0.17),
    lose: () => notes([330, 247, 165], "sawtooth", 0.16),
  };
}
