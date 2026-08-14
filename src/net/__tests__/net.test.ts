import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  connect,
  connectProtocol,
  createPeer,
  createInterpolator,
  type MessageCodec,
  type Protocol,
  type Signal,
} from "@src/net/index.js";

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

class MockWS {
  static instances: MockWS[] = [];
  url: string;
  binaryType: BinaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: (string | ArrayBuffer | Uint8Array)[] = [];
  constructor(url: string) {
    this.url = url;
    MockWS.instances.push(this);
  }
  _open() {
    this.readyState = 1;
    this.onopen?.();
  }
  _close() {
    this.readyState = 3;
    this.onclose?.();
  }
  _msg(data: ArrayBufferLike) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
  send(d: string | ArrayBuffer | Uint8Array) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

class MockDC {
  binaryType: BinaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  readyState: "connecting" | "open" | "closing" | "closed" = "connecting";
  sent: (string | ArrayBuffer)[] = [];
  label: string;
  constructor(label: string) {
    this.label = label;
  }
  _open() {
    this.readyState = "open";
    this.onopen?.();
  }
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
}

class MockPC {
  static instances: MockPC[] = [];
  iceServers: RTCIceServer[];
  iceGatheringState: RTCGatheringState = "new";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null = null;
  ondatachannel: ((e: RTCDataChannelEvent) => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  /** The unreliable channel — the first one `createPeer` opens. */
  dc: MockDC | null = null;
  channels = new Map<string, MockDC>();
  constructor(c?: RTCConfiguration) {
    this.iceServers = c?.iceServers ?? [];
    MockPC.instances.push(this);
  }
  createDataChannel(label: string) {
    const channel = new MockDC(label);
    this.channels.set(label, channel);
    this.dc ??= channel;
    return channel as unknown as RTCDataChannel;
  }
  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "offer" } as RTCSessionDescriptionInit);
  }
  createAnswer() {
    return Promise.resolve({ type: "answer", sdp: "answer" } as RTCSessionDescriptionInit);
  }
  setLocalDescription(d?: RTCLocalSessionDescriptionInit) {
    this.localDescription = d as RTCSessionDescription;
    return Promise.resolve();
  }
  setRemoteDescription() {
    return Promise.resolve();
  }
  addIceCandidate() {
    return Promise.resolve();
  }
  close() {
    this.connectionState = "closed";
  }
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  _gatherComplete() {
    this.iceGatheringState = "complete";
    for (const fn of this.listeners.get("icegatheringstatechange") ?? []) fn();
  }
}

/** A protocol whose one message packs into three bytes, for the codec tests
 *  below. `decode` refuses everything else — a heartbeat, another lane's frame,
 *  and text — which is the contract `ProtocolConfig.codec` documents. */
type Packed = Protocol<{
  client: { type: "move"; x: number };
  server: { type: "move"; x: number };
}>;
const PACKED_TAG = 0x5b;
const packedCodec: MessageCodec<{ type: "move"; x: number }, { type: "move"; x: number }> = {
  encode: (message) => new Uint8Array([PACKED_TAG, message.x & 0xff, message.x >>> 8]),
  decode: (frame) =>
    typeof frame === "string" || frame.length !== 3 || frame[0] !== PACKED_TAG
      ? undefined
      : { type: "move", x: frame[1] | (frame[2] << 8) },
};

beforeEach(() => {
  MockWS.instances = [];
  MockPC.instances = [];
  vi.stubGlobal("WebSocket", MockWS);
  vi.stubGlobal("RTCPeerConnection", MockPC);
  vi.stubGlobal(
    "RTCSessionDescription",
    class {
      type: string;
      sdp: string;
      constructor(i: { type: string; sdp: string }) {
        this.type = i.type;
        this.sdp = i.sdp;
      }
    },
  );
  vi.stubGlobal(
    "RTCIceCandidate",
    class {
      candidate: string;
      constructor(i: { candidate: string }) {
        this.candidate = i.candidate;
      }
    },
  );
});

