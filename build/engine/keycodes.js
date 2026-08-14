// ---------- Typed key codes ----------
// The well-known KeyboardEvent.code values as a literal union, so
// `Keys.down("ArrowLetf")` fails to compile and completion works — while
// `(string & {})` keeps the set open for exotic keys.
export {};
