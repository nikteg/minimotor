import { Loop, STEP_MS } from "../engine/index.js";
import type { Room } from "./room.js";

const HOST_STATE_KEY = "__mm_host_state";

interface HostStateEnvelope<T> {
  [HOST_STATE_KEY]: 1;
  state: T;
}

export interface HostStateOptions<T> {
  state: () => T;
  hz?: number;
}

export interface HostState<T> {
  /** Host state locally, or the latest host snapshot for a guest. */
  readonly value: T;
  stop(): void;
}

/** Synchronize shared world state from the current room host. The relay does
 * not know the state schema; a promoted host continues from its local copy. */
export function hostState<T>(room: Room<unknown>, options: HostStateOptions<T>): HostState<T> {
  let latest = options.state();
  const isHostState = (message: unknown): message is HostStateEnvelope<T> =>
    typeof message === "object" &&
    message !== null &&
    (message as Record<string, unknown>)[HOST_STATE_KEY] === 1;
  const offMessage = room.onMessage((from, message) => {
    if (from === room.hostId && isHostState(message)) latest = message.state;
  });

  const broadcast = () => {
    if (!room.hosting || room.closed || room.peerCount === 0) return;
    latest = options.state();
    (room as Room<HostStateEnvelope<T>>).send({ [HOST_STATE_KEY]: 1, state: latest });
  };
  const offJoin = room.onJoin(broadcast);
  const intervalMs = 1000 / (options.hz ?? 10);
  let acc = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let offStep: (() => void) | null = null;
  try {
    offStep = Loop.onStep(() => {
      acc += STEP_MS;
      if (acc >= intervalMs) {
        acc = 0;
        broadcast();
      }
    });
  } catch {
    interval = setInterval(broadcast, intervalMs);
  }

  return {
    get value() {
      if (room.hosting) latest = options.state();
      return latest;
    },
    stop() {
      offStep?.();
      if (interval !== null) clearInterval(interval);
      offMessage();
      offJoin();
    },
  };
}
