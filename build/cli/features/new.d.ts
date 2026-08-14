/** Is this CLI running out of a source checkout rather than an installed copy? */
export declare function runningFromCheckout(): boolean;
/**
 * What to write for the new project's `minimotor` dependency.
 *
 * The default is the published range, because that is what a generated project
 * should say for everyone who isn't hacking on the engine: it resolves from the
 * registry, it survives being committed and shared, and it doesn't encode a path
 * from the machine that ran the scaffold. Deciding this by sniffing whether the
 * CLI lives under `node_modules` guesses at intent and fails badly when it
 * guesses wrong — a stranger's project would point at a directory on someone
 * else's disk.
 *
 * `--link` is the explicit opt-in for engine development: `link:` rather than
 * `file:`, so edits to the checkout show up in the game without reinstalling.
 */
export declare function minimotorDependency(projectRoot: string, link?: boolean): string;
/** Template names come from directories, so adding an example adds a template. */
export declare function templateNames(): string[];
/**
 * Read the shared base and selected example directly from `__examples`, filling
 * the `{{name}}` and `{{minimotor}}` placeholders.
 */
export declare function templateFiles(template: string, name: string, minimotor?: string): Record<string, string>;
declare const _default: {
    readonly name: "new";
    readonly summary: "Create minimal game projects from terse templates.";
    readonly usage: readonly ["mm new <template> <directory> [--force] [--link]"];
    readonly run: (input: string[]) => void;
};
export default _default;
