import { everyMs } from "./rate.js";
const HOST_STATE_KEY = "__mm_host_state";
/** Synchronize shared world state from the current room host. The relay does
 * not know the state schema; a promoted host continues from its local copy. */
export function hostState(room, options) {
    let latest = options.state();
    const isHostState = (message) => typeof message === "object" &&
        message !== null &&
        message[HOST_STATE_KEY] === 1;
    const offMessage = room.onMessage((from, message) => {
        if (from === room.hostId && isHostState(message))
            latest = message.state;
    });
    const broadcast = () => {
        if (!room.hosting || room.closed || room.peerCount === 0)
            return;
        latest = options.state();
        room.send({ [HOST_STATE_KEY]: 1, state: latest });
    };
    const offJoin = room.onJoin(broadcast);
    const offTick = everyMs(1000 / (options.hz ?? 10), broadcast);
    return {
        get value() {
            if (room.hosting)
                latest = options.state();
            return latest;
        },
        stop() {
            offTick();
            offMessage();
            offJoin();
        },
    };
}
