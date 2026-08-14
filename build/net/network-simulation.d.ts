export interface NetworkSimulationOptions {
    latency?: number;
    jitter?: number;
    loss?: number;
    duplicate?: number;
    random?: () => number;
}
export interface NetworkSimulationApi {
    readonly pending: number;
    configure(options: NetworkSimulationOptions): void;
    send<T>(value: T, deliver: (value: T) => void): void;
    clear(): void;
    destroy(): void;
}
export declare function createNetworkSimulation(initial?: NetworkSimulationOptions): NetworkSimulationApi;