describe("Net", () => {
  describe("WebSocket", () => {
    it("starts connecting", () => expect(connect({ url: "ws://x" }).state).toBe("connecting"));
    it("throw on send before connect", () =>
      expect(() => connect({ url: "ws://x" }).send(new Uint8Array([1]))).toThrow("not connected"));
    it("throw on sendJson before connect", () =>
      expect(() => connect({ url: "ws://x" }).sendJson({})).toThrow("not connected"));
    it("close sets state", () => {
      const w = connect({ url: "ws://x" });
      w.close();
      expect(w.state).toBe("closed");
    });
    it("delivers a binary message to onMessage", () => {
      const w = connect({ url: "ws://x" });
      const ws = MockWS.instances[0];
      ws._open();
      let got: Uint8Array | null = null;
      w.onMessage = (d) => (got = d);
      ws._msg(new Uint8Array([7, 8, 9]).buffer);
      expect(Array.from(got!)).toEqual([7, 8, 9]);
    });
    it("delivers a string frame (sendJson path) to onMessage as bytes", () => {
      const w = connect({ url: "ws://x" });
      const ws = MockWS.instances[0];
      ws._open();
      let got = "";
      w.onMessage = (d) => (got = new TextDecoder().decode(d));
      ws.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ hi: 1 }) }));
      expect(JSON.parse(got)).toEqual({ hi: 1 });
    });
    it("sends and receives a shared JSON protocol", () => {
      type App = Protocol<{
        client: { type: "move"; x: number };
        server: { type: "world"; x: number };
      }>;
      const game = connectProtocol<App>({ url: "ws://x" });
      const ws = MockWS.instances[0];
      ws._open();
      game.send({ type: "move", x: 2 });
      expect(JSON.parse(ws.sent[0] as string)).toEqual({ type: "move", x: 2 });
      const received = vi.fn();
      game.onMessage = received;
      ws.onmessage?.(new MessageEvent("message", { data: '{"type":"world","x":3}' }));
      expect(received).toHaveBeenCalledWith({ type: "world", x: 3 });
    });

    // ---------- ProtocolConfig.codec ----------
    it("sends and receives a shared protocol through a codec", () => {
      const game = connectProtocol<Packed>({ url: "ws://x", codec: packedCodec });
      const ws = MockWS.instances[0];
      ws._open();
      game.send({ type: "move", x: 2 });
      game.trySend({ type: "move", x: 5 });
      // Nothing on this wire is text — which is the whole request.
      expect(ws.sent.every((frame) => frame instanceof Uint8Array)).toBe(true);
      expect(ws.sent.map((frame) => packedCodec.decode(frame as Uint8Array))).toEqual([
        { type: "move", x: 2 },
        { type: "move", x: 5 },
      ]);
      const received = vi.fn();
      game.onMessage = received;
      ws._msg((packedCodec.encode({ type: "move", x: 3 }) as Uint8Array).buffer);
      expect(received).toHaveBeenCalledWith({ type: "move", x: 3 });
    });

    it("ignores the frames a codec refuses, heartbeat included", () => {
      const game = connectProtocol<Packed>({ url: "ws://x", codec: packedCodec });
      const ws = MockWS.instances[0];
      ws._open();
      const received = vi.fn();
      game.onMessage = received;
      ws._msg(new Uint8Array(0).buffer); // `heartbeatPayload`'s default
      ws._msg(new Uint8Array([9, 9, 9]).buffer); // another lane
      ws.onmessage?.(new MessageEvent("message", { data: '{"type":"move","x":1}' }));
      expect(received).not.toHaveBeenCalled();
    });

    it("stays on JSON text frames when no codec is given", () => {
      const game = connectProtocol<Packed>({ url: "ws://x" });
      const ws = MockWS.instances[0];
      ws._open();
      game.send({ type: "move", x: 2 });
      expect(ws.sent[0]).toBe('{"type":"move","x":2}');
    });
  });

  describe("WebRTC", () => {
    it("starts connecting", () => expect(createPeer().transport.state).toBe("connecting"));
    it("throw send before connect", () =>
      expect(() => createPeer().transport.send(new Uint8Array([1]))).toThrow("not connected"));
    it("throw sendJson before connect", () =>
      expect(() => createPeer().transport.sendJson({})).toThrow("not connected"));
    it("get/set onSignal", () => {
      const p = createPeer();
      const fn = vi.fn();
      p.onSignal = fn;
      expect(p.onSignal).toBe(fn);
    });
    it("transport.close sets state", () => {
      const p = createPeer();
      p.transport.close();
      expect(p.transport.state).toBe("closed");
    });
    it("delivers a data-channel string frame (sendJson path) to onMessage", () => {
      const p = createPeer();
      p.connect();
      const dc = MockPC.instances[0].dc!;
      dc._open();
      let got = "";
      p.transport.onMessage = (d) => (got = new TextDecoder().decode(d));
      dc.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ move: [3, 4] }) }));
      expect(JSON.parse(got)).toEqual({ move: [3, 4] });
    });

    it("emits the trickle offer as soon as the local description is set", async () => {
      const p = createPeer();
      const signals: Signal[] = [];
      p.onSignal = (s) => signals.push(s);
      p.connect();
      await flushMicrotasks();
      expect(signals.some((s) => s.type === "offer")).toBe(true);
    });

    it("waits for ICE gathering before emitting a non-trickle offer", async () => {
      const p = createPeer({ trickle: false });
      const signals: Signal[] = [];
      p.onSignal = (s) => signals.push(s);
      p.connect();
      await flushMicrotasks();
      expect(signals.some((s) => s.type === "offer")).toBe(false); // still gathering
      MockPC.instances[0]._gatherComplete();
      expect(signals.some((s) => s.type === "offer")).toBe(true);
    });

    it("answers an incoming offer (trickle)", async () => {
      const p = createPeer();
      const signals: Signal[] = [];
      p.onSignal = (s) => signals.push(s);
      p.applySignal({ type: "offer", sdp: JSON.stringify({ type: "offer", sdp: "x" }) });
      await flushMicrotasks();
      expect(signals.some((s) => s.type === "answer")).toBe(true);
    });
  });

  describe("heartbeat & idle timeout", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends keep-alive frames on the configured interval", () => {
      vi.useFakeTimers();
      connect({ url: "ws://x", heartbeatMs: 1000 });
      const ws = MockWS.instances[0];
      ws._open();
      vi.advanceTimersByTime(3100);
      expect(ws.sent).toHaveLength(3);
    });

    it("closes a silent connection after idleTimeoutMs, then reconnects", () => {
      vi.useFakeTimers();
      const w = connect({ url: "ws://x", idleTimeoutMs: 1000, reconnectMs: 500 });
      const ws = MockWS.instances[0];
      ws._open();
      vi.advanceTimersByTime(1600); // idle checker declares the link dead at 1500
      expect(ws.readyState).toBe(3);
      vi.advanceTimersByTime(600); // reconnect delay elapses
      expect(MockWS.instances).toHaveLength(2);
      expect(w.state).toBe("connecting");
    });

    it("received traffic keeps an idle connection alive", () => {
      vi.useFakeTimers();
      connect({ url: "ws://x", idleTimeoutMs: 1000 });
      const ws = MockWS.instances[0];
      ws._open();
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(800); // always under the timeout between messages
        ws._msg(new Uint8Array([1]).buffer);
      }
      expect(ws.readyState).toBe(1); // still open after 4s of "activity"
    });

    it("stops the timers on intentional close", () => {
      vi.useFakeTimers();
      const w = connect({ url: "ws://x", heartbeatMs: 1000, idleTimeoutMs: 1000 });
      const ws = MockWS.instances[0];
      ws._open();
      w.close();
      vi.advanceTimersByTime(5000);
      expect(ws.sent).toHaveLength(0); // no zombie heartbeats
      expect(MockWS.instances).toHaveLength(1); // no reconnect churn
    });
  });

  describe("trySend", () => {
    it("returns false when disconnected instead of throwing", () => {
      const w = connect({ url: "ws://x" });
      expect(w.trySend(new Uint8Array([1]))).toBe(false);
      MockWS.instances[0]._open();
      expect(w.trySend(new Uint8Array([1]))).toBe(true);
      expect(MockWS.instances[0].sent).toHaveLength(1);
    });

    it("works on the data channel too", () => {
      const p = createPeer();
      expect(p.transport.trySend(new Uint8Array([1]))).toBe(false);
      p.connect();
      MockPC.instances[0].dc!._open();
      expect(p.transport.trySend(new Uint8Array([1]))).toBe(true);
    });
  });
});

