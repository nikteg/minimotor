// Small musical sound palette shared by the showcase games. No audio assets —
// each effect is a short arpeggio of Audio.tone voices (a declarative, crash-
// safe synth voice: oscillator + envelope, on the SFX bus).
import { Audio } from "minimotor";
function notes(sequence, type = "triangle", volume = 0.14) {
  sequence.forEach((freq, i) => {
    Audio.tone({ wave: type, freq, gain: volume, attack: 0.008, release: 0.15, delay: i * 0.065 });
  });
}

export function pickup() { notes([523, 659, 784, 1047], "sine", 0.16); }
export function click() { notes([420, 680], "square", 0.09); }
export function zap() { notes([1040, 760, 410, 160], "sawtooth", 0.12); }
export function hit() { notes([150, 90], "square", 0.2); }
export function wave() { notes([392, 523, 659, 784], "triangle", 0.15); }
export function win() { notes([523, 659, 784, 1047, 1319], "sine", 0.17); }
export function lose() { notes([330, 247, 165], "sawtooth", 0.16); }
