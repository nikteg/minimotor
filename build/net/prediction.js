/** Client-side prediction core: number inputs, simulate immediately, then
 * restore authoritative state and replay unacknowledged inputs on correction. */
export function createPrediction(options) {
    let sequence = 0;
    let corrections = 0;
    const pending = [];
    return {
        get sequence() {
            return sequence;
        },
        get pending() {
            return pending.length;
        },
        get corrections() {
            return corrections;
        },
        step(input, dtMs) {
            const frame = { sequence: ++sequence, input, dtMs };
            pending.push(frame);
            options.simulate(input, dtMs);
            return frame;
        },
        reconcile(state, acknowledgedSequence) {
            corrections++;
            options.restore(state);
            while (pending.length && pending[0].sequence <= acknowledgedSequence)
                pending.shift();
            for (const frame of pending)
                options.simulate(frame.input, frame.dtMs);
        },
        clear() {
            pending.length = 0;
        },
    };
}
export function createInputBuffer() {
    const queues = new Map();
    const acknowledged = new Map();
    return {
        push(clientId, frame) {
            if (frame.sequence <= (acknowledged.get(clientId) ?? 0))
                return false;
            let queue = queues.get(clientId);
            if (!queue)
                queues.set(clientId, (queue = []));
            if (queue.some((item) => item.sequence === frame.sequence))
                return false;
            queue.push(frame);
            queue.sort((a, b) => a.sequence - b.sequence);
            return true;
        },
        drain(clientId) {
            const queue = queues.get(clientId) ?? [];
            const ready = [];
            let next = (acknowledged.get(clientId) ?? 0) + 1;
            while (queue[0]?.sequence === next) {
                ready.push(queue.shift());
                next++;
            }
            if (queue.length === 0)
                queues.delete(clientId);
            if (ready.length)
                acknowledged.set(clientId, ready[ready.length - 1].sequence);
            return ready;
        },
        acknowledged(clientId) {
            return acknowledged.get(clientId) ?? 0;
        },
        remove(clientId) {
            queues.delete(clientId);
            acknowledged.delete(clientId);
        },
    };
}
