/** One state. All hooks are optional; a bare `{}` is a valid holding state.
 *  `update` returns the next state's name to transition, or a falsy value to
 *  stay. Hooks capture game variables via closure — there is no ctx param. */
export interface State<K extends string = string> {
    /** Runs once when the machine enters this state. */
    enter?(): void;
    /** Runs each `machine.update()`; return a state name to transition. */
    update?(): K | null | undefined | void;
    /** Runs once when the machine leaves this state. */
    exit?(): void;
}
/** Options for `create`. */
export interface FsmOptions<K extends string = string> {
    /** Called after every transition with the previous and new state names. */
    onChange?: (from: K, to: K) => void;
}
/** A running finite state machine. */
export interface Machine<K extends string = string> {
    /** The active state name. */
    readonly current: K;
    /** Is `name` the active state? */
    is(name: K): boolean;
    /** Force a transition (exit old → enter new). No-op (returns false) if
     *  already in `name` or `name` is unknown. */
    go(name: K): boolean;
    /** Run the active state's `update` once per step; a returned state name
     *  transitions. */
    update(): void;
}
/** Create a state machine over a typed map, starting in `initial` (its
 *  `enter` fires immediately). Transition names are checked at compile time
 *  — `"rnu"` won't build. */
export declare function create<K extends string>(states: Record<K, State<K>>, initial: K, opts?: FsmOptions<K>): Machine<K>;
