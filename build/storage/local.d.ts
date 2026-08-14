/** Load any JSON-serializable value (numbers, strings, settings objects,
 *  unlock flags…). The fallback also fixes the return type. Values written by
 *  the old numbers-only version parse fine (JSON.parse("42") === 42). */
export declare function load<T>(key: string, fallback: T): T;
/** Store any JSON-serializable `value` under `key`. Never throws — if storage
 *  is unavailable or the quota is exceeded, it silently does nothing. */
export declare function save(key: string, value: unknown): void;
