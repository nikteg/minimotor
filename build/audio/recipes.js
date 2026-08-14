/** Classic sound-effect building blocks returned as tweakable plain specs. */
export const Recipes = {
    coin: () => ({
        shape: "sine",
        freq: 988,
        ms: 220,
        volume: 0.25,
        layers: [{ shape: "sine", freq: 1319, ms: 250, volume: 0.25, delayMs: 80 }],
    }),
    jump: () => ({
        shape: "triangle",
        freq: { from: 220, to: 660 },
        ms: 180,
        volume: 0.3,
    }),
    hit: () => ({
        noise: true,
        ms: 120,
        volume: 0.4,
        filter: { type: "lowpass", freq: { from: 2000, to: 200 } },
    }),
    explosion: () => ({
        noise: true,
        ms: 500,
        volume: 0.5,
        filter: { type: "lowpass", freq: { from: 1200, to: 80 } },
    }),
    laser: () => ({
        shape: "sawtooth",
        freq: { from: 1800, to: 220 },
        ms: 150,
        volume: 0.3,
    }),
    powerup: () => ({
        shape: "square",
        freq: { from: 440, to: 1760 },
        ms: 320,
        volume: 0.3,
    }),
    blip: () => ({ shape: "square", freq: 880, ms: 80, volume: 0.25 }),
    click: () => ({
        noise: true,
        ms: 35,
        volume: 0.2,
        filter: { type: "highpass", freq: 5000 },
    }),
    whoosh: () => ({
        noise: true,
        ms: 260,
        volume: 0.3,
        filter: { type: "bandpass", freq: { from: 400, to: 2400 }, q: 1.5 },
    }),
};
