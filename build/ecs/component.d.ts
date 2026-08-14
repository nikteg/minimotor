import { Component } from "./types.js";
/** Define a component type. Call once per component (module scope), then attach
 *  instances to entities. Identity is the object itself; the optional label is
 *  for debug tooling only. */
export declare function component<T>(label?: string): Component<T>;
