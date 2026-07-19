import { describe, it, expect, beforeEach, vi } from "vitest";
import { connect, createPeer } from "./net.js";

class MockWS {
  url: string;
  binaryType: BinaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: (string | ArrayBuffer)[] = [];
  constructor(url: string) { this.url = url; }
  _open() { this.readyState = 1; this.onopen?.(); }
  _close() { this.readyState = 3; this.onclose?.(); }
  _msg(data: ArrayBuffer) { this.onmessage?.(new MessageEvent("message", { data })); }
  send(d: string | ArrayBuffer) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
}

class MockDC {
  binaryType: BinaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  readyState: "connecting" | "open" | "closing" | "closed" = "connecting";
  sent: (string | ArrayBuffer)[] = [];
  label: string;
  constructor(label: string) { this.label = label; }
  _open() { this.readyState = "open"; this.onopen?.(); }
  send(d: string | ArrayBuffer) { this.sent.push(d); }
  close() { this.readyState = "closed"; this.onclose?.(); }
}

class MockPC {
  iceServers: RTCIceServer[];
  iceGatheringState: RTCGatheringState = "new";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null = null;
  ondatachannel: ((e: RTCDataChannelEvent) => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  dc: MockDC | null = null;
  constructor(c?: RTCConfiguration) { this.iceServers = c?.iceServers ?? []; }
  createDataChannel(label: string) {
    this.dc = new MockDC(label);
    return this.dc as unknown as RTCDataChannel;
  }
  createOffer() { return Promise.resolve({ type: "offer", sdp: "offer" } as RTCSessionDescriptionInit); }
  createAnswer() { return Promise.resolve({ type: "answer", sdp: "answer" } as RTCSessionDescriptionInit); }
  setLocalDescription(d?: RTCLocalSessionDescriptionInit) { this.localDescription = d as RTCSessionDescription; return Promise.resolve(); }
  setRemoteDescription() { return Promise.resolve(); }
  addIceCandidate() { return Promise.resolve(); }
  close() { this.connectionState = "closed"; }
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockWS);
  vi.stubGlobal("RTCPeerConnection", MockPC);
  vi.stubGlobal("RTCSessionDescription", class { type: string; sdp: string; constructor(i: { type: string; sdp: string }) { this.type = i.type; this.sdp = i.sdp; } });
  vi.stubGlobal("RTCIceCandidate", class { candidate: string; constructor(i: { candidate: string }) { this.candidate = i.candidate; } });
});

describe("Net", () => {
  describe("WebSocket", () => {
    it("starts connecting", () => expect(connect({ url: "ws://x" }).state).toBe("connecting"));
    it("throw on send before connect", () => expect(() => connect({ url: "ws://x" }).send(new Uint8Array([1]))).toThrow("not connected"));
    it("throw on sendJson before connect", () => expect(() => connect({ url: "ws://x" }).sendJson({})).toThrow("not connected"));
    it("close sets state", () => { const w = connect({ url: "ws://x" }); w.close(); expect(w.state).toBe("closed"); });
  });

  describe("WebRTC", () => {
    it("starts connecting", () => expect(createPeer().transport.state).toBe("connecting"));
    it("throw send before connect", () => expect(() => createPeer().transport.send(new Uint8Array([1]))).toThrow("not connected"));
    it("throw sendJson before connect", () => expect(() => createPeer().transport.sendJson({})).toThrow("not connected"));
    it("get/set onSignal", () => {
      const p = createPeer();
      const fn = vi.fn(); p.onSignal = fn;
      expect(p.onSignal).toBe(fn);
    });
    it("transport.close sets state", () => {
      const p = createPeer(); p.transport.close();
      expect(p.transport.state).toBe("closed");
    });
  });
});
