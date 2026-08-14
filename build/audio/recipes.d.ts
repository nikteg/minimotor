import type { SfxSpec } from "./surface.js";
/** Classic sound-effect building blocks returned as tweakable plain specs. */
export declare const Recipes: {
    coin: () => SfxSpec;
    jump: () => SfxSpec;
    hit: () => SfxSpec;
    explosion: () => SfxSpec;
    laser: () => SfxSpec;
    powerup: () => SfxSpec;
    blip: () => SfxSpec;
    click: () => SfxSpec;
    whoosh: () => SfxSpec;
};
