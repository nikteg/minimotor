// ---------- Fsm ----------
// A general finite state machine: named states with enter / update / exit,
// where a state's `update` returns the name to switch to (falsy = stay) and
// `go(name)` forces a transition (exit → enter). Plain data, no inheritance.
// Scenes is the app-level stack; Fsm is the per-entity machine — player logic
// (idle/run/jump/fall/hurt), enemy AI, door/pickup lifecycles.
//
//   const sm = Minimotor.Fsm.create(
//     {
//       idle: { update: () => (moving ? "run" : grounded ? null : "fall") },
//       run:  { update: () => (!grounded ? "fall" : moving ? null : "idle") },
//       jump: { enter: () => (vy = -JUMP), update: () => (vy >= 0 ? "fall" : null) },
//       fall: { update: () => (grounded ? "idle" : null) },
//     },
//     "idle",
//   );
//   sm.update(Loop.step);   // runs the active state; a returned name transitions
//   sm.state; sm.is("jump"); sm.go("hurt");
//
// Pairs with Anim.states: pass `{ anim }` and every transition also plays the
// clip of the same name (the common 1:1 logical-state → animation-state case),
// so you never hand-mirror `anim.play(sm.state)`.

/** One state. All hooks are optional; a bare `{}` is a valid holding state.
 *  `update` returns the next state's name to transition, or a falsy value to
 *  stay. Hooks capture game variables via closure — there is no ctx param. */
export interface State {
  /** Runs once when the machine enters this state. */
  enter?(): void;
  /** Runs each `machine.update(dtMs)`; return a state name to transition. */
  update?(dtMs: number): string | null | undefined | void;
  /** Runs once when the machine leaves this state. */
  exit?(): void;
}

/** An animation-state player (the shape of `Anim.states`) the machine can
 *  drive on every transition. */
export interface AnimBridge {
  play(state: string, options?: { restart?: boolean }): boolean;
}

/** Options for `create`. */
export interface FsmOptions {
  /** Drive this animation player: each transition (and the initial state)
   *  calls `anim.play(newState)`. Names that aren't clips are ignored by the
   *  player, so partial coverage is fine. */
  anim?: AnimBridge;
  /** Called after every transition with the previous and new state names. */
  onChange?: (from: string, to: string) => void;
}

/** A running finite state machine. */
export interface Machine<K extends string = string> {
  /** The active state name. */
  readonly state: K;
  /** Is `name` the active state? */
  is(name: K): boolean;
  /** Force a transition (exit old → enter new). No-op (returns false) if
   *  already in `name` or `name` is unknown. */
  go(name: K): boolean;
  /** Run the active state's `update`; if it returns a state name, transition
   *  to it. `dtMs` defaults to 0 for logic-only machines. */
  update(dtMs?: number): void;
}

/** Create a state machine over `states`, starting in `initial` (its `enter`
 *  fires immediately, and the anim bridge plays its clip). */
export function create<K extends string>(
  states: Record<K, State>,
  initial: K,
  opts: FsmOptions = {},
): Machine<K> {
  if (!states[initial]) throw new Error(`Fsm.create: unknown initial state "${initial}"`);
  let current = initial;

  const enter = (name: K) => {
    current = name;
    states[name].enter?.();
    opts.anim?.play(name);
  };

  const transition = (to: K): boolean => {
    if (to === current || !states[to]) return false;
    const from = current;
    states[from].exit?.();
    enter(to);
    opts.onChange?.(from, to);
    return true;
  };

  enter(initial); // fire the initial state's enter + anim on construction

  return {
    get state() {
      return current;
    },
    is(name) {
      return current === name;
    },
    go(name) {
      return transition(name);
    },
    update(dtMs = 0) {
      const next = states[current].update?.(dtMs);
      if (next) transition(next as K);
    },
  };
}
