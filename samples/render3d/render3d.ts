// Hardware-accelerated 3D, living inside the 2D immediate-mode UI.
//
// The thing to notice is that the 3D views are WIDGETS. They auto-flow inside
// panels and rows, they clip and scroll with their container, a modal covers
// them, and six of them sit inside a scrolling list beside the hero view — none
// of which a stacked GL canvas under the UI could do. `UI.viewport3d` renders
// the scene into the renderer's own canvas at exactly the widget's device-pixel
// size and blits it in with a single `drawImage`.
//
// One renderer serves every viewport on the page. It is resized and re-rendered
// per widget per frame, which is why the stats line reports draw calls for the
// LAST viewport drawn rather than for the whole frame — and why switching the
// backend at runtime is one variable, not a rebuild.
import { createUI } from "minimotor/ui";
import { createApp } from "minimotor";
import { createDebug } from "minimotor/debug";
import { createAssets } from "minimotor/assets";
import type { Flow } from "minimotor/ui";
import {
  addNode,
  box,
  bounds,
  computeNormals,
  createCamera,
  createClip,
  createRenderer3D,
  createScene,
  createUiSurface,
  frameMesh,
  isWebGPUAvailable,
  mergeMeshes,
  node,
  plane,
  updateWorldMatrices,
  sampleClip,
  sphere,
  spinTrack,
  torus,
  type Backend3D,
  type Clip,
  type MeshData,
  type Renderer3D,
  type Scene3D,
} from "minimotor/3d";

const game = createApp("game", { background: "#0e1017" });
let renderer: Renderer3D | null = null;
// Keep the monitor compact: the default vertical HUD would cover the backend
// switch in this sample's header. Its draw line includes every viewport
// renders and the 2D UI, which makes the backend difference easy to compare.
const Debug = createDebug(game, {
  initial: "performance",
  perf: {
    layout: "horizontal",
    graphs: true,
  },
});
const view = game.viewport;
const { Draw, Loop, Pointer } = game;
const UI = createUI(game);
const Assets = createAssets(game);

// ---- the catalog -----------------------------------------------------------
// One list, used twice: it fills the inventory strip AND supplies the hero
// shape. Clicking a row is the only way to change what the showcase holds, so
// the two views can never disagree about what is selected.

interface Item {
  name: string;
  mesh: MeshData;
  color: [number, number, number, number];
  texture?: HTMLImageElement;
  note: string;
}

const items: Item[] = [
  {
    name: "Torus",
    mesh: torus(0.42, 0.16, 40, 22),
    color: [0.95, 0.55, 0.22, 1],
    note: "swept circle",
  },
  { name: "Sphere", mesh: sphere(0.5, 32, 22), color: [0.42, 0.65, 1, 1], note: "UV sphere" },
  {
    name: "Cluster",
    // A merged mesh is still ONE draw call — the reason `mergeMeshes` exists.
    mesh: computeNormals(
      mergeMeshes([
        translated(box(0.45), 0, 0, 0),
        translated(sphere(0.28, 20, 14), 0.4, 0.3, 0.15),
        translated(sphere(0.2, 18, 12), -0.35, -0.15, 0.3),
      ]),
    ),
    color: [0.4, 0.85, 0.62, 1],
    note: "3 meshes, 1 draw",
  },
];

let selected = 0;
let objError: string | null = null;

/** A tiny scene per inventory row — same renderer, same widget, 56px tall. */
const itemScenes: Scene3D[] = [];
function createItemScene(item: Item): Scene3D {
  const scene = createScene({ ambient: [0.35, 0.36, 0.42] });
  addNode(
    scene,
    node({
      mesh: item.mesh,
      material: {
        color: item.color,
        texture: item.texture,
        pixelated: false,
        shininess: 40,
        specular: 0.3,
      },
    }),
  );
  return scene;
}
for (const item of items) itemScenes.push(createItemScene(item));
const itemCamera = createCamera({ distance: 1.9, pitch: 0.5, yaw: 0.6 });

// Kenney's Food Kit is CC0 and ships a shared atlas plus standard OBJ files.
// Poly Haven's CC0 models are denser, textured meshes converted to OBJ+MTL
// locally from their glTF downloads. The asset store turns each OBJ into the
// same MeshData used by primitives; the sample supplies each diffuse map
// explicitly because the importer deliberately keeps MTL parsing out of the
// core loader.
const foodAsset = (name: string): string =>
  new URL(`./assets/kenney-food-kit/${name}`, import.meta.url).href;