describe("createInterpolator (snapshot interpolation)", () => {
  it("returns null before any snapshot", () => {
    const ip = createInterpolator<{ x: number }>({ now: () => 0 });
    expect(ip.sample()).toBeNull();
  });

  it("lerps numeric fields between the surrounding snapshots", () => {
    let t = 0;
    const ip = createInterpolator<{ x: number; y: number }>({ delayMs: 100, now: () => t });
    ip.push({ x: 0, y: 0 }, 0);
    ip.push({ x: 10, y: 20 }, 100);
    t = 150; // render target = 50ms → halfway between the snapshots
    expect(ip.sample()).toEqual({ x: 5, y: 10 });
  });

  it("copies non-numeric fields from the newer snapshot", () => {
    const ip = createInterpolator<{ x: number; anim: string }>({ delayMs: 100, now: () => 150 });
    ip.push({ x: 0, anim: "idle" }, 0);
    ip.push({ x: 10, anim: "run" }, 100);
    expect(ip.sample()).toEqual({ x: 5, anim: "run" });
  });

  it("holds the newest state when the buffer runs dry (no extrapolation)", () => {
    const ip = createInterpolator<{ x: number }>({ delayMs: 100, now: () => 9999 });
    ip.push({ x: 0 }, 0);
    ip.push({ x: 10 }, 100);
    expect(ip.sample()).toEqual({ x: 10 });
  });

  it("holds the oldest state before the buffer starts", () => {
    const ip = createInterpolator<{ x: number }>({ delayMs: 100, now: () => 100 });
    ip.push({ x: 5 }, 50); // target = 0, before the first snapshot
    expect(ip.sample()).toEqual({ x: 5 });
  });

  it("drops out-of-order snapshots from unreliable channels", () => {
    const ip = createInterpolator<{ x: number }>({ now: () => 0 });
    ip.push({ x: 1 }, 100);
    ip.push({ x: 2 }, 50); // late packet — stale, ignored
    expect(ip.size).toBe(1);
  });

  it("adapts from one packet interval when arrivals become jittery", () => {
    const ip = createInterpolator<{ x: number }>({
      delayMs: "auto",
      expectedIntervalMs: 50,
      now: () => 0,
    });
    ip.push({ x: 1 }, 0);
    ip.push({ x: 2 }, 50);
    expect(ip.delayMs).toBe(50);
    ip.push({ x: 3 }, 150);
    expect(ip.delayMs).toBe(65);
    ip.clear();
    expect(ip.delayMs).toBe(50);
  });

  it("supports a custom lerp (e.g. angle wrap-around)", () => {
    const ip = createInterpolator<number>({
      delayMs: 0,
      now: () => 50,
      lerp: (a, b, t) => (t < 0.5 ? a : b), // nearest instead of blend
    });
    ip.push(0, 0);
    ip.push(100, 100);
    expect(ip.sample()).toBe(100);
  });

  it("keeps the render buffer and uses extrapolation only to cover gaps", () => {
    const ip = createInterpolator<{ x: number }>({
      delayMs: "auto",
      expectedIntervalMs: 100,
      maxExtrapolationMs: 50,
      extrapolate: (a, b, t) => ({ x: a.x + (b.x - a.x) * t }),
      now: () => 125,
    });
    ip.push({ x: 0 }, 0);
    ip.push({ x: 10 }, 100);
    // Projection does NOT cost the buffer: the target still sits one packet
    // interval back, where two real snapshots surround it.
    expect(ip.delayMs).toBe(100);
    expect(ip.sample()).toEqual({ x: 2.5 });
    // Only once the next snapshot fails to show up does projection take over,
    // still capped to maxExtrapolationMs past the newest pair.
    expect(ip.sample(1000)).toEqual({ x: 15 });
  });

  it("bounds projection when snapshots arrive bunched together", () => {
    const wild = createInterpolator<{ x: number }>({
      delayMs: 0,
      expectedIntervalMs: 16,
      maxExtrapolationMs: 50,
      extrapolate: (a, b, t) => ({ x: a.x + (b.x - a.x) * t }),
      now: () => 0,
    });
    // Two snapshots 16ms of motion apart that landed 1ms apart: without a span
    // floor this projects ~20x the real motion.
    wild.push({ x: 0 }, 100);
    wild.push({ x: 3 }, 101);
    expect(wild.sample(140)!.x).toBeLessThanOrEqual(3 + 3 * 1.5);
  });

  it("places snapshots by sender time, not arrival, when stamps are given", () => {
    const ip = createInterpolator<{ x: number }>({ delayMs: 0, now: () => 0 });
    // Sent 100ms apart, delivered 1ms apart by a hiccup in the link. The
    // second packet is the faster one, so it sets the clock mapping:
    // local 501 == sender 1100.
    ip.push({ x: 0 }, 500, 1000);
    ip.push({ x: 10 }, 501, 1100);
    // The blend still takes 100ms of local time to traverse — arrival bunching
    // does not compress the motion.
    expect(ip.sample(451)).toEqual({ x: 5 });
    expect(ip.sample(401)).toEqual({ x: 0 });
  });

  it("drops duplicate and reordered snapshots by their sender stamp", () => {
    const ip = createInterpolator<{ x: number }>({ now: () => 0 });
    ip.push({ x: 1 }, 10, 1000);
    ip.push({ x: 2 }, 11, 900); // reordered straggler
    ip.push({ x: 3 }, 12, 1000); // duplicate
    expect(ip.size).toBe(1);
  });

  it("renders bunched, jittery arrivals as smooth motion", () => {
    // The sender's fixed-step accumulator emits 0 snapshots one frame and 2 the
    // next, and the link adds +-3ms — the everyday case that used to make
    // remote players jitter and rubber-band.
    const ip = createInterpolator<{ x: number }>({
      delayMs: "auto",
      expectedIntervalMs: 1000 / 60,
      maxExtrapolationMs: 50,
      lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t }),
      extrapolate: (a, b, t) => ({ x: a.x + (b.x - a.x) * t }),
      now: () => 0,
    });
    const step = 1000 / 60;
    const packets: Array<{ at: number; sentAt: number; x: number }> = [];
    let x = 0;
    let sentAt = 0;
    const wobble = [0.7, -2.1, 1.4, 2.8, -1.2, 0.3, -2.6, 1.9]; // deterministic
    for (let frame = 0; frame < 240; frame++) {
      const steps = frame % 7 === 0 ? 0 : frame % 7 === 1 ? 2 : 1;
      for (let s = 0; s < steps; s++) {
        x += 3; // 3 px per simulation step
        sentAt += step;
        packets.push({ at: frame * step + wobble[(frame + s) % wobble.length], sentAt, x });
      }
    }
    packets.sort((a, b) => a.at - b.at);

    let next = 0;
    let previous: number | null = null;
    let maxJump = 0;
    let backwards = 0;
    for (let ms = 0; ms < 240 * step; ms += step) {
      while (next < packets.length && packets[next].at <= ms) {
        ip.push({ x: packets[next].x }, packets[next].at, packets[next].sentAt);
        next++;
      }
      const rendered = ip.sample(ms);
      if (rendered && previous !== null) {
        maxJump = Math.max(maxJump, Math.abs(rendered.x - previous));
        if (rendered.x < previous - 0.01) backwards++;
      }
      if (rendered) previous = rendered.x;
    }
    // True motion is 3px per frame; anything much past that is the projection
    // dividing by an arrival gap instead of a simulation interval.
    expect(maxJump).toBeLessThan(6);
    expect(backwards).toBe(0);
  });

  it("evicts the oldest snapshots past maxSnapshots", () => {
    const ip = createInterpolator<{ x: number }>({ maxSnapshots: 2, now: () => 0 });
    ip.push({ x: 1 }, 1);
    ip.push({ x: 2 }, 2);
    ip.push({ x: 3 }, 3);
    expect(ip.size).toBe(2);
  });
});
