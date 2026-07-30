import type { Protocol } from "minimotor";
import type { LevelId } from "./api-lab.generated.js";

/** The one contract a peer-hosted or dedicated server can share with clients. */
export type GameProtocol = Protocol<{
  events: {
    death: { x: number; y: number; area: LevelId };
    respawn: Record<string, never>;
  };
}>;
