import type { Room } from "./room.js";
import { createNetMeter, type NetMeter } from "@src/perf/net-meter.js";

const encoder = new TextEncoder();

/** Last-resort size estimate for rooms that cannot report wire bytes (test
 *  doubles, `simulateNetwork`). A real room hands us `traffic` instead — see
 *  `RoomTraffic` — because re-serializing every message to weigh it costs more
 *  than the send itself at 60 Hz. */
const bytes = (value: unknown): number => {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
};

export interface RoomStats {
  sentMessages: number;
  receivedMessages: number;
  sentBytes: number;
  receivedBytes: number;
  lastReceivedAt: number;
}

export type MonitoredRoom<M> = Room<M> & {
  readonly stats: Readonly<RoomStats>;
  /** Pass directly to `createPerformanceMonitoring(app, { net: room.meter })`. */
  readonly meter: NetMeter;
};

/** Wrap a room with cumulative message/byte diagnostics. Pass the returned
 * room to other Net utilities so all of their traffic is counted. */
export function monitorRoom<M>(room: Room<M>, now: () => number = Date.now): MonitoredRoom<M> {
  const stats: RoomStats = {
    sentMessages: 0,
    receivedMessages: 0,
    sentBytes: 0,
    receivedBytes: 0,
    lastReceivedAt: 0,
  };
  const meter = createNetMeter();
  const handlers = new Set<(from: string, message: M) => void>();
  // The room already knows what went over the wire — including the host's relay
  // forwards, which never pass through a message handler at all.
  const wire = room.traffic;
  let seenSent = 0;
  let seenReceived = 0;
  const drainWire = (): void => {
    if (!wire) return;
    if (wire.sentBytes > seenSent) {
      meter.sent(wire.sentBytes - seenSent);
      seenSent = wire.sentBytes;
    }
    if (wire.receivedBytes > seenReceived) {
      meter.recv(wire.receivedBytes - seenReceived);
      seenReceived = wire.receivedBytes;
    }
    stats.sentBytes = wire.sentBytes;
    stats.receivedBytes = wire.receivedBytes;
  };
  const offMessages = room.onMessage((from, message) => {
    stats.receivedMessages++;
    if (wire) drainWire();
    else {
      const size = bytes(message);
      stats.receivedBytes += size;
      meter.recv(size);
    }
    stats.lastReceivedAt = now();
    for (const handler of handlers) handler(from, message);
  });
  return {
    get id() {
      return room.id;
    },
    get peers() {
      return room.peers;
    },
    get peerCount() {
      return room.peerCount;
    },
    get hostId() {
      return room.hostId;
    },
    get hosting() {
      return room.hosting;
    },
    get local() {
      return room.local;
    },
    get closed() {
      return room.closed;
    },
    get status() {
      return room.status;
    },
    get stats() {
      return stats;
    },
    get meter() {
      return meter;
    },
    onStatus: (fn) => room.onStatus(fn),
    traffic: room.traffic,
    send(message, sendOpts) {
      stats.sentMessages++;
      room.send(message, sendOpts);
      if (wire) drainWire();
      else {
        const size = bytes(message);
        stats.sentBytes += size;
        meter.sent(size);
      }
    },
    onMessage(fn) {
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
    sendBytes(tag, data, sendOpts) {
      stats.sentMessages++;
      room.sendBytes(tag, data, sendOpts);
      if (wire) drainWire();
      else {
        stats.sentBytes += data.length;
        meter.sent(data.length);
      }
    },
    onBytes(tag, fn) {
      return room.onBytes(tag, (from, data) => {
        stats.receivedMessages++;
        if (wire) drainWire();
        else {
          stats.receivedBytes += data.length;
          meter.recv(data.length);
        }
        stats.lastReceivedAt = now();
        fn(from, data);
      });
    },
    onJoin: (fn) => room.onJoin(fn),
    onLeave: (fn) => room.onLeave(fn),
    close() {
      offMessages();
      handlers.clear();
      room.close();
    },
  };
}

export interface NetworkSimulationOptions {
  latencyMs?: number;
  jitterMs?: number;
  loss?: number;
  random?: () => number;
}

/** Wrap a Room with artificial latency, jitter, and packet loss. Intended for
 * development; production code should pass the original room. */
export function simulateNetwork<M>(room: Room<M>, options: NetworkSimulationOptions = {}): Room<M> {
  const random = options.random ?? Math.random;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const handlers = new Set<(from: string, message: M) => void>();
  const schedule = (fn: () => void) => {
    if (random() < (options.loss ?? 0)) return;
    const jitter = (random() * 2 - 1) * (options.jitterMs ?? 0);
    const delay = Math.max(0, (options.latencyMs ?? 0) + jitter);
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, delay);
    timers.add(timer);
  };
  const offMessages = room.onMessage((from, message) =>
    schedule(() => {
      for (const handler of handlers) handler(from, message);
    }),
  );
  return {
    get id() {
      return room.id;
    },
    get peers() {
      return room.peers;
    },
    get peerCount() {
      return room.peerCount;
    },
    get hostId() {
      return room.hostId;
    },
    get hosting() {
      return room.hosting;
    },
    get local() {
      return room.local;
    },
    get closed() {
      return room.closed;
    },
    get status() {
      return room.status;
    },
    onStatus: (fn) => room.onStatus(fn),
    send(message, sendOpts) {
      schedule(() => room.send(message, sendOpts));
    },
    onMessage(fn) {
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
    sendBytes(tag, data, sendOpts) {
      schedule(() => room.sendBytes(tag, data, sendOpts));
    },
    onBytes(tag, fn) {
      return room.onBytes(tag, (from, data) => {
        // The lane is unreliable by nature, so copy before deferring: the view
        // belongs to the receive buffer only for this call.
        const copy = data.slice();
        schedule(() => fn(from, copy));
      });
    },
    onJoin: (fn) => room.onJoin(fn),
    onLeave: (fn) => room.onLeave(fn),
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      offMessages();
      handlers.clear();
      room.close();
    },
  };
}
