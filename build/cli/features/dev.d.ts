declare const _default: {
    readonly name: "dev";
    readonly summary: "Start a LAN-ready Vite game and optional relay.";
    readonly usage: readonly ["mm dev [directory] [--relay <command>]"];
    readonly run: (input: string[]) => Promise<void>;
};
export default _default;
