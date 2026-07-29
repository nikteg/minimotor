import { Loop, STEP_MS } from "../engine/index.js";
import { createRoster } from "./roster.js";
import type { Room } from "./room.js";

const ENTITIES_KEY = "__mm_entities";
const composite = (owner: string, id: string): string => `${owner}\0${id}`;

interface EntityEnvelope<S> {
  [ENTITIES_KEY]: 1;
  entities: Array<{ id: string; state: S }>;
}

export interface SyncEntitiesOptions<E, S extends object> {
  entities: () => Iterable<E>;
  id: (entity: E) => string;
  state: (entity: E) => S;
  hz?: number;
  delayMs?: number | "auto";
  timeoutMs?: number;
  lerp?: (a: S, b: S, t: number) => S;
  extrapolate?: (a: S, b: S, t: number) => S;
  maxExtrapolationMs?: number;
  now?: () => number;
}

export type RemoteEntity<S extends object> = S & { id: string; owner: string };

export interface EntityStates<S extends object> extends Iterable<RemoteEntity<S>> {
  readonly size: number;
  readonly ids: Array<{ owner: string; id: string }>;
  stop(): void;
}

/** Synchronize a dynamic collection. Each peer owns its advertised entities;
 * missing ids despawn automatically and states interpolate independently. */
export function syncEntities<E, S extends object>(
  room: Room<unknown>,
  options: SyncEntitiesOptions<E, S>,
): EntityStates<S> {
  const intervalMs = 1000 / (options.hz ?? 30);
  const roster = createRoster<S>({
    delayMs: options.delayMs ?? "auto",
    expectedIntervalMs: intervalMs,
    timeoutMs: options.timeoutMs,
    lerp: options.lerp,
    extrapolate: options.extrapolate,
    maxExtrapolationMs: options.maxExtrapolationMs,
    now: options.now,
  });
  const ownerIds = new Map<string, Set<string>>();
  const parseKey = (key: string) => {
    const split = key.indexOf("\0");
    return { owner: key.slice(0, split), id: key.slice(split + 1) };
  };
  const isMessage = (value: unknown): value is EntityEnvelope<S> =>
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[ENTITIES_KEY] === 1;

  const offMessage = room.onMessage((owner, message) => {
    if (!isMessage(message)) return;
    const next = new Set<string>();
    for (const entity of message.entities) {
      next.add(entity.id);
      roster.update(composite(owner, entity.id), entity.state);
    }
    for (const old of ownerIds.get(owner) ?? []) {
      if (!next.has(old)) roster.remove(composite(owner, old));
    }
    ownerIds.set(owner, next);
  });
  const offLeave = room.onLeave((owner) => {
    for (const id of ownerIds.get(owner) ?? []) roster.remove(composite(owner, id));
    ownerIds.delete(owner);
  });

  const broadcast = () => {
    if (room.closed) return stop();
    if (room.peerCount === 0) return;
    const entities = [...options.entities()].map((entity) => ({
      id: options.id(entity),
      state: options.state(entity),
    }));
    (room as Room<EntityEnvelope<S>>).send({ [ENTITIES_KEY]: 1, entities });
  };

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

  let stopped = false;
  function stop(): void {
    if (stopped) return;
    stopped = true;
    offStep?.();
    if (interval !== null) clearInterval(interval);
    offMessage();
    offLeave();
    roster.clear();
    ownerIds.clear();
  }

  return {
    get size() {
      return roster.size;
    },
    get ids() {
      return roster.ids.map(parseKey);
    },
    stop,
    *[Symbol.iterator]() {
      roster.prune();
      for (const [key, state] of roster.sample()) yield { ...state, ...parseKey(key) };
    },
  };
}

export interface BindEntitiesOptions<S extends object, T> {
  create(state: RemoteEntity<S>): T;
  apply(target: T, state: RemoteEntity<S>): void;
  destroy?(target: T): void;
}

export interface EntityBinding<T> {
  readonly entities: ReadonlyMap<string, T>;
  update(): void;
  stop(): void;
}

/** Bind synchronized states to live render objects or kinematic physics
 * proxies. Automatically updates once per fixed step when an App is running. */
export function bindEntities<S extends object, T>(
  states: EntityStates<S>,
  options: BindEntitiesOptions<S, T>,
): EntityBinding<T> {
  const bound = new Map<string, T>();
  const update = () => {
    const live = new Set<string>();
    for (const state of states) {
      const key = composite(state.owner, state.id);
      live.add(key);
      let target = bound.get(key);
      if (!target) {
        target = options.create(state);
        bound.set(key, target);
      }
      options.apply(target, state);
    }
    for (const [key, target] of bound) {
      if (live.has(key)) continue;
      options.destroy?.(target);
      bound.delete(key);
    }
  };
  let offStep: (() => void) | null = null;
  try {
    offStep = Loop.onStep(update);
  } catch {
    // Headless callers invoke update() themselves.
  }
  return {
    entities: bound,
    update,
    stop() {
      offStep?.();
      for (const target of bound.values()) options.destroy?.(target);
      bound.clear();
    },
  };
}
