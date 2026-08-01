// Hardware-accelerated 3D, living inside the 2D immediate-mode UI.
//
// The thing to notice is that the 3D views are WIDGETS. They auto-flow inside
// panels and rows, they clip and scroll with their container, a modal covers
// them, and one of them sits inside a scrolling list — none of which a stacked
// GL canvas under the UI could do. `UI.viewport3d` renders the scene into the
// renderer's own canvas at exactly the widget's device-pixel size and blits it
// in with a single `drawImage`.
//
// One renderer serves every viewport on the page. It is resized and re-rendered
// per widget per frame, which is why the stats panel reports draw calls for the
// LAST viewport drawn rather than for the whole frame.
import { createUI } from "minimotor/ui";
import { createApp } from "minimotor";
import {
  addNode,
  box,
  computeNormals,
  createCamera,
  createClip,
  createRenderer3D,
  createScene,
  createUiSurface,
  cylinder,
  frameMesh,
  mergeMeshes,
  node,
  plane,
  updateWorldMatrices,
  sampleClip,
  sphere,
  spinTrack,
  torus,
  type Clip,
  type MeshData,
  type Renderer3D,
  type Scene3D,
} from "minimotor/3d";

const game = createApp("game", { background: "#0e1017" });
const view = game.viewport;
const { Draw, Loop, Pointer } = game;
const UI = createUI(game);

// ---- the scenes ------------------------------------------------------------

/** The hero scene: a lit plinth with a spinning shape on it. */
function createShowcase(shape: MeshData, color: [number, number, number, number]) {
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
  addNode(
    scene,
    node({
      name: "shape",
      mesh: shape,
      parent: pivot,
      position: { x: 0, y: 0.05, z: 0 },
      material: { color, shininess: 48, specular: 0.35 },
    }),
  );
  addNode(
    scene,
    node({
      name: "plinth",
      mesh: cylinder(0.62, 0.1, 40),
      position: { x: 0, y: -0.45, z: 0 },
      material: { color: [0.16, 0.18, 0.25, 1], shininess: 24, specular: 0.12 },
    }),
  );
  return { scene, pivot };
}

const shapes: Record<string, MeshData> = {
  Torus: torus(0.42, 0.16, 40, 22),
  Sphere: sphere(0.5, 32, 22),
  Cube: box(0.8),
  Cone: cylinder(0.5, 0.9, 32, 0),
  // A merged mesh is still ONE draw call — the reason `mergeMeshes` exists.
  Cluster: computeNormals(
    mergeMeshes([
      translated(box(0.45), 0, 0, 0),
      translated(sphere(0.28, 20, 14), 0.4, 0.3, 0.15),
      translated(sphere(0.2, 18, 12), -0.35, -0.15, 0.3),
    ]),
  ),
};
const shapeNames = Object.keys(shapes);
let shapeName = "Torus";

const showcase = createShowcase(shapes[shapeName], [0.95, 0.55, 0.22, 1]);
const showcaseCamera = createCamera({ distance: 2.6, pitch: 0.35, yaw: 0.7 });
const spin: Clip = createClip("spin", [spinTrack(showcase.pivot, 6)]);

/** A tiny scene per inventory row — same renderer, same widget, 64px tall. */
const inventory = [
  { name: "Iron Cube", mesh: box(0.7), color: [0.72, 0.76, 0.82, 1] as const },
  { name: "Mana Orb", mesh: sphere(0.42, 24, 16), color: [0.42, 0.65, 1, 1] as const },
  { name: "Ring of Haste", mesh: torus(0.36, 0.11, 28, 14), color: [0.95, 0.82, 0.3, 1] as const },
  { name: "Spire", mesh: cylinder(0.32, 0.85, 20, 0), color: [0.72, 0.4, 0.9, 1] as const },
  { name: "Flat Stone", mesh: box(0.8, 0.16, 0.6), color: [0.5, 0.55, 0.55, 1] as const },
  { name: "Gear", mesh: torus(0.34, 0.18, 10, 8), color: [0.85, 0.5, 0.35, 1] as const },
];
const itemScenes: Scene3D[] = inventory.map((item) => {
  const scene = createScene({ ambient: [0.35, 0.36, 0.42] });
  addNode(
    scene,
    node({ mesh: item.mesh, material: { color: item.color, shininess: 40, specular: 0.3 } }),
  );
  return scene;
});
const itemCamera = createCamera({ distance: 1.9, pitch: 0.5, yaw: 0.6 });

