import { WebSocketServer } from "ws";
export interface TesterConfig {
    ladders: boolean;
    gems: boolean;
    dash: boolean;
    doubleJump: boolean;
    wallJump: boolean;
}
export declare function createLevelTesterServer(ratingsPath: string): WebSocketServer;
