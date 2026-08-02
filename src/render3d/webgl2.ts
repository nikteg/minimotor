// ---------- WebGL2 backend ----------
// One program, Blinn-Phong, up to four directional lights. Not a material
// system: a single shader with uniform switches, because branching in a
// fragment shader on a uniform is free on every GPU made this decade and a
// program-per-material would need a permutation cache before it earned
// anything.
//
// GPU resources are cached WEAKLY against the plain-data objects that describe
// them — a `MeshData` maps to its VAO and buffers, a `TexImageSource` to its
// texture. So a caller creates meshes as ordinary values, and one that goes out
// of scope takes its GPU memory with it. The cost is that a MUTATED mesh is not
// noticed; `release(mesh)` is the escape hatch, and `mesh.version` would be the
// next step if in-place vertex editing ever becomes a real use.
//
// Two conventions worth stating because getting either wrong looks like a
// renderer bug rather than a convention mismatch:
//
//   - `MeshData.uvs` has v = 0 at the TOP, like every image the engine loads,
//     and `texImage2D` uploads an image's FIRST row at v = 0. Those two agree,
//     so nothing flips: no `UNPACK_FLIP_Y_WEBGL`, no flip in the shader.
//     Setting the flip — the reflex, because GL is usually described as
//     bottom-up — makes v = 0 the image's last row and turns every texture
//     upside down. It shipped that way once, and a UI surface on a quad is how
//     it was noticed: geometry-mapped art is symmetric enough to hide it,
//     text is not.
//   - Front faces are counter-clockwise (glTF and GL default). A mesh built
//     the other way renders inside-out; `flipWinding` fixes the mesh rather
//     than this file flipping the culling.

import { Mat4 } from "@src/math/mat4.js";
import { cameraPosition, viewProjection } from "./camera.js";
import { isVisible } from "./scene.js";
import { triangleCount, vertexCount } from "./mesh.js";
import type { Camera3D } from "./camera.js";
import type { MeshData } from "./mesh.js";
import type { Material, Node3D, Scene3D } from "./scene.js";
import type {
  RenderFrameStats,
  RenderOptions,
  RenderStats,
  Renderer3D,
  ResizeOptions,
} from "./renderer.js";
import type { Vec3 } from "@src/math/vec3.js";

const MAX_LIGHTS = 4;

const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aColor;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out vec4 vColor;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  // The inverse-transpose, so a non-uniformly scaled mesh still lights right.
  vNormal = uNormalMat * aNormal;
  vUv = aUv;
  vColor = aColor;
  gl_Position = uViewProj * world;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in vec4 vColor;

