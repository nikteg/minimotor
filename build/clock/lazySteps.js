export function lazySteps(read, quantum = 1, limit = Number.POSITIVE_INFINITY) {
    if (!Number.isFinite(quantum) || quantum <= 0) {
        throw new RangeError("lazySteps: quantum must be a positive finite number");
    }
    let cursor = read();
    return {
        take() {
            const elapsed = Math.floor((read() - cursor) / quantum);
            if (elapsed <= 0)
                return 0;
            cursor += elapsed * quantum;
            return Math.min(elapsed, limit);
        },
        reset() {
            cursor = read();
        },
    };
}
