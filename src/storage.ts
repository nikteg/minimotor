// ---------- Safe localStorage wrapper ----------
// Never throws — if storage is unavailable (private browsing, quota
// exceeded) it silently returns the fallback / does nothing.

export function load(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const val = parseInt(raw, 10);
    return isNaN(val) ? fallback : val;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* silently ignore */
  }
}
