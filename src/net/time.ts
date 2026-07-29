import type { Room } from "./room.js";

const TIME_KEY = "__mm_time";

type TimeMessage =
  | { [TIME_KEY]: 1; kind: "ping"; nonce: number; sentAt: number }
  | { [TIME_KEY]: 1; kind: "pong"; to: string; nonce: number; sentAt: number; hostAt: number };

export interface NetworkTimeOptions {
  intervalMs?: number;
  now?: () => number;
}

export interface NetworkTime {
  /** Host-synchronized monotonic time in ms. */
  readonly now: number;
  readonly offsetMs: number;
  readonly rttMs: number;
  readonly ready: boolean;
  stop(): void;
}

/** Synchronize a lightweight monotonic clock to the current room host using
 * periodic ping/pong samples. Host migration is picked up automatically. */
export function networkTime(room: Room<unknown>, options: NetworkTimeOptions = {}): NetworkTime {
  const localNow = options.now ?? (() => performance.now());
  let offset = 0;
  let rtt = 0;
  let ready = room.hosting;
  let nonce = 0;
  const pending = new Map<number, number>();
  const isTime = (value: unknown): value is TimeMessage =>
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[TIME_KEY] === 1;

  const off = room.onMessage((from, value) => {
    if (!isTime(value)) return;
    if (value.kind === "ping" && room.hosting) {
      (room as Room<TimeMessage>).send({
        [TIME_KEY]: 1,
        kind: "pong",
        to: from,
        nonce: value.nonce,
        sentAt: value.sentAt,
        hostAt: localNow(),
      });
    } else if (
      value.kind === "pong" &&
      value.to === room.id &&
      from === room.hostId &&
      pending.has(value.nonce)
    ) {
      const receivedAt = localNow();
      const roundTrip = receivedAt - pending.get(value.nonce)!;
      pending.delete(value.nonce);
      const sample = value.hostAt + roundTrip / 2 - receivedAt;
      offset = ready ? offset + (sample - offset) * 0.2 : sample;
      rtt = ready ? rtt + (roundTrip - rtt) * 0.2 : roundTrip;
      ready = true;
    }
  });

  const ping = () => {
    if (room.closed || room.hosting || !room.hostId) return;
    const sentAt = localNow();
    const id = ++nonce;
    pending.set(id, sentAt);
    (room as Room<TimeMessage>).send({ [TIME_KEY]: 1, kind: "ping", nonce: id, sentAt });
  };
  ping();
  const timer = setInterval(ping, options.intervalMs ?? 1000);

  return {
    get now() {
      if (room.hosting) return localNow();
      return localNow() + offset;
    },
    get offsetMs() {
      return room.hosting ? 0 : offset;
    },
    get rttMs() {
      return room.hosting ? 0 : rtt;
    },
    get ready() {
      return room.hosting || ready;
    },
    stop() {
      clearInterval(timer);
      off();
      pending.clear();
    },
  };
}
