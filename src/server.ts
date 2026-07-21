// Entry point for `minimotor/server`: Node-side multiplayer server primitives.
// Separate from the browser bundle (`minimotor`) so game clients never pull in
// server code. Pair with the browser-side Net.* transports/interpolation.
export * from "./net/server/index.js";
