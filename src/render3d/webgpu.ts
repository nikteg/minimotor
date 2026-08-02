// ---------- WebGPU backend ----------
// The same scene, the same camera, the same meshes — a different API under
// them. It exists alongside the WebGL2 backend rather than replacing it
// because WebGPU is still not everywhere (Firefox and older Safari fall back),
// and because having two implementations of one interface is what keeps the
// interface honest.
//
// What differs from `webgl2.ts`, and why each difference is forced rather than
// chosen:
//
//   - **Clip depth is 0…1**, not −1…1. Hence `clipZeroToOne: true` and hence
//     the flag threaded through `Mat4.perspective`. Rendering a WebGL matrix
//     here puts half the scene behind the near plane and looks like the model
//     failed to load.
//   - **Uniforms live in buffers**, not individual `uniform*` calls. Per-draw
//     data goes in ONE buffer read with a dynamic offset, so a scene of N
//     nodes costs one buffer write and N cheap bind-group rebinds instead of
//     N buffer allocations. Dynamic offsets must be 256-byte aligned, which is
//     why the 144 bytes of per-draw data occupy 256.
//   - **Pipeline state is immutable.** WebGL toggles `CULL_FACE` and blending
//     between draws; here each combination is a separate pipeline, created on
//     demand and cached. There are exactly four (blend × double-sided), so the
//     cache never grows unbounded.
//   - **The depth buffer is an explicit texture** that must be resized with
//     the canvas, and leaking one on every resize is the classic WebGPU memory
//     bug. `configureSize` destroys the old one.
//
// Y-flip: WGSL's texture coordinates put v = 0 at the TOP, which is already
// the convention `MeshData.uvs` uses, so unlike the GL path there is nothing
// to flip. `copyExternalImageToTexture` also lands top-down by default.

import { Mat4 } from "@src/math/mat4.js";
import { cameraPosition, viewProjection } from "./camera.js";
import { isVisible } from "./scene.js";
import { triangleCount, vertexCount } from "./mesh.js";
import type { Camera3D } from "./camera.js";
import type { MeshData } from "./mesh.js";
import type { Material, Node3D, Scene3D } from "./scene.js";
import type { RenderFrameStats, RenderOptions, RenderStats, Renderer3D } from "./renderer.js";
import type { Vec3 } from "@src/math/vec3.js";

const MAX_LIGHTS = 4;
/** Frame uniforms: viewProj(64) + cameraPos(16) + ambient(16) + lightCount(16)
 *  + dir[4](64) + colour[4](64). Every field is vec4-aligned because WGSL's
 *  std140-like rules round a vec3 up to 16 bytes anyway. */
const FRAME_BYTES = 240;
/** Per-draw: model(64) + normalMat as 3×vec4(48) + baseColor(16) + params(16).
 *  Padded to the 256-byte minimum dynamic-offset alignment. */
const DRAW_BYTES = 256;
const DRAW_FLOATS = DRAW_BYTES / 4;
const TIMESTAMP_SLOTS = 64;
const TIMESTAMP_STRIDE = 256;