const foodModel = (name: string): `${string}.obj` => foodAsset(`${name}.obj`) as `${string}.obj`;
const polyhavenAsset = (name: string): string =>
  new URL(`./assets/polyhaven-high-poly/${name}`, import.meta.url).href;
const polyhavenModel = (name: string): `${string}.obj` =>
  polyhavenAsset(`${name}.obj`) as `${string}.obj`;
void Assets.load({
  foodAtlas: foodAsset("colormap.png"),
  apple: foodModel("apple"),
  banana: foodModel("banana"),
  broccoli: foodModel("broccoli"),
  burger: foodModel("burger"),
  cake: foodModel("cake"),
  bananas: polyhavenModel("bananas"),
  bananasTexture: polyhavenAsset("bananas_diff_1k.jpg"),
  carrotCake: polyhavenModel("carrot_cake"),
  carrotCakeTexture: polyhavenAsset("carrot_cake_diff_1k.jpg"),
  dirtyFootball: polyhavenModel("dirty_football"),
  dirtyFootballTexture: polyhavenAsset("dirty_football_diff_1k.jpg"),
})
  .then(
    ({
      foodAtlas,
      apple,
      banana,
      broccoli,
      burger,
      cake,
      bananas,
      bananasTexture,
      carrotCake,
      carrotCakeTexture,
      dirtyFootball,
      dirtyFootballTexture,
    }) => {
      const textured = [
        { name: "Apple", mesh: apple, texture: foodAtlas, note: "Kenney OBJ · textured" },
        { name: "Banana", mesh: banana, texture: foodAtlas, note: "Kenney OBJ · textured" },
        { name: "Broccoli", mesh: broccoli, texture: foodAtlas, note: "Kenney OBJ · textured" },
        { name: "Burger", mesh: burger, texture: foodAtlas, note: "Kenney OBJ · textured" },
        { name: "Cake", mesh: cake, texture: foodAtlas, note: "Kenney OBJ · textured" },
        {
          name: "Bananas · high poly",
          mesh: bananas,
          texture: bananasTexture,
          note: "Poly Haven OBJ · 46,868 tris",
        },
        {
          name: "Carrot Cake · high poly",
          mesh: carrotCake,
          texture: carrotCakeTexture,
          note: "Poly Haven OBJ · 13,790 tris",
        },
        {
          name: "Dirty Football · high poly",
          mesh: dirtyFootball,
          texture: dirtyFootballTexture,
          note: "Poly Haven OBJ · 19,998 tris",
        },
      ];
      for (const loaded of textured) {
        const item: Item = {
          name: loaded.name,
          mesh: normalizeMesh(loaded.mesh),
          color: [1, 1, 1, 1],
          texture: loaded.texture,
          note: loaded.note,
        };
        items.push(item);
        itemScenes.push(createItemScene(item));
      }
    },
  )
  .catch((error: unknown) => {
    objError = error instanceof Error ? error.message : String(error);
  });

// ---- the hero scene --------------------------------------------------------

const scene = createScene({
  ambient: [0.28, 0.3, 0.38],
  lights: [
    { direction: { x: -0.5, y: -1, z: -0.4 }, color: [1, 0.96, 0.9], intensity: 1.05 },
    // A dim fill from the opposite side keeps the shadowed half readable
    // without washing out the key light's shape.
    { direction: { x: 0.8, y: -0.2, z: 0.6 }, color: [0.4, 0.55, 0.9], intensity: 0.45 },
  ],
});
const pivot = addNode(scene, node({ name: "pivot" }));
const heroNode = addNode(
  scene,
  node({
    name: "shape",
    mesh: items[selected].mesh,
    parent: pivot,
    position: { x: 0, y: 0.05, z: 0 },
    material: { color: items[selected].color, shininess: 48, specular: 0.35 },
  }),
);
const camera = createCamera({ distance: 2.6, pitch: 0.35, yaw: 0.7 });
const spin: Clip = createClip("spin", [spinTrack(pivot, 6)]);

// A ground plane, only used by the "Ground" toggle, to show that the same
// scene array can gain and lose nodes between frames.
const ground = node({
  name: "ground",
  mesh: plane(6, 6, 1),
  position: { x: 0, y: -0.56, z: 0 },
  material: { color: [0.1, 0.11, 0.16, 1], doubleSided: true },
});