// ---- a UI panel living IN the scene ---------------------------------------
// The opposite direction from the viewport: this is the ordinary 2D UI drawn
// into an offscreen canvas, uploaded as a texture, and hung on a quad in world
// space. It is a real UI — the buttons below are hit-tested by casting the
// pointer's ray at the quad — and the spinning shape passes IN FRONT of it,
// which nothing blitted into the UI layer could do.
const surface = createUiSurface({
  width: 260,
  height: 150,
  worldWidth: 1.5,
  background: "rgba(12,16,28,0.86)",
});
let surfaceNode = -1;
let hologramHits = 0;
let hologramColor: [number, number, number, number] = [0.95, 0.55, 0.22, 1];

// A ground plane, only used by the "environment" toggle, to show that the
// same scene array can gain and lose nodes between frames.
const ground = node({
  name: "ground",
  mesh: plane(6, 6, 1),
  position: { x: 0, y: -0.56, z: 0 },
  material: { color: [0.1, 0.11, 0.16, 1], doubleSided: true },
});

// ---- state -----------------------------------------------------------------

// Placed behind and above the plinth, tilted toward the viewer.
surfaceNode = addNode(
  showcase.scene,
  node({
    name: "wall-panel",
    mesh: surface.mesh,
    material: surface.material,
    position: { x: 0, y: 0.45, z: -0.95 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  }),
);

let renderer: Renderer3D | null = null;
let rendererError: string | null = null;
let animating = true;
let orthographic = false;
let showGround = false;
let clock = 0;

// WebGPU cannot be probed synchronously, so the app starts drawing immediately
// and the viewports report "starting the GPU" for the frame or two it takes.
void createRenderer3D({ antialias: true })
  .then((r: Renderer3D) => {
    renderer = r;
  })
  .catch((err: unknown) => {
    rendererError = err instanceof Error ? err.message : String(err);
  });

// ---- frame -----------------------------------------------------------------

Loop.run({
  update() {
    // The fixed step is the time unit — read it rather than assuming 60Hz.
    if (animating) clock += Loop.step / 1000;
    sampleClip(showcase.scene, spin, clock);
    showcaseCamera.orthographic = orthographic;
    // Rebuilt rather than toggled with `hidden`, to keep the sample honest
    // about a scene whose node list changes shape between frames.
    const hasGround = showcase.scene.nodes.includes(ground);
    if (showGround && !hasGround) showcase.scene.nodes.push(ground);
    if (!showGround && hasGround) {
      showcase.scene.nodes.splice(showcase.scene.nodes.indexOf(ground), 1);
    }
    // Each inventory row turns at its own rate so the list reads as six live
    // views rather than one duplicated six times.
    itemScenes.forEach((scene, i) => {
      scene.nodes[0].rotation = yaw(clock * (0.4 + i * 0.11) + i);
    });
  },

  draw() {
    UI.text("MINIMOTOR 3D", { x: 24, y: 20, size: 22, bold: true });
    UI.text(
      renderer
        ? `${renderer.backend} · ${renderer.stats.drawCalls} draws · ${renderer.stats.triangles.toLocaleString()} tris (last viewport)`
        : (rendererError ?? "starting the GPU…"),
      { x: 24, y: 48, size: 12, color: rendererError ? "danger" : "dim" },
    );

    const left = Math.min(560, view.w - 300);

    UI.panel({ x: 24, y: 72, w: left, h: view.h - 120, title: "SHOWCASE" }, (body) => {
      if (!renderer) {
        UI.text(rendererError ?? "starting the GPU…", { ...body.fill(), align: "center" });
        return;
      }
      // Fill what is left, reserving the two control rows plus the caption.
      const stage = body.fill(96);

      // The world-space panel is drawn BEFORE the viewport, because it has to
      // be a finished texture by the time the scene renders. Its pointer comes
      // from last frame's viewport rect — one frame stale, and invisible at
      // pointer speeds.
      updateWorldMatrices(showcase.scene);
      surface.draw(
        {
          model: showcase.scene.nodes[surfaceNode].world!,
          camera: showcaseCamera,
          pointer: {
            // The app pointer, in screen-logical coords — the same space the
            // widget rects are in here, since this sample uses no `UI.scaled`.
            x: Pointer.x - stage.x,
            y: Pointer.y - stage.y,
            viewW: stage.w,
            viewH: stage.h,
          },
        },
        () => {
          // An idScope keeps these widgets' ids from colliding with the
          // identically-shaped ones on the screen UI.
          UI.idScope("hologram", () => {
            UI.text("SYSTEM PANEL", { x: 12, y: 10, size: 13, bold: true, color: "accent" });
            UI.text(`interactions: ${hologramHits}`, { x: 12, y: 34, size: 11, color: "dim" });
            UI.row({ x: 12, y: 56, w: 236, gap: 8 }, () => {
              for (const [label, rgb] of SWATCHES) {
                if (UI.button({ label, w: 68 })) {
                  hologramColor = rgb;
                  hologramHits++;
                }
              }
            });
            UI.text("a real UI, on a quad, in the scene", {
              x: 12,
              y: 112,
              size: 10,
              color: "dim",
            });
          });
        },
      );
      showcase.scene.nodes[1].material = {
        ...showcase.scene.nodes[1].material,
        color: hologramColor,
      };

      UI.viewport3d({
        ...stage,
        id: "showcase",
        renderer,
        scene: showcase.scene,
        camera: showcaseCamera,
        interactive: true,
        background: "#080a10",
      });
      UI.text("drag to orbit · wheel to zoom", { size: 11, color: "dim", align: "center" });

      UI.row({ gap: 8 }, () => {
        for (const name of shapeNames) {
          const on = name === shapeName;
          if (
            UI.button({
              label: name,
              bg: on ? "#2c3550" : undefined,
              color: on ? "#e8ecf6" : undefined,
            })
          ) {
            shapeName = name;
            // The node holds a reference to the mesh; swapping the reference
            // is the whole update. The renderer's weak cache uploads the new
            // mesh on first sight and drops the old one when nothing holds it.
            showcase.scene.nodes[1].mesh = shapes[name];
          }
        }
      });
      UI.row({ gap: 8 }, () => {
        animating = UI.toggle({ label: "Animate", on: animating });
        orthographic = UI.toggle({ label: "Ortho", on: orthographic });
        showGround = UI.toggle({ label: "Ground", on: showGround });
        if (UI.button({ label: "Frame" })) frameMesh(showcaseCamera, shapes[shapeName], 1.6);
      });
    });

    const rightX = 24 + left + 16;
    const rightW = view.w - rightX - 24;
    if (rightW > 180) {
      UI.panel({ x: rightX, y: 72, w: rightW, h: view.h - 120, title: "INVENTORY" }, (body) => {
        if (!renderer) return;
        UI.text("Live previews inside a scrolling list.", { size: 11, color: "dim" });
        const area = body.fill();
        UI.list(
          { ...area, rowH: 72, gap: 6, count: inventory.length, offset: listOffset },
          (i, r) => {
            UI.row({ x: r.x, y: r.y, w: r.w, h: r.h, gap: 10 }, () => {
              UI.viewport3d({
                w: 64,
                h: 64,
                id: `item-${i}`,
                renderer: renderer!,
                scene: itemScenes[i],
                camera: itemCamera,
                background: "#0b0d14",
              });
              UI.col({ gap: 2 }, () => {
                UI.text(inventory[i].name, { size: 13, bold: true });
                UI.text(`${(inventory[i].mesh.indices.length / 3) | 0} triangles`, {
                  size: 11,
                  color: "dim",
                });
              });
            });
          },
        );
      });
    }

    Draw.text(`${Loop.timings.drawMs.toFixed(1)} ms draw`, {
      x: view.w - 100,
      y: view.h - 28,
      color: "#5b6478",
      size: 12,
    });
  },
});

let listOffset = 0;

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
