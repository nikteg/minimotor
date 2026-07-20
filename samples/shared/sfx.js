// Small musical sound palette shared by the showcase games. These are still
// Minimotor.Audio primitives: each effect builds WebAudio nodes through the
// crash-safe Audio.playSfx bus rather than shipping an audio asset.
import { Minimotor } from "minimotor";

const { Audio } = Minimotor;
function notes(sequence, type = "triangle", volume = 0.14) {
  Audio.playSfx((ctx, now, out) => {
    for (const [i, freq] of sequence.entries()) {
      const start = now + i * 0.065;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(out);
      osc.start(start);
      osc.stop(start + 0.18);
    }
  });
}

export function pickup() { notes([523, 659, 784, 1047], "sine", 0.16); }
export function click() { notes([420, 680], "square", 0.09); }
export function zap() { notes([1040, 760, 410, 160], "sawtooth", 0.12); }
export function hit() { notes([150, 90], "square", 0.2); }
export function wave() { notes([392, 523, 659, 784], "triangle", 0.15); }
export function win() { notes([523, 659, 784, 1047, 1319], "sine", 0.17); }
export function lose() { notes([330, 247, 165], "sawtooth", 0.16); }