// ---- a UI panel living IN the scene ---------------------------------------
// The opposite direction from the viewport: this is the ordinary 2D UI drawn
// into an offscreen canvas, uploaded as a texture, and hung on a quad in world
// space. It is a real UI — the buttons below are hit-tested by casting the
// pointer's ray at the quad — and the spinning shape passes IN FRONT of it,
// which nothing blitted into the UI layer could do.
const surface = createUiSurface({
  app: game,
  width: 260,
  height: 150,
  worldWidth: 1.5,
  background: "rgba(12,16,28,0.86)",
});
const surfaceNode = addNode(
  scene,
  node({
    name: "wall-panel",
    mesh: surface.mesh,
    material: surface.material,
    // Behind and above the model, facing the viewer.
    position: { x: 0, y: 0.45, z: -0.95 },
  }),
);

let hologramHits = 0;
/** Tint applied over the selected item's own colour, from the world-space
 *  panel's swatches. Null means "the item's colour, untouched". */
let tint: [number, number, number, number] | null = null;

// ---- the renderer, and switching it at runtime -----------------------------
// A backend is one object behind one interface, so swapping it is: build the
// new one, drop the old one, point the variable at it. Nothing that references
// `renderer` — every viewport on this screen — has to know it happened.
// The meshes and textures re-upload lazily on first sight in the new context.

let rendererError: string | null = null;
let switching = false;
// Synchronous: it only proves `navigator.gpu` exists, not that an adapter can
// be had — which is exactly the right question for whether to OFFER the button.
const webgpuOk = isWebGPUAvailable();

function backendFromUrl(): Backend3D | "auto" {
  const value = new URL(location.href).searchParams.get("backend");
  return value === "webgl2" || value === "webgpu" ? value : "auto";
}

function writeBackendToUrl(backend: Backend3D): void {
  const url = new URL(location.href);
  url.searchParams.set("backend", backend);
  history.replaceState(null, "", url);
}

async function useBackend(want: Backend3D | "auto"): Promise<void> {
  if (switching) return;
  switching = true;
  const previous = renderer;
  try {
    // Keep the WebGL comparison honest: WebGPU currently has no MSAA path in
    // this renderer, and the sample blits immediately in the same JS frame.
    const next = await createRenderer3D({
      antialias: false,
      preserveDrawingBuffer: false,
      gpuTiming: true,
      backend: want,
    });
    renderer = next;
    Debug.set3dRenderer(next);
    if (want !== "auto") writeBackendToUrl(want);
    rendererError = null;
    // Disposed only AFTER the replacement exists: a failed switch must leave
    // the sample running on the backend it already had, not on nothing.
    previous?.dispose();
  } catch (err: unknown) {
    rendererError = err instanceof Error ? err.message : String(err);
  } finally {
    switching = false;
  }
}

// WebGPU cannot be probed synchronously, so the app starts drawing immediately
// and the viewports report "starting the GPU" for the frame or two it takes.
void useBackend(backendFromUrl());

// ---- state -----------------------------------------------------------------

let animating = true;
let orthographic = false;
let showGround = false;
let clock = 0;
let listOffset = 0;

// ---- frame -----------------------------------------------------------------

Loop.run({
  update() {
    // The fixed step is the time unit — read it rather than assuming 60Hz.
    if (animating) clock += Loop.step / 1000;
    sampleClip(scene, spin, clock);
    camera.orthographic = orthographic;
    // Rebuilt rather than toggled with `hidden`, to keep the sample honest
    // about a scene whose node list changes shape between frames.
    const hasGround = scene.nodes.includes(ground);
    if (showGround && !hasGround) scene.nodes.push(ground);
    if (!showGround && hasGround) scene.nodes.splice(scene.nodes.indexOf(ground), 1);
    // Each inventory row turns at its own rate so the strip reads as live
    // views rather than one duplicated eight times.
    itemScenes.forEach((s, i) => {
      s.nodes[0].rotation = yaw(clock * (0.4 + i * 0.11) + i);
    });
  },

  draw() {
    drawHeader();

    // One panel, the whole window. The inventory is a column INSIDE it rather
    // than a second panel beside it: the two belong to one another, and giving
    // the hero view every pixel that is not the strip is the point.
    UI.panel({ x: 24, y: 76, w: view.w - 48, h: view.h - 116, title: "SHOWCASE" }, (body) => {
      if (!renderer) {
        UI.text(rendererError ?? "starting the GPU…", { ...body.fill(), align: "center" });
        return;
      }
      const area = body.fill();
      // The stage's width is computed rather than `flex: "fill"`, because the
      // flow is a single pass with a cursor: `fill` means "everything left AT
      // THIS POINT", so a filling child placed BEFORE a fixed-width sibling
      // takes the sibling's space too. Either put the fixed one first — which
      // would put the inventory on the left — or do the subtraction.
      const INVENTORY_W = 360;
      const GAP = 14;
      // Both columns take an explicit HEIGHT as well. A col nested in a row
      // auto-measures its own height from its children, so a child calling
      // `fill()` inside it has nothing to fill against — and the two grow each
      // other a little more every frame. Pinning the cross axis is the
      // documented fix (`AGENTS.md`, "children that FILL a deferred cross
      // axis"), and here it is also just true: both columns are exactly as tall
      // as the panel body.
      UI.row({ ...area, gap: GAP }, () => {
        UI.col({ w: area.w - INVENTORY_W - GAP, h: area.h, gap: 8 }, drawStage);
        UI.col({ w: INVENTORY_W, h: area.h, gap: 6 }, drawInventory);
      });
    });

    Draw.text(`${Loop.timings.drawMs.toFixed(1)} ms draw`, {
      x: view.w - 100,
      y: view.h - 28,
      color: "#5b6478",
      size: 12,
    });
  },
});

