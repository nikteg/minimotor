export interface PresentPlayer<M = unknown> {
  id: string;
  joined: boolean;
  metadata: M;
}

export interface PresenceApi {
  readonly players: readonly PresentPlayer[];
  set<M>(id: string, metadata: M): void;
  remove(id: string): void;
  get<M>(id: string): PresentPlayer<M> | undefined;
  clear(): void;
}

export function createPresence(): PresenceApi {
  const players = new Map<string, PresentPlayer>();
  return {
    get players() {
      return [...players.values()];
    },
    set(id, metadata) {
      players.set(id, { id, joined: true, metadata });
    },
    remove(id) {
      players.delete(id);
    },
    get<M>(id: string) {
      return players.get(id) as PresentPlayer<M> | undefined;
    },
    clear() {
      players.clear();
    },
  };
}
