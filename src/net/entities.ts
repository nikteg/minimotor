import { everyMs } from "./rate.js";
import type { SyncCodec } from "./body-codec.js";
import { createRoster } from "./roster.js";
import type { Room } from "./room.js";

const ENTITIES_KEY = "__mm_entities";
const composite = (owner: string, id: string): string => `${owner}\0${id}`;

interface EntityEnvelope<S> {
  [ENTITIES_KEY]: 1;
  entities: Array<{ id: string; state: S }>;
  /** The sender's clock when the batch was sampled — see `Interpolator.push`. */
  t?: number;
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
  /** Pack the batch into a binary lane instead of JSON — see `SyncOptions`. */
  codec?: SyncCodec<Array<{ id: string; state: S }>>;
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

  const clock = options.now ?? (() => performance.now());
  const codec = options.codec;

  /** One peer's advertised set: update what it still owns, despawn the rest. */
  const applyBatch = (
    owner: string,
    entities: Array<{ id: string; state: S }>,
    sentAt: number | undefined,
  ): void => {
    const next = new Set<string>();
    const at = clock();
    for (const entity of entities) {
      next.add(entity.id);
      roster.update(composite(owner, entity.id), entity.state, at, sentAt);
    }
    for (const old of ownerIds.get(owner) ?? []) {
      if (!next.has(old)) roster.remove(composite(owner, old));
    }
    ownerIds.set(owner, next);
  };

  const offMessage = codec
    ? room.onBytes(codec.tag, (owner, bytes) => {
        const packet = codec.decode(bytes);
        if (packet) applyBatch(owner, packet.state, packet.sentAt);
      })
    : room.onMessage((owner, message) => {
        if (isMessage(message)) applyBatch(owner, message.entities, message.t);
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
    const sentAt = clock();
    if (codec) room.sendBytes(codec.tag, codec.encode(entities, sentAt), { reliable: false });
    else {
      (room as Room<EntityEnvelope<S>>).send(
        { [ENTITIES_KEY]: 1, entities, t: sentAt },
        { reliable: false },
      );
    }
  };

  const offTick = everyMs(intervalMs, broadcast);

  let stopped = false;
  function stop(): void {
    if (stopped) return;
    stopped = true;
    offTick();
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
 * proxies. Call `update` from the game loop, or use game-bound `Net.bindEntities`
 * to have it scheduled automatically. */
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
  return {
    entities: bound,
    update,
    stop() {
      for (const target of bound.values()) options.destroy?.(target);
      bound.clear();
    },
  };
}