uniform vec4 uBaseColor;
uniform vec3 uAmbient;
uniform vec3 uLightDir[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
uniform int uLightCount;
uniform vec3 uCameraPos;
uniform float uShininess;
uniform float uSpecular;
uniform bool uUnlit;
uniform bool uHasTexture;
uniform sampler2D uTexture;

out vec4 fragColor;

void main() {
  vec4 base = uBaseColor * vColor;
  if (uHasTexture) base *= texture(uTexture, vUv);
  if (base.a < 0.002) discard;

  if (uUnlit) {
    // The canvas is premultiplied-alpha, so premultiply exactly once at the
    // render boundary. Texture uploads stay straight-alpha below.
    fragColor = vec4(base.rgb * base.a, base.a);
    return;
  }

  // Two-sided lighting: flip the normal on a back face so a doubleSided
  // material is lit rather than black on its reverse.
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 view = normalize(uCameraPos - vWorldPos);

  vec3 lit = uAmbient;
  vec3 spec = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 toLight = -uLightDir[i];
    float ndl = max(dot(n, toLight), 0.0);
    lit += uLightColor[i] * ndl;
    if (uShininess > 0.0 && ndl > 0.0) {
      vec3 halfway = normalize(toLight + view);
      spec += uLightColor[i] * uSpecular * pow(max(dot(n, halfway), 0.0), uShininess);
    }
  }
  fragColor = vec4((base.rgb * lit + spec) * base.a, base.a);
}`;

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  indexBuffer: WebGLBuffer;
  count: number;
  type: number;
}

interface Uniforms {
  viewProj: WebGLUniformLocation | null;
  model: WebGLUniformLocation | null;
  normalMat: WebGLUniformLocation | null;
  baseColor: WebGLUniformLocation | null;
  ambient: WebGLUniformLocation | null;
  lightDir: WebGLUniformLocation | null;
  lightColor: WebGLUniformLocation | null;
  lightCount: WebGLUniformLocation | null;
  cameraPos: WebGLUniformLocation | null;
  shininess: WebGLUniformLocation | null;
  specular: WebGLUniformLocation | null;
  unlit: WebGLUniformLocation | null;
  hasTexture: WebGLUniformLocation | null;
  texture: WebGLUniformLocation | null;
}

/** How to build a WebGL2 renderer. */
export interface WebGL2RendererOptions {
  /** Render into this canvas instead of a fresh one — for a scene layer that
   *  is already in the document. */
  canvas?: HTMLCanvasElement;
  /** Multisampling. On by default: at preview sizes the jaggies on a silhouette
   *  are the single most obvious quality difference, and MSAA is nearly free
   *  compared with supersampling. */
  antialias?: boolean;
  /** Preserve the default framebuffer after compositing. This is expensive;
   *  it remains enabled by default for compatibility. */
  preserveDrawingBuffer?: boolean;
  /** Collect GPU timer-query samples. Disabled by default because queries add
   *  instrumentation overhead. */
  gpuTiming?: boolean;
  /** Initial logical size. */
  width?: number;
  height?: number;
  /** Device pixel ratio for the backing store. */
  dpr?: number;
}

/** Create a WebGL2 renderer, or throw if the context cannot be created.
 *  Callers that want a graceful fallback should use `createRenderer3D`, which
 *  reports failure instead. */
export function createWebGL2Renderer(opts: WebGL2RendererOptions = {}): Renderer3D {
  const canvas = opts.canvas ?? document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: opts.antialias ?? true,
    depth: true,
    // The UI normally blits this canvas in the same JS frame. Keeping this
    // enabled remains the compatibility default, but it is a measurable cost
    // for a renderer used only as a short-lived canvas source.
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? true,
    premultipliedAlpha: true,
  });
  if (!gl) throw new Error("WebGL2 is not available in this browser or context.");
  const timerExt = opts.gpuTiming ? gl.getExtension("EXT_disjoint_timer_query_webgl2") : null;
  const pendingGpuQueries: WebGLQuery[] = [];
  let resolvedGpuMs = 0;

  function pollGpuQueries(): void {
    if (!timerExt) return;
    if (gl!.getParameter(timerExt.GPU_DISJOINT_EXT)) {
      for (const query of pendingGpuQueries) gl!.deleteQuery(query);
      pendingGpuQueries.length = 0;
      return;
    }
    for (let i = pendingGpuQueries.length - 1; i >= 0; i--) {
      const query = pendingGpuQueries[i];
      // In the WebGL2 variant the extension supplies TIME_ELAPSED_EXT and
      // GPU_DISJOINT_EXT, but the result-query enums are core WebGL2 enums.
      // Reading them from the extension object returns undefined in browsers
      // that implement the extension strictly, so the queries would remain
      // pending forever.
      if (!gl!.getQueryParameter(query, gl!.QUERY_RESULT_AVAILABLE)) continue;
      const nanoseconds = gl!.getQueryParameter(query, gl!.QUERY_RESULT) as number;
      resolvedGpuMs += nanoseconds / 1_000_000;
      gl!.deleteQuery(query);
      pendingGpuQueries.splice(i, 1);
    }
  }

  function beginGpuQuery(): WebGLQuery | null {
    if (!timerExt) return null;
    const query = gl!.createQuery();
    if (!query) return null;
    gl!.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
    return query;
  }

  function endGpuQuery(query: WebGLQuery | null): void {
    if (!query || !timerExt) return;
    gl!.endQuery(timerExt.TIME_ELAPSED_EXT);
    pendingGpuQueries.push(query);
  }

  const program = link(gl, VERTEX_SHADER, FRAGMENT_SHADER);
  const u: Uniforms = {
    viewProj: gl.getUniformLocation(program, "uViewProj"),
    model: gl.getUniformLocation(program, "uModel"),
    normalMat: gl.getUniformLocation(program, "uNormalMat"),
    baseColor: gl.getUniformLocation(program, "uBaseColor"),
    ambient: gl.getUniformLocation(program, "uAmbient"),
    lightDir: gl.getUniformLocation(program, "uLightDir"),
    lightColor: gl.getUniformLocation(program, "uLightColor"),
    lightCount: gl.getUniformLocation(program, "uLightCount"),
    cameraPos: gl.getUniformLocation(program, "uCameraPos"),
    shininess: gl.getUniformLocation(program, "uShininess"),
    specular: gl.getUniformLocation(program, "uSpecular"),
    unlit: gl.getUniformLocation(program, "uUnlit"),
    hasTexture: gl.getUniformLocation(program, "uHasTexture"),
    texture: gl.getUniformLocation(program, "uTexture"),
  };

  const meshes = new WeakMap<object, GpuMesh>();
  const textures = new WeakMap<object, { texture: WebGLTexture; version: number }>();

  let width = opts.width ?? 300;
  let height = opts.height ?? 150;
  let dpr = opts.dpr ?? 1;

  const viewProj = Mat4.create();
  const normalMat = new Float32Array(9);
  const eye: Vec3 = { x: 0, y: 0, z: 0 };
  const lightDirs = new Float32Array(MAX_LIGHTS * 3);
  const lightColors = new Float32Array(MAX_LIGHTS * 3);
  const stats: RenderStats = { drawCalls: 0, triangles: 0, culled: 0 };
  const frameStats: RenderFrameStats = {
    viewports: 0,
    drawCalls: 0,
    triangles: 0,
    culled: 0,
    cpuMs: 0,
  };
  // Reused across frames so sorting a scene allocates nothing per frame.
  const opaque: number[] = [];
  const blended: { index: number; depth: number }[] = [];

  function applyCanvasSize(retainBackingStore = false): void {
    const bw = Math.max(1, Math.round(width * dpr));
    const bh = Math.max(1, Math.round(height * dpr));
    const nextW = retainBackingStore ? Math.max(canvas.width, bw) : bw;
    const nextH = retainBackingStore ? Math.max(canvas.height, bh) : bh;
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
  }
  applyCanvasSize();

  function uploadMesh(mesh: MeshData): GpuMesh {
    const cached = meshes.get(mesh);
    if (cached) return cached;

    const vao = gl!.createVertexArray();
    if (!vao) throw new Error("WebGL2: could not create a vertex array object.");
    gl!.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];

    const n = vertexCount(mesh);
    // Missing attributes get a filled default rather than a disabled one: a
    // disabled attribute reads whatever the last draw left bound, which shows
    // up as a mesh randomly inheriting another mesh's colours.
    const attach = (location: number, data: Float32Array, size: number): void => {
      const buf = gl!.createBuffer();
      if (!buf) throw new Error("WebGL2: could not create a vertex buffer.");
      buffers.push(buf);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buf);
      gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW);
      gl!.enableVertexAttribArray(location);
      gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, 0, 0);
    };
    attach(0, mesh.positions, 3);
    attach(1, mesh.normals ?? defaultNormals(n), 3);
    attach(2, mesh.uvs ?? new Float32Array(n * 2), 2);
    attach(3, mesh.colors ?? filled(n * 4, 1), 4);

    const indexBuffer = gl!.createBuffer();
    if (!indexBuffer) throw new Error("WebGL2: could not create an index buffer.");
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, mesh.indices, gl!.STATIC_DRAW);
    gl!.bindVertexArray(null);

    const gpu: GpuMesh = {
      vao,
      buffers,
      indexBuffer,
      count: mesh.indices.length,
      type: mesh.indices instanceof Uint32Array ? gl!.UNSIGNED_INT : gl!.UNSIGNED_SHORT,
    };
    meshes.set(mesh, gpu);
    return gpu;
  }

  function uploadTexture(
    source: TexImageSource,
    pixelated: boolean,
    version: number,
  ): WebGLTexture {
    const cached = textures.get(source as object);
    if (cached && cached.version === version) return cached.texture;
    // Re-uploading into the SAME texture object rather than making a new one:
    // a live surface would otherwise leak one texture per frame.
    const tex = cached?.texture ?? gl!.createTexture();
    if (!tex) throw new Error("WebGL2: could not create a texture.");
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false);
    // Keep sampled textures straight-alpha; both backends premultiply once in
    // their fragment shader when writing to the premultiplied canvas.
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source);
    const filter = pixelated ? gl!.NEAREST : gl!.LINEAR;
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter);
    // CLAMP, not REPEAT: a non-power-of-two texture is legal in WebGL2 but
    // wrapping one bleeds the opposite edge into a uv that lands exactly on 1.
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    textures.set(source as object, { texture: tex, version });
    return tex;
  }

  function drawNode(node: Node3D, material: Material): void {
    if (!node.mesh || !node.world) return;
    const gpu = uploadMesh(node.mesh);

    gl!.uniformMatrix4fv(u.model, false, node.world);
    // A singular model matrix (a zero scale) has no normal matrix; fall back
    // to the model matrix, which at least renders the silhouette rather than
    // dropping the node.
    const nm = Mat4.normalMatrix(node.world, normalMat);
    gl!.uniformMatrix3fv(u.normalMat, false, nm ?? IDENTITY3);

    const color = material.color ?? WHITE;
    gl!.uniform4f(u.baseColor, color[0], color[1], color[2], color[3]);
    gl!.uniform1f(u.shininess, material.shininess ?? 0);
    gl!.uniform1f(u.specular, material.specular ?? 0.25);
    gl!.uniform1i(u.unlit, material.unlit ? 1 : 0);

    if (material.texture) {
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(
        gl!.TEXTURE_2D,
        uploadTexture(material.texture, material.pixelated ?? true, material.textureVersion ?? 0),
      );
      gl!.uniform1i(u.texture, 0);
      gl!.uniform1i(u.hasTexture, 1);
    } else {
      gl!.uniform1i(u.hasTexture, 0);
    }

    if (material.doubleSided) gl!.disable(gl!.CULL_FACE);
    else gl!.enable(gl!.CULL_FACE);

    gl!.bindVertexArray(gpu.vao);
    gl!.drawElements(gl!.TRIANGLES, gpu.count, gpu.type, 0);
    stats.drawCalls++;
    stats.triangles += triangleCount(node.mesh);
  }

  const renderer: Renderer3D = {
    backend: "webgl2",
    canvas,
    clipZeroToOne: false,
    stats,
    consumeFrameStats() {
      pollGpuQueries();
      const snapshot = { ...frameStats, gpuMs: timerExt ? resolvedGpuMs : undefined };
      frameStats.viewports = 0;
      frameStats.drawCalls = 0;
      frameStats.triangles = 0;
      frameStats.culled = 0;
      frameStats.cpuMs = 0;
      resolvedGpuMs = 0;
      return snapshot;
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get renderWidth() {
      return Math.max(1, Math.round(width * dpr));
    },
    get renderHeight() {
      return Math.max(1, Math.round(height * dpr));
    },

    resize(w, h, ratio, options: ResizeOptions = {}) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      if (ratio !== undefined) dpr = ratio;
      applyCanvasSize(options.retainBackingStore);
    },

    render(scene: Scene3D, camera: Camera3D, opts: RenderOptions = {}) {
      stats.drawCalls = 0;
      stats.triangles = 0;
      stats.culled = 0;
      frameStats.viewports++;
      const renderStart = performance.now();
      const gpuQuery = beginGpuQuery();

      const targetW = Math.max(1, Math.round(width * dpr));
      const targetH = Math.max(1, Math.round(height * dpr));
      // WebGL's origin is bottom-left, while the 2D crop in viewport3d reads
      // from the canvas's top-left. Keep the active render rectangle aligned
      // with that crop when the backing store is larger than this viewport.
      const targetY = canvas.height - targetH;
      gl!.viewport(0, targetY, targetW, targetH);
      gl!.enable(gl!.DEPTH_TEST);
      gl!.depthFunc(gl!.LEQUAL);
      gl!.enable(gl!.CULL_FACE);
      gl!.cullFace(gl!.BACK);
      gl!.frontFace(gl!.CCW);

      if (opts.clear !== false) {
        const bg = scene.background;
        // Premultiplied alpha, because the context was created that way: a
        // straight-alpha clear colour makes a transparent background render as
        // a light haze over whatever is behind it.
        gl!.clearColor(bg[0] * bg[3], bg[1] * bg[3], bg[2] * bg[3], bg[3]);
        gl!.clearDepth(1);
        gl!.enable(gl!.SCISSOR_TEST);
        gl!.scissor(0, targetY, targetW, targetH);
        gl!.depthMask(true);
        gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
        gl!.disable(gl!.SCISSOR_TEST);
      }
      if (scene.nodes.length === 0) {
        endGpuQuery(gpuQuery);
        frameStats.drawCalls += stats.drawCalls;
        frameStats.triangles += stats.triangles;
        frameStats.culled += stats.culled;
        frameStats.cpuMs += performance.now() - renderStart;
        return;
      }

      gl!.useProgram(program);
      viewProjection(camera, width / height, false, viewProj);
      gl!.uniformMatrix4fv(u.viewProj, false, viewProj);
      cameraPosition(camera, eye);
      gl!.uniform3f(u.cameraPos, eye.x, eye.y, eye.z);
      gl!.uniform3f(u.ambient, scene.ambient[0], scene.ambient[1], scene.ambient[2]);

      const lights = scene.lights.slice(0, MAX_LIGHTS);
      lights.forEach((light, i) => {
        const d = light.direction;
        const l = Math.hypot(d.x, d.y, d.z) || 1;
        lightDirs[i * 3] = d.x / l;
        lightDirs[i * 3 + 1] = d.y / l;
        lightDirs[i * 3 + 2] = d.z / l;
        const c = light.color ?? WHITE3;
        const k = light.intensity ?? 1;
        lightColors[i * 3] = c[0] * k;
        lightColors[i * 3 + 1] = c[1] * k;
        lightColors[i * 3 + 2] = c[2] * k;
      });
      gl!.uniform3fv(u.lightDir, lightDirs);
      gl!.uniform3fv(u.lightColor, lightColors);
      gl!.uniform1i(u.lightCount, lights.length);

      // Split opaque from transparent. Transparency in a depth-buffered
      // renderer has no exact answer; the standard approximation is to draw
      // opaque geometry first with depth writes on, then blended geometry
      // back-to-front with depth writes OFF so two transparent surfaces do not
      // occlude each other. It is wrong for interpenetrating transparent
      // meshes, and that is a known limit rather than a bug to chase.
      opaque.length = 0;
      blended.length = 0;
      scene.nodes.forEach((n, i) => {
        if (!n.mesh || !n.world) return;
        if (!isVisible(scene, i)) {
          stats.culled++;
          return;
        }
        if (n.material?.transparent) {
          const dx = n.world[12] - eye.x;
          const dy = n.world[13] - eye.y;
          const dz = n.world[14] - eye.z;
          blended.push({ index: i, depth: dx * dx + dy * dy + dz * dz });
        } else {
          opaque.push(i);
        }
      });

      gl!.disable(gl!.BLEND);
      gl!.depthMask(true);
      for (const i of opaque) drawNode(scene.nodes[i], scene.nodes[i].material ?? {});

      if (blended.length > 0) {
        blended.sort((a, b) => b.depth - a.depth); // farthest first
        gl!.enable(gl!.BLEND);
        // Premultiplied-alpha blending, matching the context and the textures.
        gl!.blendFuncSeparate(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA, gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
        gl!.depthMask(false);
        for (const { index } of blended) {
          drawNode(scene.nodes[index], scene.nodes[index].material ?? {});
        }
        gl!.depthMask(true);
        gl!.disable(gl!.BLEND);
      }
      gl!.bindVertexArray(null);
      endGpuQuery(gpuQuery);
      frameStats.drawCalls += stats.drawCalls;
      frameStats.triangles += stats.triangles;
      frameStats.culled += stats.culled;
      frameStats.cpuMs += performance.now() - renderStart;
    },

    release(mesh: object) {
      const gpu = meshes.get(mesh);
      if (!gpu) return;
      gl!.deleteVertexArray(gpu.vao);
      for (const b of gpu.buffers) gl!.deleteBuffer(b);
      gl!.deleteBuffer(gpu.indexBuffer);
      meshes.delete(mesh);
    },

    dispose() {
      gl!.deleteProgram(program);
      // The rest is reachable only through the WeakMaps, which die with this
      // closure; losing the context frees them regardless.
      gl!.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
  return renderer;
}

const WHITE = [1, 1, 1, 1] as const;
const WHITE3 = [1, 1, 1] as const;
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function filled(n: number, value: number): Float32Array {
  const a = new Float32Array(n);
  a.fill(value);
  return a;
}

function defaultNormals(n: number): Float32Array {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a[i * 3 + 1] = 1;
  return a;
}

function link(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL2: could not create a program.");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Shaders are safe to delete once linked; the program holds what it needs.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`WebGL2: program link failed — ${log}`);
  }
  return program;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL2: could not create a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
    // The line numbers in the log refer to the source above, so print it.
    throw new Error(`WebGL2: ${kind} shader failed to compile — ${log}\n${numbered(source)}`);
  }
  return shader;
}

function numbered(source: string): string {
  return source
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(3)} | ${line}`)
    .join("\n");
}
