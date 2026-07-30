import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { defineFeature } from "../feature.js";
import { files, numberOption, takeFlag } from "../utils.js";

const help = `Validate game assets

Usage:
  mm assets check [directory] [options]

Options:
  --tile-size <px>  Require PNG dimensions to be tile-size multiples.
  --strict          Treat warnings as errors.
  --json            Print machine-readable JSON.
`;

export interface AssetIssue {
  level: "error" | "warning";
  file: string;
  message: string;
}

const pngSize = (data: Buffer): { w: number; h: number } | undefined =>
  data.length >= 24 && data.subarray(1, 4).toString() === "PNG"
    ? { w: data.readUInt32BE(16), h: data.readUInt32BE(20) }
    : undefined;

interface AsepriteData {
  frames?: unknown[] | Record<string, unknown>;
  meta?: {
    app?: unknown;
    image?: unknown;
    frameTags?: unknown[];
    layers?: unknown[];
    slices?: unknown[];
  };
}

const isAseprite = (data: AsepriteData): boolean =>
  !!data.frames &&
  (Array.isArray(data.meta?.frameTags) ||
    Array.isArray(data.meta?.slices) ||
    (typeof data.meta?.app === "string" && /aseprite/i.test(data.meta.app)));

const validateAseprite = (data: AsepriteData): string[] => {
  if (!isAseprite(data)) return [];
  const frames = Array.isArray(data.frames)
    ? data.frames
    : data.frames && typeof data.frames === "object"
      ? Object.values(data.frames)
      : [];
  const errors: string[] = [];
  if (frames.length === 0) errors.push("Aseprite atlas has no frames");
  frames.forEach((value, index) => {
    const frame = value as {
      frame?: { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
      duration?: unknown;
      rotated?: unknown;
      trimmed?: unknown;
      spriteSourceSize?: { x?: unknown; y?: unknown };
      sourceSize?: { w?: unknown; h?: unknown };
    };
    const geometry = frame.frame;
    if (
      !geometry ||
      ![geometry.x, geometry.y, geometry.w, geometry.h, frame.duration].every(
        (part) => typeof part === "number" && Number.isFinite(part),
      ) ||
      (geometry.w as number) <= 0 ||
      (geometry.h as number) <= 0 ||
      (frame.duration as number) <= 0
    ) {
      errors.push(`Aseprite frame ${index} has invalid geometry or duration`);
    }
    if (frame.rotated) {
      errors.push(`Aseprite frame ${index} must be exported non-rotated`);
    }
    if (
      frame.trimmed &&
      (!frame.spriteSourceSize ||
        !frame.sourceSize ||
        ![
          frame.spriteSourceSize.x,
          frame.spriteSourceSize.y,
          frame.sourceSize.w,
          frame.sourceSize.h,
        ].every((part) => typeof part === "number" && Number.isFinite(part)))
    ) {
      errors.push(`Aseprite trimmed frame ${index} has no source placement`);
    }
  });
  const names = new Set<string>();
  (data.meta?.frameTags ?? []).forEach((value, index) => {
    const tag = value as { name?: unknown; from?: unknown; to?: unknown };
    if (
      typeof tag.name !== "string" ||
      !tag.name ||
      !Number.isInteger(tag.from) ||
      !Number.isInteger(tag.to) ||
      (tag.from as number) < 0 ||
      (tag.to as number) < (tag.from as number) ||
      (tag.to as number) >= frames.length
    ) {
      errors.push(`Aseprite tag ${index} has an invalid name or frame range`);
    } else if (names.has(tag.name)) {
      errors.push(`Aseprite tag "${tag.name}" is duplicated`);
    } else names.add(tag.name);
  });
  return errors;
};

/** Validate parseable assets, references, naming, and optional tile dimensions. */
export function checkAssets(root: string, tileSize?: number): AssetIssue[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`asset directory does not exist: ${root}`);
  }
  if (tileSize !== undefined && (!Number.isInteger(tileSize) || tileSize < 1)) {
    throw new Error("--tile-size must be a positive integer");
  }
  const paths = files(root);
  const issues: AssetIssue[] = [];
  const names = new Map<string, string>();
  const report = (level: AssetIssue["level"], path: string, message: string) =>
    issues.push({ level, file: relative(root, path), message });

  for (const path of paths) {
    const key = relative(root, path).toLowerCase();
    const previous = names.get(key);
    if (previous && previous !== path) {
      report("error", path, `case-insensitive duplicate of ${relative(root, previous)}`);
    }
    names.set(key, path);
    const extension = extname(path).toLowerCase();
    try {
      if (extension === ".json" || extension === ".ldtk" || extension === ".ldtkl") {
        const data = JSON.parse(readFileSync(path, "utf8")) as AsepriteData;
        for (const message of validateAseprite(data)) report("error", path, message);
        if (isAseprite(data) && typeof data.meta?.image === "string") {
          const image = resolve(dirname(path), data.meta.image);
          if (!existsSync(image))
            report("error", path, `missing Aseprite image ${data.meta.image}`);
        }
      } else if (extension === ".png") {
        const size = pngSize(readFileSync(path));
        if (!size) report("error", path, "invalid PNG header");
        else if (tileSize && (size.w % tileSize || size.h % tileSize)) {
          report("warning", path, `${size.w}×${size.h} is not a multiple of ${tileSize}px`);
        }
      } else if (extension === ".wav") {
        const data = readFileSync(path);
        if (
          data.length < 12 ||
          data.subarray(0, 4).toString() !== "RIFF" ||
          data.subarray(8, 12).toString() !== "WAVE"
        ) {
          report("error", path, "invalid WAV header");
        }
      }
    } catch (error) {
      report("error", path, error instanceof Error ? error.message : String(error));
    }
  }

  const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".html", ".css"]);
  const reference = /(?:new\s+URL\(\s*|src\s*=\s*|href\s*=\s*)["'](\.[^"'?#]+)["']/g;
  for (const path of paths) {
    if (!sourceExtensions.has(extname(path).toLowerCase())) continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(reference)) {
      const target = resolve(dirname(path), match[1]);
      if (!existsSync(target)) report("error", path, `missing referenced asset ${match[1]}`);
    }
  }
  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.message.localeCompare(b.message));
}

export default defineFeature({
  name: "assets",
  summary: "Validate asset files, references, and tile dimensions.",
  usage: ["mm assets check [directory] [options]"],
  run(input) {
    if (input.length === 0 || input[0] === "-h" || input[0] === "--help") {
      process.stdout.write(help);
      return;
    }
    if (input[0] !== "check") {
      throw new Error(`unknown assets command "${input.join(" ")}"\n\n${help}`);
    }
    const args = input.slice(1);
    const strict = takeFlag(args, "--strict");
    const json = takeFlag(args, "--json");
    const tileSize = numberOption(args, 0, "--tile-size") || undefined;
    const directory = resolve(args.shift() ?? "assets");
    if (args.length) throw new Error(`unknown option "${args[0]}"`);
    const issues = checkAssets(directory, tileSize);
    if (json) process.stdout.write(`${JSON.stringify(issues, null, 2)}\n`);
    else {
      for (const issue of issues) {
        process.stdout.write(`${issue.level}: ${issue.file}: ${issue.message}\n`);
      }
      process.stdout.write(
        `${issues.length ? "checked" : "valid"}: ${basename(directory)} (${issues.length} issues)\n`,
      );
    }
    const failed = issues.some(
      (issue) => issue.level === "error" || (strict && issue.level === "warning"),
    );
    if (failed) throw new Error("asset validation failed");
  },
});
