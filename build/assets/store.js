// ---------- Asset store implementation ----------
// Load images and JSON up front, then use them synchronously at runtime.
// `load()` RETURNS the composed resources keyed by your manifest keys, so you
// hold real references and never look anything up by string:
//
//   const Assets = createAssets(app);
//   const { hero, terrain, level } = await Assets.load({
//     hero: {
//       src: "hero.png",
//       aseprite: "hero.json",                              // → tagged Aseprite sheet
//     },
//     terrain: "terrain.png",                               // → HTMLImageElement
//     level:   "level1.json",                               // → parsed JSON
//   });
//   const anim = Animation.play(hero, "idle");  ctx.drawImage(terrain, x, y);
//
// The raw image/JSON is also cached by name, so the string-lookup style still
// works (`Assets.image("terrain")`) — handy for loading in stages. Draw a
// loading bar straight from the live progress, no callback wiring:
//
//   if (Assets.loading) UI.bar(x, y, w, h, Assets.progress);
import { fromGrid as animFromGrid, } from "../anim/index.js";
import { sheet as asepriteSheet, } from "../aseprite/index.js";
import { tint as tintSprite } from "../sprites/raster.js";
import { parseObj } from "../render3d/obj.js";
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const OBJ_EXT = /\.obj$/i;
const JSON_EXT = /\.(json|tmj|tsj|ldtk|ldtkl)$/i;
const AUDIO_EXT = /\.(ogg|mp3|wav|m4a)$/i;
function specSrc(spec) {
    return typeof spec === "string" ? spec : spec.src;
}
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.addEventListener("load", () => resolve(img), { once: true });
        img.addEventListener("error", () => reject(new Error(`createAssets: failed to load image "${url}"`)), { once: true });
        img.src = url;
    });
}
async function loadAudio(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`createAssets: failed to load audio "${url}" (${res.status})`);
    }
    return res.arrayBuffer();
}
async function loadJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`createAssets: failed to load JSON "${url}" (${res.status})`);
    }
    return res.json();
}
async function loadObj(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`createAssets: failed to load OBJ "${url}" (${res.status})`);
    }
    return parseObj(await res.text());
}
function loadOne(url) {
    // Bundlers inline small assets as `data:` URIs (e.g. Vite under
    // `assetsInlineLimit`), which carry a MIME type instead of a file extension —
    // so `new URL("./x.png", import.meta.url)` can resolve to `data:image/png;…`.
    // Route those by MIME so a build-inlined asset loads exactly like its on-disk
    // `.png`/`.json`/`.ogg` form (this is why samples that work in `vite` dev
    // could 'fail to load' once built). `fetch` handles `data:` URIs too.
    if (url.startsWith("data:")) {
        if (/^data:image\//i.test(url))
            return loadImage(url);
        if (/^data:application\/json/i.test(url))
            return loadJson(url);
        if (/^data:audio\//i.test(url))
            return loadAudio(url);
        if (/^data:(?:text\/plain|model\/obj)/i.test(url))
            return loadObj(url);
        return loadImage(url); // unknown MIME: images are the common inlined case
    }
    if (IMAGE_EXT.test(url))
        return loadImage(url);
    if (OBJ_EXT.test(url))
        return loadObj(url);
    if (JSON_EXT.test(url))
        return loadJson(url);
    if (AUDIO_EXT.test(url))
        return loadAudio(url);
    return Promise.reject(new Error(`createAssets: unknown asset type for "${url}" (expected image, OBJ, JSON map, or audio)`));
}
// Build the composed resource a spec asks for from its raw (cached) asset.
function compose(spec, raw) {
    if (typeof spec === "string")
        return raw;
    if ("aseprite" in spec) {
        const source = raw;
        return asepriteSheet(source.image, source.data);
    }
    if ("sheet" in spec)
        return animFromGrid(raw, spec.sheet);
    if ("tint" in spec)
        return tintSprite(raw, spec.tint);
    return raw;
}
async function loadSpec(spec) {
    if (typeof spec !== "string" && "aseprite" in spec) {
        const [image, data] = await Promise.all([
            loadOne(spec.src),
            typeof spec.aseprite === "string" ? loadJson(spec.aseprite) : spec.aseprite,
        ]);
        const raw = { image: image, data: data };
        return { raw, cached: image };
    }
    const raw = await loadOne(specSrc(spec));
    return { raw, cached: raw };
}
/** Create a standalone cache when no app lifecycle should own it. */
export function createAssetStore() {
    const cache = new Map();
    // Aggregate progress across concurrent/staged loads: reset once everything
    // in flight has settled, so `progress` reads 1 and `loading` reads false.
    let pending = 0;
    let completed = 0;
    const store = {
        async load(manifest, onProgress) {
            const names = Object.keys(manifest);
            pending += names.length;
            const total = names.length;
            let loaded = 0;
            const result = {};
            // allSettled so every item finishes before we touch the shared counters —
            // a rejected asset must still count as "settled" or `loading` would stick.
            const settled = await Promise.allSettled(names.map(async (name) => {
                try {
                    const { raw, cached } = await loadSpec(manifest[name]);
                    cache.set(name, cached);
                    result[name] = compose(manifest[name], raw);
                    loaded++;
                    onProgress?.(loaded, total);
                }
                finally {
                    completed++; // counts every settle (success or failure)
                }
            }));
            // The last in-flight load to finish zeroes the aggregate counters.
            if (completed >= pending) {
                pending = 0;
                completed = 0;
            }
            const failure = settled.find((s) => s.status === "rejected");
            if (failure)
                throw failure.reason;
            return result;
        },
        get(name) {
            if (!cache.has(name)) {
                throw new Error(`createAssets: "${name}" is not loaded (call load() first)`);
            }
            return cache.get(name);
        },
        image(name) {
            const a = store.get(name);
            if (!(a instanceof HTMLImageElement)) {
                throw new Error(`createAssets: "${name}" is not an image`);
            }
            return a;
        },
        json(name) {
            return store.get(name);
        },
        has(name) {
            return cache.has(name);
        },
        clear() {
            cache.clear();
        },
        get progress() {
            return pending === 0 ? 1 : completed / pending;
        },
        get loading() {
            return pending > 0;
        },
    };
    return store;
}
