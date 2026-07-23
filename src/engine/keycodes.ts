// ---------- Typed key codes ----------
// The well-known KeyboardEvent.code values as a literal union, so
// `Keys.down("ArrowLetf")` fails to compile and completion works — while
// `(string & {})` keeps the set open for exotic keys.

type UppercaseLetter =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** Well-known `KeyboardEvent.code` values as a union (open via `string & {}`) for `Keys`. */
export type KeyCode =
  | `Key${UppercaseLetter}`
  | `Digit${Digit}`
  | `Numpad${Digit}`
  | `F${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Space"
  | "Enter"
  | "Escape"
  | "Tab"
  | "Backspace"
  | "Delete"
  | "Insert"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | "CapsLock"
  | "ShiftLeft"
  | "ShiftRight"
  | "ControlLeft"
  | "ControlRight"
  | "AltLeft"
  | "AltRight"
  | "MetaLeft"
  | "MetaRight"
  | "ContextMenu"
  | "Minus"
  | "Equal"
  | "BracketLeft"
  | "BracketRight"
  | "Backslash"
  | "Semicolon"
  | "Quote"
  | "Comma"
  | "Period"
  | "Slash"
  | "Backquote"
  | "IntlBackslash"
  | "NumpadAdd"
  | "NumpadSubtract"
  | "NumpadMultiply"
  | "NumpadDivide"
  | "NumpadDecimal"
  | "NumpadEnter"
  | (string & {});
