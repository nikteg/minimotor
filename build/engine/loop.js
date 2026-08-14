/** Create loop controls permanently bound to one app. */
export function createLoop(app) {
    return {
        run(callbacks) {
            app.run(callbacks);
        },
        pause() {
            app.pause();
        },
        resume() {
            app.resume();
        },
        stop() {
            app.stop();
        },
        onStep(handler) {
            return app.onStep(handler);
        },
        onStepStart(handler) {
            return app.onStepStart(handler);
        },
        onFrame(handler) {
            return app.onFrame(handler);
        },
        get step() {
            return app.step;
        },
        get steps() {
            return app.steps;
        },
        get frameDelta() {
            return app.frameDelta;
        },
        get maxFps() {
            return app.maxFps;
        },
        set maxFps(next) {
            app.maxFps = next;
        },
        get interpolation() {
            return app.interpolation;
        },
        get paused() {
            return app.paused;
        },
        get timings() {
            return app.timings;
        },
    };
}
