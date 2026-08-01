import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [sourceDir, outputDir] = process.argv.slice(2);
if (!sourceDir || !outputDir) {
  throw new Error("usage: node tools/pack-kenney-ui-atlas.mjs <PNG-dir> <output-dir>");
}

const files = [];
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) files.push(path);
  }
}
visit(sourceDir);

const sizeOf = (path) => {
  const text = execFileSync("magick", ["identify", "-format", "%w %h", path], { encoding: "utf8" });
  const [w, h] = text.trim().split(/\s+/).map(Number);
  return { w, h };
};

// A deterministic shelf pack keeps the atlas inspectable while retaining every
// source pixel at native size. Four transparent pixels between entries make it
// safe to sample any region with nearest-neighbour filtering.
const atlasW = 2048;
const gap = 4;
let x = gap;
let y = gap;
let rowH = 0;
const regions = {};
const placements = [];
for (const path of files) {
  const { w, h } = sizeOf(path);
  if (w + gap * 2 > atlasW) throw new Error(`asset is wider than atlas: ${path}`);
  if (x + w + gap > atlasW) {
    x = gap;
    y += rowH + gap;
    rowH = 0;
  }
  const key = relative(sourceDir, path).split("\\").join("/");
  regions[key] = { x, y, w, h };
  placements.push({ path, x, y });
  x += w + gap;
  rowH = Math.max(rowH, h);
}
const atlasH = y + rowH + gap;
mkdirSync(outputDir, { recursive: true });

const args = ["-size", `${atlasW}x${atlasH}`, "xc:none", "-gravity", "northwest"];
for (const placement of placements) {
  args.push(placement.path, "-geometry", `+${placement.x}+${placement.y}`, "-composite");
}
args.push(join(outputDir, "atlas.png"));
execFileSync("magick", args, { stdio: "inherit" });

writeFileSync(
  join(outputDir, "atlas.json"),
  `${JSON.stringify(
    {
      image: "atlas.png",
      size: { w: atlasW, h: atlasH },
      source: "Kenney UI Pack (PNG), CC0",
      count: files.length,
      gap,
      regions,
    },
    null,
    2,
  )}\n`,
);

console.log(`packed ${files.length} PNGs into ${atlasW}x${atlasH}`);