const SHADER = /* wgsl */ `
struct Frame {
  viewProj   : mat4x4f,
  cameraPos  : vec4f,
  ambient    : vec4f,
  lightCount : vec4f,
  lightDir   : array<vec4f, ${MAX_LIGHTS}>,
  lightColor : array<vec4f, ${MAX_LIGHTS}>,
};

struct DrawData {
  model     : mat4x4f,
  // A mat3x3 in a uniform buffer is laid out as three vec4s; storing it as
  // three explicit vec4s keeps the JS side's offsets obvious.
  normal0   : vec4f,
  normal1   : vec4f,
  normal2   : vec4f,
  baseColor : vec4f,
  // x: shininess, y: unlit, z: hasTexture, w: specular strength
  params    : vec4f,
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var<uniform> draw  : DrawData;
@group(1) @binding(0) var samp : sampler;
@group(1) @binding(1) var tex  : texture_2d<f32>;

struct VsOut {
  @builtin(position) clip     : vec4f,
  @location(0)       worldPos : vec3f,
  @location(1)       normal   : vec3f,
  @location(2)       uv       : vec2f,
  @location(3)       color    : vec4f,
};

@vertex
fn vs(
  @location(0) position : vec3f,
  @location(1) normal   : vec3f,
  @location(2) uv       : vec2f,
  @location(3) color    : vec4f,
) -> VsOut {
  var out : VsOut;
  let world = draw.model * vec4f(position, 1.0);
  out.worldPos = world.xyz;
  let nm = mat3x3f(draw.normal0.xyz, draw.normal1.xyz, draw.normal2.xyz);
  out.normal = nm * normal;
  out.uv = uv;
  out.color = color;
  out.clip = frame.viewProj * world;
  return out;
}

@fragment
fn fs(in : VsOut, @builtin(front_facing) frontFacing : bool) -> @location(0) vec4f {
  var base = draw.baseColor * in.color;
  if (draw.params.z > 0.5) {
    base = base * textureSample(tex, samp, in.uv);
  }
  if (base.a < 0.002) { discard; }
  if (draw.params.y > 0.5) {
    // Unlit output is premultiplied to match the canvas alpha mode.
    return vec4f(base.rgb * base.a, base.a);
  }

  var n = normalize(in.normal);
  if (!frontFacing) { n = -n; }
  let view = normalize(frame.cameraPos.xyz - in.worldPos);

  var lit = frame.ambient.rgb;
  var spec = vec3f(0.0);
  let count = i32(frame.lightCount.x);
  for (var i = 0; i < ${MAX_LIGHTS}; i = i + 1) {
    if (i >= count) { break; }
    let toLight = -frame.lightDir[i].xyz;
    let ndl = max(dot(n, toLight), 0.0);
    lit = lit + frame.lightColor[i].rgb * ndl;
    if (draw.params.x > 0.0 && ndl > 0.0) {
      let halfway = normalize(toLight + view);
      spec = spec + frame.lightColor[i].rgb * draw.params.w * pow(max(dot(n, halfway), 0.0), draw.params.x);
    }
  }
  let rgb = base.rgb * lit + spec;
  return vec4f(rgb * base.a, base.a);
}`;

interface GpuMesh {
  positions: GPUBuffer;
  normals: GPUBuffer;
  uvs: GPUBuffer;
  colors: GPUBuffer;
  indices: GPUBuffer;
  count: number;
  format: GPUIndexFormat;
  triangles: number;
}

/** How to build a WebGPU renderer. */
export interface WebGPURendererOptions {
  canvas?: HTMLCanvasElement;
  width?: number;
  height?: number;
  dpr?: number;
  /** Ask for a high-performance adapter (the discrete GPU on a laptop that has
   *  both). Default `"high-performance"`; `"low-power"` for a small preview
   *  that is not worth spinning a dGPU up for. */
  powerPreference?: GPUPowerPreference;
  /** Collect timestamp-query samples. Disabled by default because readback
   *  instrumentation adds overhead. */
  gpuTiming?: boolean;
}

/** Whether this browser exposes WebGPU at all. A synchronous, cheap check —
 *  it does not prove an adapter can be acquired, only that asking is worth
 *  the round trip. */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Create a WebGPU renderer. Rejects when WebGPU is missing, no adapter can be
 *  acquired, or device creation fails — `createRenderer3D` catches that and
 *  falls back to WebGL2. */
