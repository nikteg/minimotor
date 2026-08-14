// ---------- WebSocket ----------
/** Open a WebSocket `Transport` to `config.url`, connecting immediately.
 *  Optional `config.reconnectMs`, `config.heartbeatMs`, and
 *  `config.idleTimeoutMs` add auto-reconnect and dead-link detection; see
 *  `WsConfig`. Wire `onMessage`/`onState`/`onClose` on the returned transport. */
export function connect(config) {
    const binaryType = config.binaryType ?? "arraybuffer";
    const reconnectMs = config.reconnectMs ?? 0;
    const heartbeatMs = config.heartbeatMs ?? 0;
    const heartbeatPayload = config.heartbeatPayload ?? new Uint8Array(0);
    const idleTimeoutMs = config.idleTimeoutMs ?? 0;
    let ws = null;
    let state = "connecting";
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let idleTimer = null;
    let lastRecv = 0;
    let intentionalClose = false;
    function stopTimers() {
        if (heartbeatTimer !== null)
            clearInterval(heartbeatTimer);
        if (idleTimer !== null)
            clearInterval(idleTimer);
        heartbeatTimer = null;
        idleTimer = null;
    }
    const transport = {
        onMessage: null,
        onClose: null,
        onState: null,
        get state() {
            return state;
        },
        send(data) {
            if (state !== "connected")
                throw new Error("WebSocket not connected");
            ws.send(data);
        },
        trySend(data) {
            if (state !== "connected")
                return false;
            try {
                ws.send(data);
                return true;
            }
            catch {
                return false;
            }
        },
        sendJson(obj) {
            if (state !== "connected")
                throw new Error("WebSocket not connected");
            ws.send(JSON.stringify(obj));
        },
        close() {
            intentionalClose = true;
            setState("closed");
            stopTimers();
            if (reconnectTimer)
                clearTimeout(reconnectTimer);
            if (ws) {
                ws.onclose = null;
                ws.close();
            }
        },
    };
    // Update `state` and notify onState only on a real transition.
    const setState = (next) => {
        if (state === next)
            return;
        state = next;
        transport.onState?.(next);
    };
    function doConnect() {
        setState("connecting");
        ws = new WebSocket(config.url);
        ws.binaryType = binaryType;
        ws.onopen = () => {
            setState("connected");
            lastRecv = Date.now();
            if (heartbeatMs > 0) {
                heartbeatTimer = setInterval(() => {
                    try {
                        ws.send(heartbeatPayload);
                    }
                    catch {
                        /* racing a close — the onclose path cleans up */
                    }
                }, heartbeatMs);
            }
            if (idleTimeoutMs > 0) {
                // Closing a half-open link routes into the normal onclose path, so
                // reconnectMs (if set) kicks in.
                idleTimer = setInterval(() => {
                    if (Date.now() - lastRecv > idleTimeoutMs)
                        ws.close();
                }, Math.max(250, idleTimeoutMs / 2));
            }
        };
        ws.onmessage = (e) => {
            lastRecv = Date.now();
            const handler = transport.onMessage;
            if (!handler)
                return;
            if (e.data instanceof ArrayBuffer) {
                handler(new Uint8Array(e.data));
            }
            else if (e.data instanceof Blob) {
                e.data.arrayBuffer().then((buf) => {
                    handler(new Uint8Array(buf));
                });
            }
            else if (typeof e.data === "string") {
                // Text frames (e.g. from sendJson) arrive as strings — deliver the bytes.
                handler(new TextEncoder().encode(e.data));
            }
        };
        ws.onclose = () => {
            setState("closed");
            stopTimers();
            if (!intentionalClose && reconnectMs > 0) {
                reconnectTimer = setTimeout(doConnect, reconnectMs);
            }
            else if (transport.onClose) {
                transport.onClose();
            }
        };
        ws.onerror = () => {
            // onclose will fire after onerror — no action needed here
        };
    }
    doConnect();
    return transport;
}
/** Connect a typed JSON protocol. Invalid JSON frames are ignored. */
export function connectProtocol(config) {
    const raw = connect(config);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const channel = {
        onMessage: null,
        onClose: null,
        onState: null,
        get state() {
            return raw.state;
        },
        send(message) {
            raw.sendJson(message);
        },
        trySend(message) {
            return raw.trySend(encoder.encode(JSON.stringify(message)));
        },
        close() {
            raw.close();
        },
    };
    raw.onMessage = (bytes) => {
        try {
            channel.onMessage?.(JSON.parse(decoder.decode(bytes)));
        }
        catch {
            // Typed JSON can coexist with binary heartbeats or unrelated frames.
        }
    };
    raw.onClose = () => channel.onClose?.();
    raw.onState = (state) => channel.onState?.(state);
    return channel;
}
