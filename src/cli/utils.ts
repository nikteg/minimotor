import { spawn, type SpawnOptions } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Quote a string for generated TypeScript. */
export const quote = (value: string): string => JSON.stringify(value);

/** Build a string-literal union, including the correct empty union. */
export const union = (values: string[]): string =>
  values.length ? values.map(quote).join(" | ") : "never";

/** Emit a formatted string-union type alias. */
export const unionType = (name: string, values: string[]): string => {
  const value = union(values);
  if (value.length <= 100) return `export type ${name} = ${value};\n`;
  return `export type ${name} =\n${values.map((item) => `  | ${quote(item)}`).join("\n")};\n`;
};

/** Use a bare property when valid and quote every other property safely. */
export const property = (value: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : quote(value);

/** Emit a compact array, expanding it only when the generated line is long. */
export const array = (values: string[], indent = "", prefixLength = 0): string => {
  const inline = `[${values.map(quote).join(", ")}]`;
  if (prefixLength + indent.length + inline.length <= 100) return inline;
  return `[\n${values.map((value) => `${indent}  ${quote(value)},`).join("\n")}\n${indent}]`;
};

/** Emit an `as const` string array declaration. */
export const constArray = (name: string, values: string[]): string => {
  const prefix = `export const ${name} = `;
  return `${prefix}${array(values, "", prefix.length + " as const;".length)} as const;\n`;
};

/** Turn an arbitrary editor name into a safe TypeScript identifier. */
export const identifier = (value: string): string => {
  const safe = value.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[A-Za-z_$]/.test(safe) ? safe : `_${safe}`;
};

/** Recursively list files in stable order. */
export function files(root: string): string[] {
  const out: string[] = [];
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      if (name === "node_modules" || name === ".git") continue;
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else out.push(path);
    }
  };
  visit(root);
  return out;
}

/** Read the value following a flag and remove both from an argument list. */
export function takeOption(args: string[], ...names: string[]): string | undefined {
  const index = args.findIndex((arg) => names.includes(arg));
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${args[index]} needs a value`);
  args.splice(index, 2);
  return value;
}

/** Read and remove a boolean flag. */
export function takeFlag(args: string[], ...names: string[]): boolean {
  const index = args.findIndex((arg) => names.includes(arg));
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

export function numberOption(args: string[], fallback: number, ...names: string[]): number {
  const raw = takeOption(args, ...names);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${names[0]} needs a number`);
  return value;
}

export function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

/** Run a child tool with inherited terminal IO and fail on non-zero exit. */
export function run(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", (error) =>
      reject(new Error(`could not start ${command}: ${error.message}`)),
    );
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${signal ?? code ?? "without a status"}`));
    });
  });
}
