import { type Server } from "node:http";
export interface StandaloneLevelTesterOptions {
    ratingsPath: string;
    host?: string;
    port?: number;
    /** Override for tests; production resolves to the installed package's build directory. */
    moduleRoot?: string;
}
export interface StandaloneLevelTester {
    server: Server;
    url: string;
    close(): Promise<void>;
}
/** Start the dependency-free HTTP/WebSocket level tester shipped with the CLI. */
export declare function startStandaloneLevelTester(options: StandaloneLevelTesterOptions): Promise<StandaloneLevelTester>;
