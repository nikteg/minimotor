import { Transport, WsConfig } from "./types.js";

// ---------- WebSocket ----------

export function connect(config: WsConfig): Transport {
  const binaryType: BinaryType = config.binaryType ?? "arraybuffer";
  const reconnectMs = config.reconnectMs ?? 0;
  const heartbeatMs = config.heartbeatMs ?? 0;
  const heartbeatPayload = config.heartbeatPayload ?? new Uint8Array(0);
  const idleTimeoutMs = config.idleTimeoutMs ?? 0;

  let ws: WebSocket | null = null;
  let state: Transport["state"] = "connecting";
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let lastRecv = 0;
  let intentionalClose = false;

  function stopTimers() {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    if (idleTimer !== null) clearInterval(idleTimer);
    heartbeatTimer = null;
    idleTimer = null;
  }

  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onState: null,

    get state() {
      return state;
    },

    send(data: Uint8Array) {
      if (state !== "connected") throw new Error("WebSocket not connected");
      ws!.send(data);
    },

    trySend(data: Uint8Array) {
      if (state !== "connected") return false;
      try {
        ws!.send(data);
        return true;
      } catch {
        return false;
      }
    },

    sendJson(obj: unknown) {
      if (state !== "connected") throw new Error("WebSocket not connected");
      ws!.send(JSON.stringify(obj));
    },

    close() {
      intentionalClose = true;
      setState("closed");
      stopTimers();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    },
  };

  // Update `state` and notify onState only on a real transition.
  const setState = (next: Transport["state"]): void => {
    if (state === next) return;
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
            ws!.send(heartbeatPayload);
          } catch {
            /* racing a close — the onclose path cleans up */
          }
        }, heartbeatMs);
      }
      if (idleTimeoutMs > 0) {
        // Closing a half-open link routes into the normal onclose path, so
        // reconnectMs (if set) kicks in.
        idleTimer = setInterval(
          () => {
            if (Date.now() - lastRecv > idleTimeoutMs) ws!.close();
          },
          Math.max(250, idleTimeoutMs / 2),
        );
      }
    };

    ws.onmessage = (e: MessageEvent) => {
      lastRecv = Date.now();
      const handler = transport.onMessage;
      if (!handler) return;
      if (e.data instanceof ArrayBuffer) {
        handler(new Uint8Array(e.data));
      } else if (e.data instanceof Blob) {
        e.data.arrayBuffer().then((buf) => {
          handler(new Uint8Array(buf));
        });
      } else if (typeof e.data === "string") {
        // Text frames (e.g. from sendJson) arrive as strings — deliver the bytes.
        handler(new TextEncoder().encode(e.data));
      }
    };

    ws.onclose = () => {
      setState("closed");
      stopTimers();
      if (!intentionalClose && reconnectMs > 0) {
        reconnectTimer = setTimeout(doConnect, reconnectMs);
      } else if (transport.onClose) {
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
