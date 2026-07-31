// ---------- Widget identity ----------
import { uiSlot } from "./state.js";

/** One segment of a widget id — a `string` or `number` — as taken by `ids`. */
export type IdPart = string | number;

/** Build stable readable widget ids without repeating a prefix.
 *
 * ```ts
 * const id = UI.ids("server-browser");
 * UI.button({ id: id("refresh"), label: "REFRESH" });
 * UI.listItem({ id: id("server", server.id), ...rect });
 * ``` */
export function ids(...prefix: IdPart[]): (...parts: IdPart[]) => string {
  const base = prefix.map(String).join(":");
  return (...parts) => [base, ...parts.map(String)].filter(Boolean).join(":");
}

export interface IdScopeState {
  prefix: string;
  next: number;
}

// Active idScope nesting — per app, like every other frame-scoped stack.
const idScopes = uiSlot<IdScopeState[]>(() => []);

/** Give otherwise-unidentified interactive widgets automatic, frame-stable
 * ids in callback order. Best for static forms/toolbars. Dynamic or
 * conditional collections should use explicit ids from `UI.ids()` instead.
 * Nested scopes compose their prefixes. */
export function idScope<R>(prefix: IdPart, children: () => R): R {
  const scopes = idScopes();
  const parent = scopes[scopes.length - 1];
  const full = parent ? `${parent.prefix}:${prefix}` : String(prefix);
  scopes.push({ prefix: full, next: 0 });
  try {
    return children();
  } finally {
    scopes.pop();
  }
}

export function widgetId(explicit: string | undefined, kind: string): string | undefined {
  if (explicit) return explicit;
  const scopes = idScopes();
  const scope = scopes[scopes.length - 1];
  return scope ? `${scope.prefix}:${kind}:${scope.next++}` : undefined;
}

export function requiredWidgetId(explicit: string | undefined, kind: string): string {
  const id = widgetId(explicit, kind);
  if (!id) {
    throw new Error(`UI.${kind} requires an id, or must be drawn inside UI.idScope()`);
  }
  return id;
}
