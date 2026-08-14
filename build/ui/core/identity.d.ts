/** One segment of a widget id — a `string` or `number` — as taken by `ids`. */
export type IdPart = string | number;
/** Build stable readable widget ids without repeating a prefix.
 *
 * ```ts
 * const id = UI.ids("server-browser");
 * UI.button({ id: id("refresh"), label: "REFRESH" });
 * UI.listItem({ id: id("server", server.id), ...rect });
 * ``` */
export declare function ids(...prefix: IdPart[]): (...parts: IdPart[]) => string;
export interface IdScopeState {
    prefix: string;
    next: number;
}
/** Give otherwise-unidentified interactive widgets automatic, frame-stable
 * ids in callback order. Best for static forms/toolbars. Dynamic or
 * conditional collections should use explicit ids from `UI.ids()` instead.
 * Nested scopes compose their prefixes. */
export declare function idScope<R>(prefix: IdPart, children: () => R): R;
export declare function widgetId(explicit: string | undefined, kind: string): string | undefined;
export declare function requiredWidgetId(explicit: string | undefined, kind: string): string;
