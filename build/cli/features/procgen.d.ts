import { type CharGrid } from "../../procgen/index.js";
type Kind = "dungeon" | "cave" | "rooms" | "wfc";
export interface GenerateOptions {
    kind: Kind;
    cols: number;
    rows: number;
    seed: number;
    locks: number;
    fill: number;
    /** Sample text, required for `wfc`. */
    sample?: string;
    /** Glyph to steer toward `share`, for `wfc`. */
    steerGlyph?: string;
    share: number;
    repair: boolean;
}
/** Run one generator and return its grid. Exported so tests drive the same
 *  code path the CLI does, without spawning a process. */
export declare function generate(options: GenerateOptions): CharGrid;
declare const _default: {
    readonly name: "procgen";
    readonly summary: "Generate levels from seeds or samples, and measure them.";
    readonly usage: readonly ["mm procgen gen <dungeon|cave|rooms|wfc> [options]", "mm procgen measure <level.txt>"];
    readonly run: (input: string[]) => void;
};
export default _default;
