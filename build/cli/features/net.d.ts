export interface NetDoctorOptions {
    latency: number;
    jitter: number;
    loss: number;
    rate: number;
    seconds: number;
    seed: number;
}
export interface NetDoctorReport {
    sent: number;
    delivered: number;
    lost: number;
    lossPercent: number;
    arrivalGapP50: number;
    arrivalGapP95: number;
    arrivalGapP99: number;
    recommendedBufferMs: number;
}
/** Deterministic snapshot-network model used by `mm net doctor`. */
export declare function diagnoseNetwork(options: NetDoctorOptions): NetDoctorReport;
declare const _default: {
    readonly name: "net";
    readonly summary: "Diagnose latency, jitter, loss, and snapshot rates.";
    readonly usage: readonly ["mm net doctor [options]"];
    readonly run: (input: string[]) => void;
};
export default _default;
