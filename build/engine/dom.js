/** True when keyboard/touch selection belongs to a native editing surface. */
export function isEditableTarget(target) {
    const element = target;
    return (!!element &&
        (element.tagName === "INPUT" ||
            element.tagName === "TEXTAREA" ||
            element.tagName === "SELECT" ||
            element.isContentEditable));
}
