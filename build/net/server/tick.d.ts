/** Run `fn(dtMs)` at a fixed rate (`hz` times per second) — the authoritative
 *  server's simulate-and-broadcast loop. `dtMs` is the real elapsed time since
 *  the previous tick (never assume it's exactly `1000 / hz`). Returns a stop
 *  function.
 *
 *    const stop = serverTick(20, (dt) => {
 *      stepWorld(dt);
 *      room.broadcast(snapshot());
 *    });
 *    // later: stop(); */
export declare function serverTick(hz: number, fn: (dtMs: number) => void): () => void;
