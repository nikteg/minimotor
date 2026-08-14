// ---------- Net.game: the room, assembled ----------
// The pieces below this file — room, networkTime, events, sharedItems,
// monitorRoom, memberIndex — are each worth having on their own, but a game
// that just wants "everyone together" should not have to assemble six of them
// and know which clock to hand to which. `Net.game` is that assembly:
//
//   const net = await Net.game({ room: "api-lab" });
//   const players = net.share(player);
//   for (const other of players) drawHero(other);
//
// Replication is a separate call because a game may share nothing, one thing,
// or several — the room is the connection, `share` is what you put on it.
//
// Offline is not a special case: with no relay reachable you get the same
// object back with `online === false`, one player, and every call still valid.
import { syncBody } from "./body-state.js";
import { events } from "./events.js";
import { join, localRoom, sync } from "./room.js";
import { socketRoom } from "./socket-room.js";
import { monitorRoom } from "./diagnostics.js";
import { networkTime } from "./time.js";
import { sharedItems } from "./shared-items.js";
/** Translate the friendly shape into what `RTCPeerConnection` wants. */
function iceServers(ice) {
    if (ice === undefined)
        return undefined;
    const list = Array.isArray(ice) ? ice : [ice];
    return list.map((server) => typeof server === "string"
        ? { urls: server }
        : { urls: server.url, username: server.username, credential: server.password });
}
/** A distinct, readable color per player slot, spaced by the golden angle so
 *  neighbouring slots never look alike. */
export function playerColor(index) {
    return `hsl(${(index * 137.508 + 320) % 360} 90% 65%)`;
}
/** Whether a state carries the position/velocity pair the packed body codec
 *  and its blending are built for. */
function looksLikeBody(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const body = value;
    if (typeof body.x !== "number" || typeof body.y !== "number")
        return false;
    return typeof body.vx === "number" || (typeof body.vel === "object" && body.vel !== null);
}
function defaultUrl() {
    if (typeof location === "undefined") {
        throw new Error("createNet: no page origin to infer a relay URL from — pass `url`");
    }
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws-signal`;
}
/** Join a multiplayer game: one room, with events, shared items and a shared
 *  clock already wired to it. Call `share` for anything you want replicated.
 *  Falls back to a solo game when no relay answers, so there is only ever one
 *  code path. */
export async function game(options = {}) {
    const name = options.room ?? "game";
    const timeoutMs = options.timeoutMs ?? 1500;
    // The ONLY line that knows which topology this is. Everything below — and
    // everything the caller does with the result — is identical either way.
    const raw = await (options.server
        ? socketRoom(options.server, { room: name, timeoutMs, fallback: "local" })
        : join(options.url ?? defaultUrl(), {
            room: name,
            timeoutMs,
            iceServers: iceServers(options.ice),
            fallback: "local",
        })).catch(() => localRoom());
    const room = monitorRoom(raw);
    const time = networkTime(room);
    const channel = events(room);
    const shares = new Set();
    // Slots are the sorted member ids, rebuilt only when membership changes:
    // every player derives the same order without another protocol message.
    let slots = [];
    let slotsFor = null;
    const indexOf = (id) => {
        if (room.peers !== slotsFor) {
            slotsFor = room.peers;
            slots = [room.id, ...room.peers].sort();
        }
        return slots.indexOf(id);
    };
    function share(state, shareOptions = {}) {
        const read = (typeof state === "function" ? state : () => state);
        const { hz = 60, packed = looksLikeBody(read()), ...blend } = shareOptions;
        // `blend` is delayMs/lerp/extrapolate/maxExtrapolationMs, and BOTH paths
        // take them: `syncBody` only defaults the ones it is not given, so a body
        // keeps its packed codec and its rotation-aware blend unless this overrides
        // them explicitly.
        const peers = (packed
            ? // `T` is only known to be an object here, so the blend callbacks
                // cannot be proven to take a `BodyState`. The overloads above are
                // what make that true at every call site; this is the one cast that
                // erasure costs.
                syncBody(room, read, {
                    ...blend,
                    hz,
                })
            : sync(room, { ...blend, hz, state: read }));
        const withSlot = (value) => Object.assign(value, { index: indexOf(value.id) });
        const handle = {
            get size() {
                return peers.size;
            },
            latest(id) {
                const value = peers.latest(id);
                return value ? withSlot(value) : null;
            },
            snap(id) {
                peers.reset(id);
            },
            stop() {
                peers.stop();
                shares.delete(handle);
            },
            *[Symbol.iterator]() {
                for (const value of peers)
                    yield withSlot(value);
            },
        };
        shares.add(handle);
        return handle;
    }
    return {
        get id() {
            return room.id;
        },
        get index() {
            return indexOf(room.id);
        },
        get count() {
            return room.peerCount + 1;
        },
        get online() {
            return !room.local;
        },
        get hosting() {
            return room.hosting;
        },
        get rttMs() {
            return time.rttMs;
        },
        get now() {
            return time.now;
        },
        get status() {
            return room.status;
        },
        get meter() {
            return room.meter;
        },
        room,
        events: channel,
        share: share,
        indexOf,
        items(source, itemOptions = {}) {
            return sharedItems(room, source, { now: () => time.now, ...itemOptions });
        },
        close() {
            // Snapshot the set: each stop() removes itself from it.
            for (const handle of Array.from(shares))
                handle.stop();
            channel.stop();
            time.stop();
            room.close();
        },
    };
}