// ---- header ----------------------------------------------------------------

function drawHeader(): void {
  UI.text("MINIMOTOR 3D", { x: 24, y: 20, size: 22, bold: true });
  // `color` takes a CSS colour or one of the two theme ROLES `resolveColor`
  // knows, "dim" and "accent" — "danger" is not one of them and lands as an
  // invalid `fillStyle`, which the canvas ignores, so the line silently draws
  // in whatever colour was last set. Hence the literal.
  UI.text(
    rendererError ??
      (renderer
        ? `${renderer.backend} · ${renderer.stats.drawCalls} draws · ${renderer.stats.triangles.toLocaleString()} tris (last viewport)`
        : "starting the GPU…"),
    { x: 24, y: 48, size: 12, color: rendererError ? "#f0603a" : "dim" },
  );

  // The backend switch. WebGPU is offered only when the browser actually has
  // it — a button that always fails teaches nothing — and the tooltip says why
  // when it is missing.
  UI.row({ x: view.w / 2 - 130, y: 26, w: 260, gap: 6, justify: "center" }, () => {
    UI.text("BACKEND", { size: 11, color: "dim", bold: true });
    for (const backend of ["webgl2", "webgpu"] as const) {
      const on = renderer?.backend === backend;
      const missing = backend === "webgpu" && !webgpuOk;
      if (
        UI.button({
          label: backend,
          w: 78,
          disabled: switching || missing,
          tooltip: missing ? "this browser has no WebGPU" : undefined,
          bg: on ? "#2c3550" : undefined,
          color: on ? "#8be0d0" : undefined,
        })
      ) {
        void useBackend(backend);
      }
    }
  });
}

// ---- the hero view ---------------------------------------------------------

function drawStage(flow: Flow): void {
  // Controls ABOVE the viewport, so the eye lands on the model rather than
  // reading a strip of chrome first.
  UI.row({ gap: 10, fitCross: true, alignCross: "center" }, () => {
    animating = UI.toggle("Animate", animating);
    orthographic = UI.toggle("Orthographic", orthographic);
    showGround = UI.toggle("Ground plane", showGround);
    // `frameMesh` recentres the camera's target on the mesh's bounds and backs
    // off far enough to see all of it — "Recenter" rather than "Frame", which
    // read like a rendering mode.
    if (UI.button({ label: "Recenter", w: 96, tooltip: "re-fit the camera on the model" })) {
      frameMesh(camera, items[selected].mesh, 1.6);
    }
  });

  // Everything left after the control row, minus the caption line below.
  const stage = flow.fill(22);

  // The world-space panel is drawn BEFORE the viewport, because it has to be a
  // finished texture by the time the scene renders. Its pointer comes from
  // last frame's stage rect — one frame stale, and invisible at pointer speeds.
  updateWorldMatrices(scene);
  surface.draw(
    {
      model: scene.nodes[surfaceNode].world!,
      camera,
      pointer: {
        // The app pointer, in screen-logical coords — the same space the widget
        // rects are in here, since this sample uses no `UI.scaled`.
        x: Pointer.x - stage.x,
        y: Pointer.y - stage.y,
        viewW: stage.w,
        viewH: stage.h,
      },
    },
    () =>
      // An idScope keeps these widgets' ids from colliding with the
      // identically-shaped ones on the screen UI.
      UI.idScope("hologram", () => {
        UI.text("SYSTEM PANEL", { x: 12, y: 10, size: 13, bold: true, color: "accent" });
        UI.text(`interactions: ${hologramHits}`, { x: 12, y: 34, size: 11, color: "dim" });
        UI.row({ x: 12, y: 56, w: 236, gap: 8 }, () => {
          for (const [label, rgb] of SWATCHES) {
            if (UI.button({ label, w: 68, tabIndex: -1 })) {
              tint = rgb;
              hologramHits++;
            }
          }
        });
        UI.text("a real UI, on a quad, in the scene", { x: 12, y: 112, size: 10, color: "dim" });
      }),
  );

  scene.nodes[heroNode].material = {
    ...scene.nodes[heroNode].material,
    color: tint ?? items[selected].color,
    texture: items[selected].texture,
    pixelated: false,
  };

  UI.viewport3d({
    ...stage,
    id: "showcase",
    renderer: renderer!,
    scene,
    camera,
    interactive: true,
    background: "#080a10",
  });
  UI.text("drag to orbit · wheel or two-finger swipe to zoom", {
    size: 11,
    color: "dim",
    align: "center",
  });
}

