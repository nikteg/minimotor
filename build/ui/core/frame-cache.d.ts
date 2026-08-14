/** A string-keyed map whose entries expire when untouched (get OR set) for
 *  `STALE_FRAMES` frames. Drop-in for the widget-state Maps; reads and writes
 *  go to the SELECTED app's storage. */
export interface SweptCache<V> {
    get(key: string): V | undefined;
    set(key: string, value: V): void;
    delete(key: string): void;
    clear(): void;
}
/** The current app's frame counter, as the sweeper bumps it.
 *
 *  For widgets whose state is "was I drawn on the PREVIOUS frame" rather than
 *  "have I been drawn lately". A `sweptCache` entry survives `STALE_FRAMES`
 *  after its widget stops being drawn — that is what makes it a cache and not
 *  a leak — so a bare presence check answers "within the last ten seconds",
 *  which is the wrong question for anything that toggles. Store this alongside
 *  the value and compare. */
export declare function uiFrameTick(): number;
/** Create a swept cache. Module-scope only — the callsite's slot is permanent. */
export declare function sweptCache<V>(): SweptCache<V>;
/** Advance the current app's frame tick and periodically drop its stale
 *  entries — called from the kernel's per-app frame-end housekeeping. */
export declare function sweepCaches(): void;