export async function createWebGPURenderer(opts: WebGPURendererOptions = {}): Promise<Renderer3D> {
  if (!isWebGPUAvailable()) throw new Error("WebGPU is not available in this browser.");
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: opts.powerPreference ?? "high-performance",
  });
  if (!adapter) throw new Error("WebGPU: no adapter available.");
  const timestampSupported = opts.gpuTiming === true && adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice({
    requiredFeatures: timestampSupported ? ["timestamp-query"] : [],
  });

  const timestampQuerySet = timestampSupported
    ? device.createQuerySet({ type: "timestamp", count: TIMESTAMP_SLOTS * 2 })
    : null;
  const timestampResolveBuffer = timestampSupported
    ? device.createBuffer({
        size: TIMESTAMP_SLOTS * TIMESTAMP_STRIDE,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      })
    : null;
  const timestampBusy = new Uint8Array(TIMESTAMP_SLOTS);
  let nextTimestampSlot = 0;
  let resolvedGpuMs = 0;

  function reserveGpuTimestamp(): number | null {
    if (!timestampQuerySet) return null;
    for (let i = 0; i < TIMESTAMP_SLOTS; i++) {
      const slot = (nextTimestampSlot + i) % TIMESTAMP_SLOTS;
      if (timestampBusy[slot]) continue;
      timestampBusy[slot] = 1;
      nextTimestampSlot = (slot + 1) % TIMESTAMP_SLOTS;
      return slot;
    }
    return null;
  }

  function finishGpuTimestamp(encoder: GPUCommandEncoder, slot: number): GPUBuffer {
    const offset = slot * TIMESTAMP_STRIDE;
    encoder.resolveQuerySet(timestampQuerySet!, slot * 2, 2, timestampResolveBuffer!, offset);
    const readback = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyBufferToBuffer(timestampResolveBuffer!, offset, readback, 0, 16);
    return readback;
  }

  function collectGpuTimestamp(slot: number, readback: GPUBuffer): void {
    void readback
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const values = new BigUint64Array(readback.getMappedRange());
        const nanoseconds = Number(values[1] - values[0]);
        readback.unmap();
        readback.destroy();
        timestampBusy[slot] = 0;
        if (nanoseconds >= 0) resolvedGpuMs += nanoseconds / 1_000_000;
      })
      .catch(() => {
        readback.destroy();
        timestampBusy[slot] = 0;
      });
  }

  const canvas = opts.canvas ?? document.createElement("canvas");
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("WebGPU: could not get a webgpu context from the canvas.");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "premultiplied",
  });

  const module = device.createShaderModule({ code: SHADER, label: "render3d" });

  // Group 0 holds both uniform buffers; the per-draw one is bound with a
  // dynamic offset so one bind group serves every node in the scene.
  const frameLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { hasDynamicOffset: true, minBindingSize: DRAW_BYTES },
      },
    ],
  });
  const textureLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [frameLayout, textureLayout],
  });

  const vertexBuffers: GPUVertexBufferLayout[] = [
    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
    { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
    { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }] },
    { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }] },
  ];

  const pipelines = new Map<string, GPURenderPipeline>();
  function pipelineFor(blend: boolean, doubleSided: boolean): GPURenderPipeline {
    const key = `${blend}:${doubleSided}`;
    const cached = pipelines.get(key);
    if (cached) return cached;
    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: "vs", buffers: vertexBuffers },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format,
            blend: blend
              ? {
                  // Premultiplied source, matching the canvas alpha mode and
                  // the shader's premultiplied output.
                  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
                  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
                }
              : undefined,
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
        cullMode: doubleSided ? "none" : "back",
        frontFace: "ccw",
      },
      depthStencil: {
        format: "depth24plus",
        // Transparent geometry tests against depth but does not write it, so
        // two blended surfaces do not occlude each other.
        depthWriteEnabled: !blend,
        depthCompare: "less-equal",
      },
    });
    pipelines.set(key, pipeline);
    return pipeline;
  }

  const frameBuffer = device.createBuffer({
    size: FRAME_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  let drawBuffer: GPUBuffer | null = null;
  let drawCapacity = 0;
  let drawData = new Float32Array(0);
  let frameBindGroup: GPUBindGroup | null = null;

  function ensureDrawCapacity(nodes: number): void {
    if (drawBuffer && nodes <= drawCapacity) return;
    // Grow in powers of two: a scene that adds one node per frame must not
    // reallocate a GPU buffer per frame.
    const capacity = Math.max(16, 1 << Math.ceil(Math.log2(Math.max(1, nodes))));
    drawBuffer?.destroy();
    drawBuffer = device.createBuffer({
      size: capacity * DRAW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    drawCapacity = capacity;
    drawData = new Float32Array(capacity * DRAW_FLOATS);
    frameBindGroup = device.createBindGroup({
      layout: frameLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: { buffer: drawBuffer, size: DRAW_BYTES } },
      ],
    });
  }

  const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
  const smoothSampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  // A 1×1 opaque white texture stands in when a material has none, so the
  // shader keeps one code path and the bind group is never left unbound.
  const blankTexture = device.createTexture({
    size: [1, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: blankTexture },
    new Uint8Array([255, 255, 255, 255]),
    {},
    [1, 1],
  );
  const blankBindGroup = device.createBindGroup({
    layout: textureLayout,
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: blankTexture.createView() },
    ],
  });

  const meshes = new WeakMap<object, GpuMesh>();
  const textureGroups = new WeakMap<
    object,
    { group: GPUBindGroup; texture: GPUTexture; version: number; width: number; height: number }
  >();

  let width = opts.width ?? 300;
  let height = opts.height ?? 150;
  let dpr = opts.dpr ?? 1;
  let depthTexture: GPUTexture | null = null;

  function configureSize(): void {
    const bw = Math.max(1, Math.round(width * dpr));
    const bh = Math.max(1, Math.round(height * dpr));
    if (canvas.width === bw && canvas.height === bh && depthTexture) return;
    canvas.width = bw;
    canvas.height = bh;
    // Destroy before replacing — a depth texture leaked per resize is a
    // several-megabyte-per-drag leak on an interactive viewport.
    depthTexture?.destroy();
    depthTexture = device.createTexture({
      size: [bw, bh],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
  configureSize();

  /** Upload a typed array into a fresh GPU buffer. `mappedAtCreation` writes
   *  it without a staging copy, and the size is rounded up because
   *  `createBuffer` requires a multiple of 4. */
  function buffer(data: ArrayBufferView, usage: GPUBufferUsageFlags): GPUBuffer {
    const buf = device.createBuffer({
      size: alignTo4(data.byteLength),
      usage,
      mappedAtCreation: true,
    });
    new Uint8Array(buf.getMappedRange()).set(
      new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength),
    );
    buf.unmap();
    return buf;
  }

  function uploadMesh(mesh: MeshData): GpuMesh {
    const cached = meshes.get(mesh);
    if (cached) return cached;
    const n = vertexCount(mesh);
    // WebGPU has no "disabled attribute" fallback at all — an absent buffer is
    // a validation error, not a garbage read — so defaults are always filled.
    const gpu: GpuMesh = {
      positions: buffer(mesh.positions, GPUBufferUsage.VERTEX),
      normals: buffer(mesh.normals ?? defaultNormals(n), GPUBufferUsage.VERTEX),
      uvs: buffer(mesh.uvs ?? new Float32Array(n * 2), GPUBufferUsage.VERTEX),
      colors: buffer(mesh.colors ?? filled(n * 4, 1), GPUBufferUsage.VERTEX),
      indices: buffer(mesh.indices, GPUBufferUsage.INDEX),
      count: mesh.indices.length,
      format: mesh.indices instanceof Uint32Array ? "uint32" : "uint16",
      triangles: triangleCount(mesh),
    };
    meshes.set(mesh, gpu);
    return gpu;
  }

  function textureGroupFor(
    source: TexImageSource,
    pixelated: boolean,
    version: number,
  ): GPUBindGroup {
    const size = sourceSize(source);
    const cached = textureGroups.get(source as object);
    if (cached && cached.width === size.width && cached.height === size.height) {
      if (cached.version === version) return cached.group;
      // Same dimensions: copy into the existing texture and keep the bind
      // group. A resize has to rebuild both, since a GPUTexture's size is
      // fixed at creation.
      device.queue.copyExternalImageToTexture(
        { source },
        { texture: cached.texture, premultipliedAlpha: false },
        [size.width, size.height],
      );
      cached.version = version;
      return cached.group;
    }
    cached?.texture.destroy();
    const texture = device.createTexture({
      size: [size.width, size.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source }, { texture, premultipliedAlpha: false }, [
      size.width,
      size.height,
    ]);
    const group = device.createBindGroup({
      layout: textureLayout,
      entries: [
        { binding: 0, resource: pixelated ? sampler : smoothSampler },
        { binding: 1, resource: texture.createView() },
      ],
    });
    textureGroups.set(source as object, {
      group,
      texture,
      version,
      width: size.width,
      height: size.height,
    });
    return group;
  }

  const viewProj = Mat4.create();
  const normalMat = new Float32Array(9);
  const eye: Vec3 = { x: 0, y: 0, z: 0 };
  const frameData = new Float32Array(FRAME_BYTES / 4);
  const stats: RenderStats = { drawCalls: 0, triangles: 0, culled: 0 };
  const frameStats: RenderFrameStats = {
    viewports: 0,
    drawCalls: 0,
    triangles: 0,
    culled: 0,
    cpuMs: 0,
  };
  const opaque: number[] = [];
  const blended: { index: number; depth: number }[] = [];

  /** Pack one node's per-draw uniforms at slot `slot`. */
  function writeDrawData(node: Node3D, material: Material, slot: number): void {
    const at = slot * DRAW_FLOATS;
    drawData.set(node.world!, at);
    const nm = Mat4.normalMatrix(node.world!, normalMat) ?? IDENTITY3;
    for (let c = 0; c < 3; c++) {
      drawData[at + 16 + c * 4] = nm[c * 3];
      drawData[at + 16 + c * 4 + 1] = nm[c * 3 + 1];
      drawData[at + 16 + c * 4 + 2] = nm[c * 3 + 2];
      drawData[at + 16 + c * 4 + 3] = 0;
    }
    const color = material.color ?? WHITE;
    drawData.set(color, at + 28);
    drawData[at + 32] = material.shininess ?? 0;
    drawData[at + 33] = material.unlit ? 1 : 0;
    drawData[at + 34] = material.texture ? 1 : 0;
    drawData[at + 35] = material.specular ?? 0.25;
  }

  const renderer: Renderer3D = {
    backend: "webgpu",
    canvas,
    clipZeroToOne: true,
    stats,
    consumeFrameStats() {
      const snapshot = {
        ...frameStats,
        gpuMs: timestampSupported ? resolvedGpuMs : undefined,
      };
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
      return canvas.width;
    },
    get renderHeight() {
      return canvas.height;
    },

    resize(w, h, ratio) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      if (ratio !== undefined) dpr = ratio;
      configureSize();
    },

    render(scene: Scene3D, camera: Camera3D, options: RenderOptions = {}) {
      stats.drawCalls = 0;
      stats.triangles = 0;
      stats.culled = 0;
      frameStats.viewports++;
      const renderStart = performance.now();
      configureSize();

      // Partition first: the per-draw buffer is written in one go before the
      // render pass opens, because a pass cannot be interrupted by a queue
      // write.
      opaque.length = 0;
      blended.length = 0;
      cameraPosition(camera, eye);
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
      blended.sort((a, b) => b.depth - a.depth);

      const total = opaque.length + blended.length;
      ensureDrawCapacity(Math.max(1, total));

      viewProjection(camera, width / height, true, viewProj);
      frameData.set(viewProj, 0);
      frameData.set([eye.x, eye.y, eye.z, 0], 16);
      frameData.set([scene.ambient[0], scene.ambient[1], scene.ambient[2], 0], 20);
      const lights = scene.lights.slice(0, MAX_LIGHTS);
      frameData[24] = lights.length;
      lights.forEach((light, i) => {
        const d = light.direction;
        const l = Math.hypot(d.x, d.y, d.z) || 1;
        frameData.set([d.x / l, d.y / l, d.z / l, 0], 28 + i * 4);
        const c = light.color ?? WHITE3;
        const k = light.intensity ?? 1;
        frameData.set([c[0] * k, c[1] * k, c[2] * k, 0], 44 + i * 4);
      });
      device.queue.writeBuffer(frameBuffer, 0, frameData);

      const order = [...opaque, ...blended.map((b) => b.index)];
      order.forEach((index, slot) => {
        const n = scene.nodes[index];
        writeDrawData(n, n.material ?? {}, slot);
      });
      if (total > 0) {
        device.queue.writeBuffer(drawBuffer!, 0, drawData, 0, total * DRAW_FLOATS);
      }

      const bg = scene.background;
      const encoder = device.createCommandEncoder();
      const timestampSlot = reserveGpuTimestamp();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context!.getCurrentTexture().createView(),
            // Premultiplied clear, matching the canvas alpha mode.
            clearValue: { r: bg[0] * bg[3], g: bg[1] * bg[3], b: bg[2] * bg[3], a: bg[3] },
            loadOp: options.clear === false ? "load" : "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: depthTexture!.createView(),
          depthClearValue: 1,
          depthLoadOp: options.clear === false ? "load" : "clear",
          depthStoreOp: "store",
        },
        timestampWrites:
          timestampSlot === null
            ? undefined
            : {
                querySet: timestampQuerySet!,
                beginningOfPassWriteIndex: timestampSlot * 2,
                endOfPassWriteIndex: timestampSlot * 2 + 1,
              },
      });

      order.forEach((index, slot) => {
        const n = scene.nodes[index];
        const material = n.material ?? {};
        const gpu = uploadMesh(n.mesh!);
        pass.setPipeline(pipelineFor(!!material.transparent, !!material.doubleSided));
        pass.setBindGroup(0, frameBindGroup!, [slot * DRAW_BYTES]);
        pass.setBindGroup(
          1,
          material.texture
            ? textureGroupFor(
                material.texture,
                material.pixelated ?? true,
                material.textureVersion ?? 0,
              )
            : blankBindGroup,
        );
        pass.setVertexBuffer(0, gpu.positions);
        pass.setVertexBuffer(1, gpu.normals);
        pass.setVertexBuffer(2, gpu.uvs);
        pass.setVertexBuffer(3, gpu.colors);
        pass.setIndexBuffer(gpu.indices, gpu.format);
        pass.drawIndexed(gpu.count);
        stats.drawCalls++;
        stats.triangles += gpu.triangles;
      });

      pass.end();
      const timestampReadback =
        timestampSlot === null ? null : finishGpuTimestamp(encoder, timestampSlot);
      device.queue.submit([encoder.finish()]);
      if (timestampReadback && timestampSlot !== null) {
        collectGpuTimestamp(timestampSlot, timestampReadback);
      }
      frameStats.drawCalls += stats.drawCalls;
      frameStats.triangles += stats.triangles;
      frameStats.culled += stats.culled;
      frameStats.cpuMs += performance.now() - renderStart;
    },

    release(mesh: object) {
      const gpu = meshes.get(mesh);
      if (!gpu) return;
      gpu.positions.destroy();
      gpu.normals.destroy();
      gpu.uvs.destroy();
      gpu.colors.destroy();
      gpu.indices.destroy();
      meshes.delete(mesh);
    },

    dispose() {
      depthTexture?.destroy();
      drawBuffer?.destroy();
      frameBuffer.destroy();
      blankTexture.destroy();
      timestampQuerySet?.destroy();
      timestampResolveBuffer?.destroy();
      device.destroy();
    },
  };
  return renderer;
}

const WHITE = [1, 1, 1, 1] as const;
const WHITE3 = [1, 1, 1] as const;
const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function alignTo4(bytes: number): number {
  return (bytes + 3) & ~3;
}

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

/** The pixel size of anything `copyExternalImageToTexture` accepts. The union
 *  spells its dimensions three different ways. */
function sourceSize(source: TexImageSource): { width: number; height: number } {
  const s = source as {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
    codedWidth?: number;
    codedHeight?: number;
  };
  const width = s.width ?? s.videoWidth ?? s.codedWidth ?? 1;
  const height = s.height ?? s.videoHeight ?? s.codedHeight ?? 1;
  return { width: Math.max(1, width), height: Math.max(1, height) };
}
