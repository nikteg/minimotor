// ---------- WebGL2 sprite batcher ----------
// One program, one dynamic vertex buffer, a static index buffer, NEAREST
// sampling. Quads are transformed on the CPU (camera matrix × sprite corners)
// into clip space so the shader is a passthrough. Flush on texture change,
// blend change, or a full buffer (~16k quads).
//
// The scene canvas is stacked UNDER the app's overlay, same pattern as
// `attachSceneLayer` in `src/render3d/layer.ts`: copy computed position,
// `pointerEvents: none`, raise the overlay's z-index rather than sinking the
// scene (a negative z-index hides behind the page background).

import type { DrawSprite, DrawSpritesOptions } from "../draw.js";
import type { SceneRenderer } from "./target.js";
import type { Rgba } from "./color.js";
import { parseRgba } from "./color.js";
import { scratchGeneration } from "../offscreen.js";
import {
  FLOATS_PER_QUAD,
  IDENTITY,
  copyAffine,
  imageSize,
  prepareSprites,
  resolveSprite,
  scissorFromRect,
  spriteCorners,
  writeQuad,
  writeQuadCorners,
  type Affine,
} from "./math.js";

const MAX_QUADS = 16384;

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec4 aColor;
out vec2 vUv;
out vec4 vColor;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUv = aUv;
  vColor = aColor;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv;
in vec4 vColor;
out vec4 frag;
void main() {
  frag = texture(uTex, vUv) * vColor;
}
`;

export interface WebGL2RendererOptions {
  /** Overlay play-area colour. Cleared on the GL canvas each frame. */
  background?: string | null;
  /** When true, a missing WebGL2 context throws instead of returning null. */
  required?: boolean;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("Minimotor: WebGL2 createShader failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "";
    gl.deleteShader(sh);
    throw new Error(`Minimotor: WebGL2 shader compile failed: ${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error("Minimotor: WebGL2 createProgram failed");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? "";
    gl.deleteProgram(prog);
    throw new Error(`Minimotor: WebGL2 program link failed: ${log}`);
  }
  return prog;
}

function stackUnder(overlay: HTMLCanvasElement, layer: HTMLCanvasElement): () => void {
  const computed = getComputedStyle(overlay);
  layer.style.position = computed.position === "static" ? "absolute" : computed.position;
  layer.style.top = computed.top === "auto" ? "0" : computed.top;
  layer.style.left = computed.left === "auto" ? "0" : computed.left;
  layer.style.display = "block";
  layer.style.pointerEvents = "none";
  const base = Number(computed.zIndex) || 0;
  const restoreZ = overlay.style.zIndex;
  const restorePos = overlay.style.position;
  layer.style.zIndex = String(base);
  overlay.style.zIndex = String(base + 1);
  if (computed.position === "static") overlay.style.position = "relative";
  overlay.parentNode?.insertBefore(layer, overlay);
  return () => {
    layer.remove();
    overlay.style.zIndex = restoreZ;
    overlay.style.position = restorePos;
  };
}

function buildIndex(): Uint16Array {
  const idx = new Uint16Array(MAX_QUADS * 6);
  for (let i = 0, v = 0; i < MAX_QUADS; i++, v += 4) {
    const o = i * 6;
    idx[o] = v;
    idx[o + 1] = v + 1;
    idx[o + 2] = v + 2;
    idx[o + 3] = v;
    idx[o + 4] = v + 2;
    idx[o + 5] = v + 3;
  }
  return idx;
}

/** Create a WebGL2 scene renderer stacked under `overlay`, or `null` when
 *  WebGL2 is unavailable and `required` is not set. */
