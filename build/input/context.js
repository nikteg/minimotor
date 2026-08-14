export function createInputContext(initial = "gameplay") {
    let active = initial;
    return {
        get active() {
            return active;
        },
        set(name) {
            active = name;
        },
        is(name) {
            return active === name;
        },
        within(name, run) {
            const previous = active;
            active = name;
            try {
                return run();
            }
            finally {
                active = previous;
            }
        },
    };
}
