let depth = 0;
export function isMeasuring(): boolean {
  return depth > 0;
}
export function beginMeasure(): void {
  depth++;
}
export function endMeasure(): void {
  if (depth > 0) depth--;
}
