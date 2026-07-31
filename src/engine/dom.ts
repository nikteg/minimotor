/** True when keyboard/touch selection belongs to a native editing surface. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    !!element &&
    (element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.tagName === "SELECT" ||
      element.isContentEditable)
  );
}