export function createWebGL2Renderer(
  overlay: HTMLCanvasElement,
  opts: WebGL2RendererOptions = {},
): SceneRenderer | null {
  const scene = document.createElement("canvas");
  const raw = scene.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });
  if (!raw) {
    if (opts.required) {
      throw new Error(
        'Minimotor: WebGL2 is required (renderer: "webgl") but getContext("webgl2") returned null',
      );
    }
    return null;
  }
  const gl: WebGL2RenderingContext = raw;

  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = link(gl, vs, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  const ibo = gl.createBuffer();
  if (!vao || !vbo || !ibo) throw new Error("Minimotor: WebGL2 buffer allocation failed");

  const verts = new Float32Array(MAX_QUADS * FLOATS_PER_QUAD);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, buildIndex(), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  gl.useProgram(program);
  const uTex = gl.getUniformLocation(program, "uTex");
  if (uTex) gl.uniform1i(uTex, 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

  const whiteTex = gl.createTexture();
  if (!whiteTex) throw new Error("Minimotor: WebGL2 texture allocation failed");
  gl.bindTexture(gl.TEXTURE_2D, whiteTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );

  const textures = new WeakMap<CanvasImageSource, WebGLTexture>();
  const texGen = new WeakMap<WebGLTexture, number>();
  const transform: Affine = { ...IDENTITY };
  const spriteScratch: DrawSprite[] = [];
  let quadCount = 0;
  let bound: WebGLTexture | null = null;
  let canvasW = 1;
  let canvasH = 1;
  let destroyed = false;
  let clipOn = false;

  const clearColor = opts.background ? parseRgba(opts.background) : ([0, 0, 0, 0] as Rgba);
  const unstack = stackUnder(overlay, scene);

  function syncSize(): void {
    const w = overlay.width || 1;
    const h = overlay.height || 1;
    if (scene.width !== w) scene.width = w;
    if (scene.height !== h) scene.height = h;
    scene.style.width = overlay.style.width || `${overlay.clientWidth || w}px`;
    scene.style.height = overlay.style.height || `${overlay.clientHeight || h}px`;
    canvasW = scene.width;
    canvasH = scene.height;
    gl.viewport(0, 0, canvasW, canvasH);
  }
  syncSize();

  function flush(): void {
    if (quadCount === 0 || !bound) return;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts.subarray(0, quadCount * FLOATS_PER_QUAD));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bound);
    gl.drawElements(gl.TRIANGLES, quadCount * 6, gl.UNSIGNED_SHORT, 0);
    quadCount = 0;
  }

  function useTexture(tex: WebGLTexture): void {
    if (bound !== tex && quadCount > 0) flush();
    bound = tex;
  }

  function isLiveCanvas(image: CanvasImageSource): boolean {
    return (
      (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) ||
      (typeof OffscreenCanvas !== "undefined" && image instanceof OffscreenCanvas)
    );
  }

  function upload(image: CanvasImageSource): WebGLTexture | null {
    let tex = textures.get(image);
    const gen = scratchGeneration(image);
    // Engine-owned scratches re-upload only when `bumpScratch` runs. Static
    // images never change. A canvas the game handed in stays live.
    if (tex) {
      if (gen !== undefined) {
        if (texGen.get(tex) === gen) return tex;
      } else if (!isLiveCanvas(image)) {
        return tex;
      }
    }
    if (!tex) {
      tex = gl.createTexture();
      if (!tex) return null;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.set(image, tex);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, tex);
    }
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
    } catch {
      gl.deleteTexture(tex);
      textures.delete(image);
      texGen.delete(tex);
      return null;
    }
    if (gen !== undefined) texGen.set(tex, gen);
    return tex;
  }

  function pushQuad(
    tex: WebGLTexture,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    r: number,
    g: number,
    b: number,
    a: number,
    corners?: readonly [number, number, number, number, number, number, number, number],
  ): void {
    if (quadCount >= MAX_QUADS) flush();
    useTexture(tex);
    if (corners) {
      writeQuadCorners(
        verts,
        quadCount,
        transform,
        corners,
        u0,
        v0,
        u1,
        v1,
        r,
        g,
        b,
        a,
        canvasW,
        canvasH,
      );
    } else {
      writeQuad(
        verts,
        quadCount,
        transform,
        dx,
        dy,
        dw,
        dh,
        u0,
        v0,
        u1,
        v1,
        r,
        g,
        b,
        a,
        canvasW,
        canvasH,
      );
    }
    quadCount += 1;
  }

  const renderer: SceneRenderer = {
    kind: "webgl",
    beginFrame() {
      if (destroyed) return;
      if (clipOn) {
        gl.disable(gl.SCISSOR_TEST);
        clipOn = false;
      }
      gl.viewport(0, 0, canvasW, canvasH);
      gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      quadCount = 0;
      bound = null;
    },
    endFrame() {
      if (destroyed) return;
      flush();
    },
    resize() {
      if (destroyed) return;
      syncSize();
    },
    setTransform(m: Affine) {
      copyAffine(m, transform);
    },
    sprites(list: Iterable<DrawSprite>, opts: DrawSpritesOptions = {}) {
      if (destroyed) return;
      const ordered = prepareSprites(list, spriteScratch);
      const lerp = opts.interpolation;
      const view = opts.view;
      for (const s of ordered) {
        const r = resolveSprite(s, lerp, view);
        if (!r) continue;
        const tex = upload(r.img);
        if (!tex) continue;
        const iw = r.img.width || 1;
        const ih = r.img.height || 1;
        const u0 = r.sx / iw;
        const v0 = r.sy / ih;
        const u1 = (r.sx + r.sw) / iw;
        const v1 = (r.sy + r.sh) / ih;
        const rotated = r.rot !== 0 || r.scale !== 1 || r.flipX || r.flipY;
        if (rotated) {
          pushQuad(
            tex,
            0,
            0,
            0,
            0,
            u0,
            v0,
            u1,
            v1,
            1,
            1,
            1,
            r.alpha,
            spriteCorners(r.x, r.y, r.w, r.h, r.ax, r.ay, r.rot, r.scale, r.flipX, r.flipY),
          );
        } else {
          pushQuad(
            tex,
            r.x - r.ax * r.w,
            r.y - r.ay * r.h,
            r.w,
            r.h,
            u0,
            v0,
            u1,
            v1,
            1,
            1,
            1,
            r.alpha,
          );
        }
      }
    },
    blitImage(image, sx, sy, sw, sh, dx, dy, dw, dh, alpha = 1, tint) {
      if (destroyed || alpha <= 0) return;
      const tex = upload(image);
      if (!tex) return;
      const size = imageSize(image);
      const iw = size.w || 1;
      const ih = size.h || 1;
      const tr = tint ? tint[0] : 1;
      const tg = tint ? tint[1] : 1;
      const tb = tint ? tint[2] : 1;
      const ta = (tint ? tint[3] : 1) * alpha;
      pushQuad(
        tex,
        dx,
        dy,
        dw,
        dh,
        sx / iw,
        sy / ih,
        (sx + sw) / iw,
        (sy + sh) / ih,
        tr,
        tg,
        tb,
        ta,
      );
    },
    fillQuad(dx, dy, dw, dh, rgba) {
      if (destroyed || rgba[3] <= 0) return;
      pushQuad(whiteTex, dx, dy, dw, dh, 0, 0, 1, 1, rgba[0], rgba[1], rgba[2], rgba[3]);
    },
    setClip(rect) {
      if (destroyed) return;
      flush();
      if (!rect) {
        if (clipOn) {
          gl.disable(gl.SCISSOR_TEST);
          clipOn = false;
        }
        return;
      }
      const s = scissorFromRect(transform, rect.x, rect.y, rect.w, rect.h, canvasW, canvasH);
      gl.enable(gl.SCISSOR_TEST);
      clipOn = true;
      if (!s) {
        gl.scissor(0, 0, 0, 0);
        return;
      }
      gl.scissor(s.x, s.y, s.w, s.h);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unstack();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ibo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteTexture(whiteTex);
    },
  };

  return renderer;
}
