declare const _default: {
    readonly name: "ui";
    readonly summary: "Verify UI frame art — nine-slices, tile frames, and autotile sets.";
    readonly usage: readonly ["mm ui nineslice <atlas.png> --rect <x,y,w,h> [--insets <l,t,r,b>]", "mm ui nineslice <manifest.json>", "mm ui nineslice <theme.ts> --atlas <atlas.png>", "mm ui frame <atlas.png> --grid <x,y,tw,th[,spacing]>", "mm ui autotile <atlas.png> --grid <x,y,tw,th[,spacing]> --masks <m,m,…> --cols <n>"];
    readonly run: (input: string[]) => Promise<void>;
};
export default _default;
