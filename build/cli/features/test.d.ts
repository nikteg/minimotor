declare const _default: {
    readonly name: "test";
    readonly summary: "Run headless Playwright game and screenshot tests.";
    readonly usage: readonly ["mm test [playwright options]"];
    readonly run: (args: string[]) => Promise<void>;
};
export default _default;
