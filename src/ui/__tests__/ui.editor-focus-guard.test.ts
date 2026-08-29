// The focus guard that keeps a mobile keyboard open — `guardEditorFocus` in
// `widgets/native-editor.ts`.
//
// **Measured on an iPhone, and none of the obvious causes were it.** Tapping a
// canvas text field opened the keyboard and closed it again on release. Traced
// on the device: the press and the release land on the same point, the visual
// viewport does not move or zoom between them, swallowing the host's `resize`
// changes nothing, and `canvas.focus` — patched to log its caller — never
// fires. What is left is the browser moving focus to the touched element by
// itself once the keyboard has settled, some way AFTER the gesture. The editor
// is still in the document when it happens; it is simply blurred.
//
// So the guard puts the focus back — but only inside a short window after the
// field was opened, and that condition is the whole design. An unconditional
// trap makes the keyboard impossible to dismiss: Done, Escape, Enter and
// tapping another widget would all be undone. These tests are about that line.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mountHiddenEditor } from "@src/ui/widgets/native-editor.js";

/** A stand-in for the hidden `<input>` the widgets park offscreen. */
function editor(): HTMLInputElement {
  const el = document.createElement("input");
  mountHiddenEditor(el, "name");
  return el;
}

/** Focus/blur through the real DOM, so the guard sees the events it listens
 *  for rather than ones this test synthesised by hand. */
function blurToBody(el: HTMLElement): void {
  el.blur();
}

describe("the hidden editor's focus guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts focus back when the browser takes it moments after opening", () => {
    // The bug, in miniature: focus is taken, and something else blurs it
    // before the player has done anything.
    const el = editor();
    el.focus();
    expect(document.activeElement).toBe(el);

    blurToBody(el);
    expect(document.activeElement).not.toBe(el);

    // The rescue is deferred a task: re-focusing inside the browser's own
    // `focusout` is undone by the rest of that focus move.
    vi.advanceTimersByTime(1);
    expect(document.activeElement).toBe(el);
  });

  it("leaves a deliberate blur alone once the window has passed", () => {
    // **The condition that makes this safe.** Tapping Done, or pressing
    // Escape, arrives long after the field opened — and if the guard rescued
    // that too, the keyboard could never be dismissed.
    const el = editor();
    el.focus();

    vi.advanceTimersByTime(600);
    blurToBody(el);
    vi.advanceTimersByTime(1);
    expect(document.activeElement).not.toBe(el);
  });

  it("gives up rather than fighting a browser that keeps blurring", () => {
    // A ceiling on rescues per opening: without one, a browser that insists on
    // moving focus turns this into an endless loop between two handlers.
    const el = editor();
    el.focus();
    for (let attempt = 0; attempt < 5; attempt++) {
      blurToBody(el);
      vi.advanceTimersByTime(1);
    }
    expect(document.activeElement).not.toBe(el);
  });

  it("does not resurrect an editor the kit has torn down", () => {
    // `evictUnseenEditor` removes the element when its widget stops drawing.
    // That is a real teardown, and re-focusing a detached node would both fail
    // and hide the fact that the widget is gone.
    const el = editor();
    el.focus();
    el.remove();
    blurToBody(el);
    vi.advanceTimersByTime(1);
    expect(document.activeElement).not.toBe(el);
  });

  it("ignores elements that are not the kit's own editors", () => {
    // The listeners are on the document, so they see every focus change on the
    // page. A host's own `<input>` outside the canvas must be left completely
    // alone.
    const outsider = document.createElement("input");
    document.body.appendChild(outsider);
    outsider.focus();
    blurToBody(outsider);
    vi.advanceTimersByTime(1);
    expect(document.activeElement).not.toBe(outsider);
  });
});
