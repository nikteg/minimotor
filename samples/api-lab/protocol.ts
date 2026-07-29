import type { Protocol } from "minimotor";

/** The one contract a peer-hosted or dedicated server can share with clients. */
export type GameProtocol = Protocol<{
  events: {
    bump: { target: string; vx: number; vy: number };
    death: { x: number; y: number };
    respawn: Record<string, never>;
  };
}>;
