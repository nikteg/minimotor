export interface AssetIssue {
    level: "error" | "warning";
    file: string;
    message: string;
}
/** Validate parseable assets, references, naming, and optional tile dimensions. */
export declare function checkAssets(root: string, tileSize?: number): AssetIssue[];
declare const _default: {
    readonly name: "assets";
    readonly summary: "Validate asset files, references, and tile dimensions.";
    readonly usage: readonly ["mm assets check [directory] [options]"];
    readonly run: (input: string[]) => void;
};
export default _default;
