let depth = 0;
export function isMeasuring() {
    return depth > 0;
}
export function beginMeasure() {
    depth++;
}
export function endMeasure() {
    if (depth > 0)
        depth--;
}
