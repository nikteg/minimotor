import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The samples live inside the engine package (packages/minimotor/samples) and
// serve as the showcase for the public API. Vite's root is the samples folder,
// so the gallery is at "/" and each game at "/<game>/". Game code imports the
// engine by its package name — `import { Minimotor } from "minimotor"` — which
// resolves via the alias below to the compiled build output, exactly matching
// what an external consumer writes.
export default defineConfig({
  root: here("./samples"),
  resolve: { alias: { minimotor: here("./build/index.js") } },
  // Don't pre-bundle the engine so edits to its build output show up without
  // clearing Vite's dep cache.
  optimizeDeps: { exclude: ["minimotor"] },
  server: { port: 8765, strictPort: true },
  preview: { port: 8765, strictPort: true },
  build: {
    target: "es2020",
    outDir: here("./samples-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: here("./samples/index.html"),
        scenes: here("./samples/scenes/index.html"),
        sprites: here("./samples/sprites/index.html"),
        minimal: here("./samples/minimal/index.html"),
        bounce: here("./samples/bounce/index.html"),
        breakout: here("./samples/breakout/index.html"),
        snake: here("./samples/snake/index.html"),
        platformer: here("./samples/platformer/index.html"),
        particles: here("./samples/particles/index.html"),
        tiles: here("./samples/tiles/index.html"),
        juice: here("./samples/juice/index.html"),
        swept: here("./samples/swept/index.html"),
        netpeer: here("./samples/netpeer/index.html"),
        netws: here("./samples/netws/index.html"),
        synth: here("./samples/synth/index.html"),
      },
    },
  },
});
