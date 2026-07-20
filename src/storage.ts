// ---------- Safe localStorage wrapper ----------
// Never throws — if storage is unavailable (private browsing, quota
// exceeded) or the stored value is corrupt, it silently returns the
// fallback / does nothing.

/** Load any JSON-serializable value (numbers, strings, settings objects,
 *  unlock flags…). The fallback also fixes the return type. Values written by
 *  the old numbers-only version parse fine (JSON.parse("42") === 42). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* silently ignore */
  }
}
