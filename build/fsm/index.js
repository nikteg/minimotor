// ---------- Finite state machines ----------
// A general finite state machine: named states with enter / update / exit,
// where a state's `update` returns the name to switch to (falsy = stay) and
// `go(name)` forces a transition (exit → enter). Plain data, no inheritance.
//
// The altitude ladder: Scenes = game modes, Fsm = per-entity behavior
// (idle/run/jump/fall/wallslide, enemy AI, door lifecycles), anim states =
// visuals DRIVEN by the Fsm — the entire bridge is one line:
//
//   const state = Fsm.create({
//     idle: { update: () => (run !== 0 ? "run" : undefined) },
//     run:  { update: () => (!grounded ? "fall" : run === 0 ? "idle" : undefined) },
//     jump: { enter() { vel.y = JUMP; }, update: () => (vel.y > 0 ? "fall" : undefined) },
//     fall: { update: () => (grounded ? "idle" : undefined) },
//   }, "idle");
//   state.update();            // one call per step; a returned name transitions
//   anim.set(state.current);   // the visuals follow — no bridge machinery
//
// Break-even honesty: below ~4 states with no transition RULES, a ternary in
// update() is less code. The machine earns its keep when rules appear
// ("wall-jump only from wallslide", "dash can't re-dash").
/** Create a state machine over a typed map, starting in `initial` (its
 *  `enter` fires immediately). Transition names are checked at compile time
 *  — `"rnu"` won't build. */
export function create(states, initial, opts = {}) {
    if (!states[initial])
        throw new Error(`Fsm.create: unknown initial state "${initial}"`);
    let current = initial;
    const enter = (name) => {
        current = name;
        states[name].enter?.();
    };
    const transition = (to) => {
        if (to === current || !states[to])
            return false;
        const from = current;
        states[from].exit?.();
        enter(to);
        opts.onChange?.(from, to);
        return true;
    };
    enter(initial); // fire the initial state's enter on construction
    return {
        get current() {
            return current;
        },
        is(name) {
            return current === name;
        },
        go(name) {
            return transition(name);
        },
        update() {
            const next = states[current].update?.();
            if (next)
                transition(next);
        },
    };
}
