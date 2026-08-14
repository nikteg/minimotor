import type { App } from "../engine/app.js";
import * as NetModule from "./module.js";
import type { GameOptions, NetGame, ProtocolShape } from "./module.js";
import { type NetworkSimulationApi, type NetworkSimulationOptions } from "./network-simulation.js";
import { type ReplicationApi } from "./replication.js";
import { type PresenceApi } from "./presence.js";
import { type RollbackApi } from "./rollback.js";
import { type InterestManagementApi } from "./interest-management.js";
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
export declare function createNet(app: App): NetApi;
