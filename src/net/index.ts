// ---------- Networking ----------
// Dependency-free multiplayer, with sessions owned by one app lifecycle (they
// close on destroy). `Net.game({ room, body })` is the one-call path; `Net.join`
// opens a symmetric room, `Net.syncBody`/`syncBodies` handle lightweight or
// Physics2D bodies, `syncEntities` handles dynamic collections, and typed
// events, ownership, network time, prediction, and diagnostics cover the rest.
//
//   const Net = createNet(app);
//   const room = await Net.join("wss://example.com/ws", { room: "demo" });
//   const ghosts = Net.syncBody(room, player);
//   for (const g of ghosts) Draw.rect(g.x, g.y, 16, 16, "#888");

import type { App } from "@src/engine/app.js";
import * as NetModule from "./module.js";
import type { GameOptions, NetGame, ProtocolShape } from "./module.js";
import {
  createNetworkSimulation,
  type NetworkSimulationApi,
  type NetworkSimulationOptions,
} from "./network-simulation.js";
import { createReplication, type ReplicationApi } from "./replication.js";
import { createPresence, type PresenceApi } from "./presence.js";
import { createRollback, type RollbackApi } from "./rollback.js";
import { createInterestManagement, type InterestManagementApi } from "./interest-management.js";

export * from "./module.js";

export type NetApi = Omit<typeof NetModule, "game"> & {
  game<P extends ProtocolShape | unknown = unknown>(options?: GameOptions): Promise<NetGame<P>>;
  simulation(options?: NetworkSimulationOptions): NetworkSimulationApi;
  replicate(): ReplicationApi;
  presence(): PresenceApi;
  rollback(): RollbackApi;
  interest(): InterestManagementApi;
};

/** Networking API with sessions owned by one app lifecycle. */
export function createNet(app: App): NetApi {
  const games = new Set<NetGame>();
  const api: NetApi = {
    CONTROL: NetModule.CONTROL,
    applyBodyState: NetModule.applyBodyState,
    bodiesCodec: NetModule.bodiesCodec,
    bodyCodec: NetModule.bodyCodec,
    bodyState: NetModule.bodyState,
    connect: NetModule.connect,
    connectProtocol: NetModule.connectProtocol,
    controlFrame: NetModule.controlFrame,
    createInputBuffer: NetModule.createInputBuffer,
    createInterpolator: NetModule.createInterpolator,
    createPeer: NetModule.createPeer,
    createPrediction: NetModule.createPrediction,
    createRoster: NetModule.createRoster,
    decodeJson: NetModule.decodeJson,
    encodeJson: NetModule.encodeJson,
    events: NetModule.events,
    extrapolateBodyState: NetModule.extrapolateBodyState,
    frame: NetModule.frame,
    hasAuthority: NetModule.hasAuthority,
    hostSession: NetModule.hostSession,
    hostState: NetModule.hostState,
    join: NetModule.join,
    joinSession: NetModule.joinSession,
    lerpBodyState: NetModule.lerpBodyState,
    localRoom: NetModule.localRoom,
    memberIndex: NetModule.memberIndex,
    monitorRoom: NetModule.monitorRoom,
    networkTime: NetModule.networkTime,
    own: NetModule.own,
    owns: NetModule.owns,
    playerColor: NetModule.playerColor,
    readBodySnapshot: NetModule.readBodySnapshot,
    sharedItems: NetModule.sharedItems,
    simulateNetwork: NetModule.simulateNetwork,
    socketRoom: NetModule.socketRoom,
    sync: NetModule.sync,
    syncBodies: NetModule.syncBodies,
    syncBody: NetModule.syncBody,
    syncEntities: NetModule.syncEntities,
    transfer: NetModule.transfer,
    unframe: NetModule.unframe,
    writeBodySnapshot: NetModule.writeBodySnapshot,
    async game<P = unknown>(options: GameOptions = {}) {
      const net = await NetModule.game<P>(options);
      games.add(net as NetGame);
      return net;
    },
    bindEntities(states, options) {
      const binding = NetModule.bindEntities(states, options);
      const offStep = app.Loop.onStep(binding.update);
      const stop = binding.stop.bind(binding);
      binding.stop = () => {
        offStep();
        stop();
      };
      return binding;
    },
    simulation(options) {
      const simulation = createNetworkSimulation(options);
      app.onDestroy(simulation.destroy);
      return simulation;
    },
    replicate: createReplication,
    presence: createPresence,
    rollback: createRollback,
    interest: createInterestManagement,
  };
  const destroy = () => {
    for (const net of games) net.close();
    games.clear();
  };
  app.onDestroy(destroy);
  return api;
}
