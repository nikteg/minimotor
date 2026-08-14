import { Transport, WsConfig } from "./types.js";
import type { ClientMessageOf, MessageCodec, ProtocolShape, ServerMessageOf } from "./protocol.js";
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
/** `connect`'s configuration plus the one thing only a typed protocol can have:
 *  a codec for its own message union. */
export interface ProtocolConfig<P extends ProtocolShape> extends WsConfig {
    /** Encode outbound and decode inbound frames instead of using JSON.
     *
     * The mirror of `RoomOptions.codec`: this end encodes `ClientMessageOf<P>`
     * and decodes `ServerMessageOf<P>`. Absent is the default and the default is
     * JSON.
     *
     * NOTE the frame this end never sees as a message: `heartbeatPayload`
     * defaults to a 0-byte binary frame and the server may echo one, so `decode`
     * has to answer `undefined` for it — which is the same requirement the JSON
     * path met with a `try/catch`. */
    codec?: MessageCodec<ClientMessageOf<P>, ServerMessageOf<P>>;
}
/** Connect a typed protocol, JSON unless `config.codec` says otherwise. Frames
 *  this end cannot read are ignored. */
export declare function connectProtocol<P extends ProtocolShape>(config: ProtocolConfig<P>): ProtocolTransport<P>;
