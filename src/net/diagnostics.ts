import type { Room } from "./room.js";
import { createNetMeter, type NetMeter } from "../perf/net-meter.js";

const bytes = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
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
  /** Drop directly into `Perf.plugin({ net: room.meter })`. */
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
  const offMessages = room.onMessage((from, message) => {
    const size = bytes(message);
    stats.receivedMessages++;
    stats.receivedBytes += size;
    meter.recv(size);
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
    send(message) {
      const size = bytes(message);
      stats.sentMessages++;
      stats.sentBytes += size;
      meter.sent(size);
      room.send(message);
    },
    onMessage(fn) {
      handlers.add(fn);
      return () => handlers.delete(fn);
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
    send(message) {
      schedule(() => room.send(message));
    },
    onMessage(fn) {
      handlers.add(fn);
      return () => handlers.delete(fn);
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
