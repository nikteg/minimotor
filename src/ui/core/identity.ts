// ---------- Widget identity ----------

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

export const idScopes: IdScopeState[] = [];

/** Give otherwise-unidentified interactive widgets automatic, frame-stable
 * ids in callback order. Best for static forms/toolbars. Dynamic or
 * conditional collections should use explicit ids from `UI.ids()` instead.
 * Nested scopes compose their prefixes. */
export function idScope<R>(prefix: IdPart, children: () => R): R {
  const parent = idScopes[idScopes.length - 1];
  const full = parent ? `${parent.prefix}:${prefix}` : String(prefix);
  idScopes.push({ prefix: full, next: 0 });
  try {
    return children();
  } finally {
    idScopes.pop();
  }
}

export function widgetId(explicit: string | undefined, kind: string): string | undefined {
  if (explicit) return explicit;
  const scope = idScopes[idScopes.length - 1];
  return scope ? `${scope.prefix}:${kind}:${scope.next++}` : undefined;
}

export function requiredWidgetId(explicit: string | undefined, kind: string): string {
  const id = widgetId(explicit, kind);
  if (!id) {
    throw new Error(`UI.${kind} requires an id, or must be drawn inside UI.idScope()`);
  }
  return id;
}
