import { Transport, WsConfig } from "./types.js";
import type { ClientMessageOf, ProtocolShape, ServerMessageOf } from "./protocol.js";
/** Open a WebSocket `Transport` to `config.url`, connecting immediately.
 *  Optional `config.reconnectMs`, `config.heartbeatMs`, and
 *  `config.idleTimeoutMs` add auto-reconnect and dead-link detection; see
 *  `WsConfig`. Wire `onMessage`/`onState`/`onClose` on the returned transport. */
export declare function connect(config: WsConfig): Transport;
/** A JSON connection typed from the same `Protocol` used by the server. */
export interface ProtocolTransport<P extends ProtocolShape> {
    send(message: ClientMessageOf<P>): void;
    trySend(message: ClientMessageOf<P>): boolean;
    onMessage: ((message: ServerMessageOf<P>) => void) | null;
    onClose: (() => void) | null;
    onState: Transport["onState"];
    readonly state: Transport["state"];
    close(): void;
}
/** Connect a typed JSON protocol. Invalid JSON frames are ignored. */
export declare function connectProtocol<P extends ProtocolShape>(config: WsConfig): ProtocolTransport<P>;