// ---- the inventory strip ---------------------------------------------------

function drawInventory(flow: Flow): void {
  UI.text("INVENTORY", { size: 11, bold: true, color: "accent" });
  UI.text("click to load into the stage", { size: 10, color: "dim" });
  if (objError) UI.text(`OBJ error: ${objError}`, { size: 10, color: "#f0603a" });
  else if (items.length === 3) UI.text("loading textured OBJ meshes…", { size: 10, color: "dim" });
  const area = flow.fill();
  listOffset = UI.list(
    { ...area, rowH: 64, gap: 4, count: items.length, offset: listOffset, id: "inventory" },
    (i, r) => {
      // The row background first: `listItem` paints hover/selected states and
      // reports the click, then the content draws on top of it.
      if (UI.listItem({ ...r, id: `item-${i}`, selected: i === selected })) {
        selected = i;
        // The node holds a reference to the mesh; swapping the reference is the
        // whole update. The renderer's weak cache uploads the new mesh on first
        // sight and drops the old one when nothing holds it.
        scene.nodes[heroNode].mesh = items[i].mesh;
        scene.nodes[heroNode].material = {
          ...scene.nodes[heroNode].material,
          texture: items[i].texture,
          color: items[i].color,
          pixelated: false,
        };
        // A new item brings its own colour — the swatch tint is a decision
        // about the PREVIOUS shape and should not outlive it.
        tint = null;
      }
      UI.row({ x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8, gap: 8 }, () => {
        UI.viewport3d({
          w: 56,
          h: 56,
          id: `preview-${i}`,
          renderer: renderer!,
          scene: itemScenes[i],
          camera: itemCamera,
          background: "#0b0d14",
        });
        UI.col({ gap: 2, flex: "fill" }, () => {
          UI.text(items[i].name, { size: 12, bold: true });
          UI.text(`${items[i].note} · ${(items[i].mesh.indices.length / 3) | 0} tris`, {
            size: 10,
            color: "dim",
          });
        });
      });
    },
  );
}

const SWATCHES: [string, [number, number, number, number]][] = [
  ["Amber", [0.95, 0.55, 0.22, 1]],
  ["Jade", [0.3, 0.85, 0.55, 1]],
  ["Violet", [0.66, 0.42, 0.95, 1]],
];

// ---- small helpers ---------------------------------------------------------

/** A yaw-only quaternion, allocated fresh because the scene keeps it. */
function yaw(angle: number) {
  const half = angle / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

/** Move every vertex of a mesh — `mergeMeshes` has no transform argument, so
 *  a cluster positions its parts before merging. */
function translated(mesh: MeshData, dx: number, dy: number, dz: number): MeshData {
  for (let i = 0; i < mesh.positions.length; i += 3) {
    mesh.positions[i] += dx;
    mesh.positions[i + 1] += dy;
    mesh.positions[i + 2] += dz;
  }
  return mesh;
}

/** Food Kit models use different authored sizes. Fit them to the same preview
 *  volume while preserving their UVs, normals, and the original mesh object. */
function normalizeMesh(mesh: MeshData, size = 0.9): MeshData {
  const { min, max } = bounds(mesh);
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const cz = (min.z + max.z) / 2;
  const extent = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.000001);
  const scale = size / extent;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    mesh.positions[i] = (mesh.positions[i] - cx) * scale;
    mesh.positions[i + 1] = (mesh.positions[i + 1] - cy) * scale;
    mesh.positions[i + 2] = (mesh.positions[i + 2] - cz) * scale;
  }
  return mesh;
}
