import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "@src/engine/index.js";
import {
  FLOATS_PER_QUAD,
  IDENTITY,
  scissorFromRect,
  sortSpritesByZAndTexture,
  toClipSpace,
  transformPoint,
  writeQuad,
  type Affine,
} from "@src/engine/render/math.js";
import type { DrawSprite } from "@src/engine/draw.js";

const origGc = HTMLCanvasElement.prototype.getContext;

function stub2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    canvas,
  } as unknown as CanvasRenderingContext2D;
}

function stubWebGL2(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const tex = {};
  const buf = {};
  const vao = {};
  const prog = {};
  const shader = {};
  return {
    canvas,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    STATIC_DRAW: 35044,
    DYNAMIC_DRAW: 35048,
    FLOAT: 5126,
    UNSIGNED_SHORT: 5123,
    TRIANGLES: 4,
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    NEAREST: 9728,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    COLOR_BUFFER_BIT: 16384,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    UNPACK_FLIP_Y_WEBGL: 37440,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    DEPTH_TEST: 2929,
    CULL_FACE: 2884,
    SCISSOR_TEST: 3089,
    createShader: () => shader,
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader: vi.fn(),
    createProgram: () => prog,
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),
    getUniformLocation: () => ({}),
    uniform1i: vi.fn(),
    createBuffer: () => buf,
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    deleteBuffer: vi.fn(),
    createVertexArray: () => vao,
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    createTexture: () => tex,
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    deleteTexture: vi.fn(),
    activeTexture: vi.fn(),
    pixelStorei: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    scissor: vi.fn(),
    blendFunc: vi.fn(),
    drawElements: vi.fn(),
    getExtension: (name: string) =>
      name === "WEBGL_lose_context" ? { loseContext: vi.fn() } : null,
  } as unknown as WebGL2RenderingContext;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGc;
  vi.unstubAllGlobals();
});

describe("createApp renderer option", () => {
  it("does not create a second canvas on renderer: canvas", () => {
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === "2d") return stub2d(this);
      return origGc.call(this, type);
    };
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const app = createApp(canvas, { renderer: "canvas", fullscreen: false });
    expect(app.renderer).toBe("canvas");
    expect(canvas.previousElementSibling).toBeNull();
    expect(document.body.querySelectorAll("canvas").length).toBe(1);
    app.destroy();
  });

  it("creates a stacked WebGL2 canvas when renderer: webgl is stubbed", () => {
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === "2d") return stub2d(this);
      if (type === "webgl2") return stubWebGL2(this);
      return origGc.call(this, type);
    };
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const app = createApp(canvas, { renderer: "webgl", fullscreen: false });
    expect(app.renderer).toBe("webgl");
    expect(document.body.querySelectorAll("canvas").length).toBe(2);
    const scene = canvas.previousElementSibling as HTMLCanvasElement;
    expect(scene.tagName).toBe("CANVAS");
    expect(scene.style.pointerEvents).toBe("none");
    app.destroy();
    expect(canvas.previousElementSibling).toBeNull();
    expect(document.body.querySelectorAll("canvas").length).toBe(1);
  });

  it("throws when renderer: webgl cannot get a webgl2 context", () => {
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === "2d") return stub2d(this);
      if (type === "webgl2") return null;
      return origGc.call(this, type);
    };
    const canvas = document.createElement("canvas");
    expect(() => createApp(canvas, { renderer: "webgl", fullscreen: false })).toThrow(/WebGL2/);
  });

  it("falls back to canvas on renderer: auto when webgl2 is null", () => {
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === "2d") return stub2d(this);
      if (type === "webgl2") return null;
      return origGc.call(this, type);
    };
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const app = createApp(canvas, { renderer: "auto", fullscreen: false });
    expect(app.renderer).toBe("canvas");
    expect(canvas.previousElementSibling).toBeNull();
    expect(document.body.querySelectorAll("canvas").length).toBe(1);
    app.Loop.run({ update: () => {}, draw: () => {} });
    app.destroy();
  });
});

describe("batcher CPU math", () => {
  it("packs a quad as 4 vertices of x,y,u,v,r,g,b,a in clip space", () => {
    const buf = new Float32Array(FLOATS_PER_QUAD);
    const m: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    writeQuad(buf, 0, m, 0, 0, 100, 50, 0, 0, 1, 1, 1, 0.5, 0, 1, 200, 100);
    // top-left (0,0) → clip (-1, 1)
    expect(buf[0]).toBeCloseTo(-1);
    expect(buf[1]).toBeCloseTo(1);
    expect(buf[2]).toBe(0);
    expect(buf[3]).toBe(0);
    expect(buf[4]).toBe(1);
    expect(buf[5]).toBe(0.5);
    expect(buf[6]).toBe(0);
    expect(buf[7]).toBe(1);
    // top-right (100,0) → clip (0, 1)  because 100/200*2-1 = 0
    expect(buf[8]).toBeCloseTo(0);
    expect(buf[9]).toBeCloseTo(1);
    // bottom-right (100,50) → clip (0, 0)
    expect(buf[16]).toBeCloseTo(0);
    expect(buf[17]).toBeCloseTo(0);
  });

  it("applies a DOMMatrix to a corner", () => {
    const m: Affine = { a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 };
    const p = transformPoint(m, 4, 5, { x: 0, y: 0 });
    expect(p.x).toBe(2 * 4 + 10);
    expect(p.y).toBe(3 * 5 + 20);
  });

  it("converts y-down device pixels to clip y-up", () => {
    expect(toClipSpace(0, 0, 100, 100)).toEqual({ x: -1, y: 1 });
    expect(toClipSpace(100, 100, 100, 100)).toEqual({ x: 1, y: -1 });
    expect(toClipSpace(50, 50, 100, 100).x).toBeCloseTo(0);
    expect(toClipSpace(50, 50, 100, 100).y).toBeCloseTo(0);
  });

  it("sorts lower z first and keeps insertion order at equal z+texture", () => {
    const imgA = { width: 8, height: 8 } as CanvasImageSource & { width: number; height: number };
    const imgB = { width: 8, height: 8 } as CanvasImageSource & { width: number; height: number };
    const list: DrawSprite[] = [
      { x: 0, y: 0, img: imgA, z: 1 },
      { x: 1, y: 0, img: imgA, z: 0 },
      { x: 2, y: 0, img: imgA, z: 0 },
      { x: 3, y: 0, img: imgB, z: 0 },
    ];
    sortSpritesByZAndTexture(list);
    expect(list.map((s) => s.x)).toEqual([1, 2, 3, 0]);
    // same z, imgA before imgB because imgA was seen first; the two imgA keep order
    expect(list[0].img).toBe(imgA);
    expect(list[1].img).toBe(imgA);
    expect(list[2].img).toBe(imgB);
  });

  it("identity affine is a no-op on a point", () => {
    const p = transformPoint(IDENTITY, 7, 9, { x: 0, y: 0 });
    expect(p).toEqual({ x: 7, y: 9 });
  });

  it("converts a user-space clip rect to a y-up GL scissor", () => {
    const m: Affine = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 };
    // rect (0,0,10,5) → device (10,20)-(30,30); canvas 100×80
    // GL y = 80 - 30 = 50, size 20×10
    expect(scissorFromRect(m, 0, 0, 10, 5, 100, 80)).toEqual({
      x: 10,
      y: 50,
      w: 20,
      h: 10,
    });
  });

  it("returns null when the clip misses the canvas", () => {
    expect(scissorFromRect(IDENTITY, 200, 0, 10, 10, 100, 100)).toBeNull();
  });
});
