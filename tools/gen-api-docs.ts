// Generate the API reference page from minimotor's built TypeScript types.
//
//   pnpm run docs:api
//
// Walks every public type entry in package.json with the TypeScript compiler
// API, pulls every export (namespaces + their members, standalone functions,
// types/interfaces) together with its JSDoc, and writes a single self-contained
// page to samples/api/.
// No new dependency — `typescript` already ships as a devDep, and Node runs
// this file directly via built-in type stripping (erasable syntax only).
import ts from "typescript";
import { createHighlighter } from "shiki";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

type Kind = "namespace" | "function" | "interface" | "type" | "value";

// A member is either a leaf (signature) or a sub-namespace (nested members).
interface MemberEntry {
  name: string;
  kind: Kind;
  signature?: string;
  doc: string;
  members?: MemberEntry[];
}

interface DocEntry {
  name: string;
  kind: Kind;
  doc: string;
  signature?: string;
  members: MemberEntry[];
}

// A DocEntry placed on the page: tagged with its module, display label and
// (once de-duplicated) its anchor slug.
interface PageItem extends DocEntry {
  module: string;
  label: string;
  slug?: string;
}

const present = <T>(x: T | null | undefined): x is T => x != null;

// Real TS syntax highlighting (build-time; emits self-contained inline colors,
// no client JS). Shiki is a devDependency — the engine's runtime stays 0-dep.
const THEME = "github-dark-default";
const shiki = await createHighlighter({ themes: [THEME], langs: ["typescript"] });

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
// An interface member is "ours" if it's declared in the package (build/*.d.ts),
// not inherited from a lib type — otherwise `extends HTMLCanvasElement` etc.
// dump the whole DOM (hundreds of `(ev) => any` handlers) into the page.
const isOwnMember = (sym: ts.Symbol): boolean =>
  (sym.declarations ?? []).some((d) => d.getSourceFile().fileName.startsWith(buildDir));

interface PackageJson {
  exports?: Record<string, string | { types?: string }>;
}

// The package export map is the public API. Derive the docs inputs from it so
// adding or moving a subpath cannot silently leave its API undocumented. A
// wildcard entry (currently `minimotor/cli/*`) expands to the declaration files
// that the wildcard actually exposes.
function publicTypeEntries(): [label: string, file: string][] {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;
  const found: [label: string, file: string][] = [];

  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    const types = typeof target === "string" ? target : target.types;
    if (!types) continue;

    const label = subpath === "." ? "index" : subpath.replace(/^\.\//, "");
    if (!types.includes("*")) {
      const file = join(root, types);
      if (!existsSync(file)) {
        throw new Error(`Missing public declaration ${types}; run pnpm build first`);
      }
      found.push([label, file]);
      continue;
    }

    const pattern = basename(types);
    const [prefix, suffix] = pattern.split("*");
    const directory = join(root, dirname(types));
    if (!existsSync(directory)) {
      throw new Error(
        `Missing public declaration directory ${dirname(types)}; run pnpm build first`,
      );
    }
    const matches = readdirSync(directory)
      .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
      .sort();
    if (!matches.length) throw new Error(`Public declaration pattern ${types} matched no files`);

    for (const name of matches) {
      const wildcard = name.slice(prefix.length, name.length - suffix.length);
      found.push([label.replace("*", wildcard), join(directory, name)]);
    }
  }

  return found;
}

const entries = publicTypeEntries();

const program = ts.createProgram(
  entries.map(([, f]) => f),
  { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, skipLibCheck: true },
);
const checker = program.getTypeChecker();

const docOf = (sym: ts.Symbol | undefined): string =>
  sym ? ts.displayPartsToString(sym.getDocumentationComment(checker)).trim() : "";

// A re-exported namespace (`import * as Anim from "..."`) keeps its doc on the
// import STATEMENT, which the symbol API doesn't expose (the alias resolves
// straight to the module, past the comment). Read the leading `/** … */` block
// off the declaration's source text instead. Returns the comment body with the
// `*` gutter stripped, or "" if there's no JSDoc block.
function leadingBlockDoc(sym: ts.Symbol): string {
  // `export { Anim }` re-exports the imported namespace: the export specifier
  // carries no comment, but the `import * as Anim` it aliases does. Collect
  // declarations across the immediate-alias chain so we reach that import.
  const decls: ts.Declaration[] = [];
  let s: ts.Symbol | null = sym;
  const seen = new Set<ts.Symbol>();
  while (s && !seen.has(s)) {
    seen.add(s);
    for (const d of s.declarations ?? []) decls.push(d);
    s = s.getFlags() & ts.SymbolFlags.Alias ? (checker.getImmediateAliasedSymbol(s) ?? null) : null;
  }
  for (const decl of decls) {
    // The module's own SourceFile declaration has no import comment to read.
    if (ts.isSourceFile(decl)) continue;
    // Walk up to the statement that carries the leading comment (NamespaceImport
    // → ImportClause → ImportDeclaration).
    let node: ts.Node = decl;
    while (node.parent && !ts.isSourceFile(node.parent)) node = node.parent;
    const src = node.getSourceFile();
    const text = src.getFullText();
    const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
    for (let i = ranges.length - 1; i >= 0; i--) {
      const r = ranges[i];
      if (r.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
      const raw = text.slice(r.pos, r.end);
      if (!raw.startsWith("/**")) continue;
      const body = raw
        .slice(3, -2)
        .split("\n")
        // Strip the gutter as `*` + AT MOST one space — deeper indentation is
        // meaningful (indented lines render as code blocks), matching how the
        // compiler's own getDocumentationComment treats it.
        .map((l) => l.replace(/^\s*\* ?/, "").trimEnd())
        .join("\n")
        .trim();
      if (body) return body;
    }
  }
  return "";
}

// A facade object built from shorthands (`Draw = { rect, circle, … }`) emits
// its members in the `.d.ts` as `rect: typeof rect` — the property carries NO
// JSDoc of its own; the docs live on the referenced function's declaration. So
// when a function-valued property has no doc, follow its TYPE to the function
// symbol and use ITS doc. Guarded to call signatures so a plain `foo: Rect`
// prop never inherits the `Rect` interface's doc by mistake.
function memberDoc(sym: ts.Symbol, type: ts.Type | null): string {
  const own = docOf(sym);
  if (own) return own;
  if (type && type.getCallSignatures().length > 0) {
    const target = type.getSymbol();
    if (target && target !== sym) {
      const d = docOf(target);
      if (d) return d;
    }
  }
  return "";
}

const sig = (type: ts.Type): string =>
  checker
    .typeToString(
      type,
      undefined,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature,
    )
    // Cross-module types stringify as `import("/abs/path").Name` — drop the
    // filesystem qualifier, keep the bare type name.
    .replace(/import\([^)]*\)\./g, "");

// Classify + collect members for one exported symbol.
function describe(rawSym: ts.Symbol): DocEntry {
  const name = rawSym.getName();
  // `export type { X } from "..."` / `export { Y }` create ALIAS symbols whose
  // own flags are just `Alias` — resolve to the real declaration so interfaces
  // and type aliases classify correctly instead of falling back to "value".
  let sym = rawSym;
  if (rawSym.getFlags() & ts.SymbolFlags.Alias) {
    try {
      sym = checker.getAliasedSymbol(rawSym);
    } catch {
      sym = rawSym;
    }
  }
  const decl = sym.declarations?.[0];
  const flags = sym.getFlags();

  // A re-exported namespace (`import * as ECS`) — enumerate its module exports.
  const isNamespace =
    flags & (ts.SymbolFlags.Module | ts.SymbolFlags.NamespaceModule | ts.SymbolFlags.ValueModule);

  const type = decl ? checker.getTypeOfSymbolAtLocation(sym, decl) : null;
  const callSigs = type ? type.getCallSignatures() : [];
  const props = type ? type.getProperties() : [];
  const ownProps = props.filter(isOwnMember);

  // Namespace object literal (`export const Draw = { ... }`): object type,
  // has members, no call signature of its own.
  const isObjectNamespace =
    !isNamespace &&
    !!(type && type.getFlags() & ts.TypeFlags.Object) &&
    callSigs.length === 0 &&
    ownProps.length > 0 &&
    !(flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class));

  if (isNamespace) {
    const members = checker
      .getExportsOfModule(sym)
      .filter((m) => !(m.getFlags() & ts.SymbolFlags.Alias) || checker.getAliasedSymbol(m))
      .map((mem) => memberEntry(mem))
      .filter(present);
    // A re-exported namespace (`import * as Anim`) carries its doc on the
    // import statement, which the symbol API skips past — read it off the
    // source text. Fall back to the module's / alias's own doc comment.
    const doc = leadingBlockDoc(rawSym) || docOf(rawSym) || docOf(sym);
    return { name, kind: "namespace", doc, members };
  }
  if (isObjectNamespace) {
    return {
      name,
      kind: "namespace",
      doc: docOf(sym),
      members: ownProps.map((mem) => memberEntry(mem)).filter(present),
    };
  }
  if (callSigs.length > 0 && type) {
    return { name, kind: "function", doc: docOf(sym), signature: name + sig(type), members: [] };
  }
  if (flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class)) {
    // Use the DECLARED type (the interface itself), not the value type — the
    // latter is `any` for a type-only interface, yielding no members.
    const iprops = checker
      .getDeclaredTypeOfSymbol(sym)
      .getProperties()
      .filter(isOwnMember) // drop members inherited from lib types (e.g. DOM)
      .map((p): MemberEntry => {
        const pd = p.declarations?.[0];
        const pt = pd ? checker.getTypeOfSymbolAtLocation(p, pd) : null;
        const opt = p.getFlags() & ts.SymbolFlags.Optional ? "?" : "";
        const pname = `${p.getName()}${opt}`;
        return {
          name: pname,
          kind: "value",
          signature: `${pname}: ${pt ? sig(pt) : "unknown"}`,
          doc: docOf(p),
        };
      });
    return { name, kind: "interface", doc: docOf(sym), members: iprops };
  }
  if (flags & ts.SymbolFlags.TypeAlias) {
    // `typeToString` on a type alias just echoes the alias name — show the
    // actual definition (the RHS of `type X = …`) from the declaration instead.
    const rhs =
      decl && ts.isTypeAliasDeclaration(decl)
        ? decl.type.getText().replace(/import\([^)]*\)\./g, "")
        : sig(checker.getDeclaredTypeOfSymbol(sym));
    return { name, kind: "type", doc: docOf(sym), signature: rhs, members: [] };
  }
  // Fallback: a plain const value.
  return { name, kind: "value", doc: docOf(sym), signature: type ? sig(type) : "", members: [] };
}

const TYPE_FLAGS = ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias;
const VALUE_FLAGS =
  ts.SymbolFlags.Function |
  ts.SymbolFlags.Method |
  ts.SymbolFlags.Property |
  ts.SymbolFlags.Variable |
  ts.SymbolFlags.GetAccessor |
  ts.SymbolFlags.SetAccessor;

const isMethod = (p: ts.Symbol): boolean => {
  const pd = p.declarations?.[0];
  return !!pd && checker.getTypeOfSymbolAtLocation(p, pd).getCallSignatures().length > 0;
};

function memberEntry(m: ts.Symbol, depth = 0): MemberEntry | null {
  let sym = m;
  if (m.getFlags() & ts.SymbolFlags.Alias) {
    try {
      sym = checker.getAliasedSymbol(m);
    } catch {
      /* keep original */
    }
  }
  // A namespace re-exports its own types (e.g. `Anim.FrameRect`); those have no
  // value, so they'd render as `Name: any`. Skip them — they're documented as
  // top-level types anyway. Keep functions/methods/properties.
  const f = sym.getFlags();
  if (f & TYPE_FLAGS && !(f & VALUE_FLAGS)) return null;
  const decl = sym.declarations?.[0];
  const type = decl ? checker.getTypeOfSymbolAtLocation(sym, decl) : null;
  if (!type) return null;
  const name = m.getName();
  // A nested object-of-methods (e.g. `Audio.Mixer`, `Audio.Music`) is a sub-
  // namespace: expand it into its OWN member list instead of dumping a giant
  // inline object type. Only our own members count — otherwise a `number` field
  // would expand into `Number.prototype` (toFixed/toString/…). Small data
  // objects (buses/master) have no own methods, so they fall through inline.
  if (depth < 1 && type.getCallSignatures().length === 0) {
    const own = type.getProperties().filter(isOwnMember);
    if (own.length && own.some(isMethod)) {
      const members = own.map((p) => memberEntry(p, depth + 1)).filter(present);
      if (members.length) return { name, kind: "namespace", doc: memberDoc(sym, type), members };
    }
  }
  // Methods render as `name(args) => ret`; other props as `name: Type`.
  const isFn = type.getCallSignatures().length > 0;
  const signature = isFn ? name + sig(type) : `${name}: ${sig(type)}`;
  return { name, kind: isFn ? "function" : "value", signature, doc: memberDoc(sym, type) };
}

// ---- collect all modules ----
const groups: { label: string; items: DocEntry[] }[] = [];
for (const [label, file] of entries) {
  const src = program.getSourceFile(file);
  if (!src) continue;
  const moduleSym = checker.getSymbolAtLocation(src);
  if (!moduleSym) continue;
  const exports = checker
    .getExportsOfModule(moduleSym)
    // The `Minimotor` bag and the default export just alias every namespace
    // already documented individually — skip (and they'd dump filesystem paths).
    .filter((s) => !["Minimotor", "default"].includes(s.getName()));
  const items = exports.map(describe).sort((a, b) => a.name.localeCompare(b.name));
  groups.push({ label, items });
}

// ---- render ----
const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Token → anchor for clickable types; populated after slugs are assigned
// (only unambiguous names — dupes across modules are skipped).
const linkTarget = new Map<string, string>();

// Turn any identifier that names a documented export into a link to its anchor.
// Runs on a token's TEXT (Shiki bundles names with surrounding punctuation like
// `AppInitOptions) ` into one token, so whole-token matching misses them).
function linkifyText(text: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  const RE = /[A-Za-z_][A-Za-z0-9_]*/g;
  while ((m = RE.exec(text))) {
    out += esc(text.slice(last, m.index));
    const target = linkTarget.get(m[0]);
    out += target ? `<a class="tlink" href="#${esc(target)}">${esc(m[0])}</a>` : esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

// Highlight a TS snippet with Shiki → inline-colored spans (works for a single
// signature line and for multi-line code examples alike).
function highlightSig(code: string): string {
  const { tokens } = shiki.codeToTokens(code, { lang: "typescript", theme: THEME });
  return tokens
    .map((line) =>
      line
        .map((t) => `<span style="color:${t.color ?? "#c8d1dc"}">${linkifyText(t.content)}</span>`)
        .join(""),
    )
    .join("\n");
}

// Render a JSDoc string as a small markdown subset: fenced ```code``` blocks,
// inline `code` (type-highlighted) and **bold**. Everything else stays literal.
function inlineMd(s: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  const RE = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  while ((m = RE.exec(s))) {
    out += esc(s.slice(last, m.index));
    out +=
      m[1] !== undefined
        ? `<code class="ic">${highlightSig(m[1])}</code>`
        : `<strong>${esc(m[2])}</strong>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}
// Render an indented / fenced code block: dedent by the minimum indent, trim
// blank edges, and type-highlight it in the monospace signature style.
function codeBlock(lines: string[]): string {
  const body = [...lines];
  while (body.length && body[0].trim() === "") body.shift();
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  if (!body.length) return "";
  const min = Math.min(
    ...body.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)?.[0].length ?? 0),
  );
  const src = body.map((l) => l.slice(min)).join("\n");
  return `<pre class="doc-code"><code class="sig">${highlightSig(src)}</code></pre>`;
}
function renderDoc(text: string): string {
  // Fenced ```blocks``` split out first; then, within prose, runs of indented
  // lines (JSDoc examples use a 2-space indent) become code blocks too.
  const fenced = text.split(/```[a-z]*\n?([\s\S]*?)```/g);
  let html = "";
  for (let i = 0; i < fenced.length; i++) {
    if (i % 2) {
      html += codeBlock(fenced[i].split("\n"));
      continue;
    }
    let prose: string[] = [];
    let code: string[] = [];
    const flushProse = () => {
      const t = prose.join("\n").replace(/^\n+|\n+$/g, "");
      if (t) html += inlineMd(t);
      prose = [];
    };
    const flushCode = () => {
      if (code.length) html += codeBlock(code);
      code = [];
    };
    for (const line of fenced[i].split("\n")) {
      if (/^[ \t]{2,}\S/.test(line)) {
        flushProse();
        code.push(line);
      } else {
        flushCode();
        prose.push(line);
      }
    }
    flushProse();
    flushCode();
  }
  return html;
}

const kindRank: Record<Kind, number> = {
  namespace: 0,
  function: 1,
  interface: 2,
  type: 3,
  value: 4,
};
// Inline stroke SVGs (currentColor) — text glyphs and emoji sit off-baseline
// inside the badges and render differently per platform; SVG centers exactly.
const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
// A little icon per kind, so you can scan the type of each entry at a glance:
// braces = namespace, λ = function, UML lollipop = interface, T = type alias.
const ICON: Record<Kind, string> = {
  namespace: svg(
    '<path d="M6.1 2.9c-1.3 0-2 .7-2 2v1.5c0 .9-.5 1.4-1.4 1.6.9.2 1.4.7 1.4 1.6v1.5c0 1.3.7 2 2 2"/><path d="M9.9 2.9c1.3 0 2 .7 2 2v1.5c0 .9.5 1.4 1.4 1.6-.9.2-1.4.7-1.4 1.6v1.5c0 1.3-.7 2-2 2"/>',
  ),
  function: svg('<path d="M5.1 3.2c1.1 0 1.8.6 2.3 1.6l4.2 8.2M8.1 8.5 4.4 13"/>'),
  interface: svg('<circle cx="10.4" cy="8" r="3"/><path d="M2.6 8h4.8"/>'),
  type: svg('<path d="M3.9 4.1h8.2M8 4.1V12.9"/>'),
  value: svg('<path d="M8 3.4 12.6 8 8 12.6 3.4 8Z"/>'),
};
const MENU_ICON = svg('<path d="M2.9 4.7h10.2M2.9 8h10.2M2.9 11.3h10.2"/>');
const SEARCH_ICON = svg('<circle cx="7.1" cy="7.1" r="4.3"/><path d="m10.4 10.4 3.4 3.4"/>');
const CLOSE_ICON = svg('<path d="m4.2 4.2 7.6 7.6M11.8 4.2l-7.6 7.6"/>');

// `path` is the qualified prefix (e.g. "Audio" / "Audio.Mixer") → each member
// gets a unique anchor id like "Audio.Mixer.bus".
function renderMember(m: MemberEntry, path: string): string {
  const id = `${path}.${m.name}`;
  const mdoc = m.doc ? `<span class="mdoc">${inlineMd(m.doc)}</span>` : "";
  if (m.members?.length) {
    return `<div class="member sub" id="${esc(id)}"><div class="subhead">${esc(m.name)}</div>${mdoc}<div class="members nested">${m.members.map((x) => renderMember(x, id)).join("")}</div></div>`;
  }
  return `<div class="member" id="${esc(id)}"><code class="sig">${highlightSig(m.signature ?? "")}</code>${mdoc}</div>`;
}

// Flatten a member tree into qualified names, for the article's search text.
function memberSearch(members: MemberEntry[], path: string): string[] {
  return members.flatMap((m) => {
    const id = `${path}.${m.name}`;
    return m.members?.length ? [id, ...memberSearch(m.members, id)] : [id];
  });
}

function renderItem(it: PageItem): string {
  const doc = it.doc ? `<div class="doc">${renderDoc(it.doc)}</div>` : "";
  const slug = it.slug ?? it.name;
  let body = "";
  if (it.members?.length) {
    body = `<div class="members">${it.members.map((m) => renderMember(m, slug)).join("")}</div>`;
  } else if (it.signature) {
    body = `<code class="sig block">${highlightSig(it.signature)}</code>`;
  }
  const label = it.label ?? it.name;
  // Search text includes member names so filtering by a method (e.g. "bus")
  // keeps the parent namespace visible.
  const search = [label, ...memberSearch(it.members ?? [], slug)].join(" ").toLowerCase();
  // The heading is a self-link, so an entry's anchor is one click/copy away.
  return `<article class="item" id="${esc(slug)}" data-name="${esc(search)}">
    <h3><span class="ico ${it.kind}">${ICON[it.kind]}</span><a class="self" href="#${esc(slug)}">${esc(label)}</a> <span class="kind ${it.kind}">${it.kind}</span></h3>
    ${doc}${body}
  </article>`;
}

// Names that already appear as a member of some namespace (e.g. Collision's
// slide/moveAndSlide, also exported standalone) — so we don't also list them as
// top-level functions. They belong inside their namespace.
const memberNames = new Map<string, Set<string>>();
for (const g of groups) {
  const names = new Set<string>();
  for (const it of g.items) for (const m of it.members ?? []) names.add(m.name);
  memberNames.set(g.label, names);
}

// Which namespace re-exports each type — so top-level types can be labeled
// `Namespace.Type` (e.g. `Audio.SfxSpec`, `Anim.SheetOptions`) in the sidebar,
// filter and heading. Built from each `import * as X` namespace's type exports.
const typeOwner = new Map<string, string>();
for (const [label, file] of entries) {
  const src = program.getSourceFile(file);
  const mod = src && checker.getSymbolAtLocation(src);
  if (!mod) continue;
  for (const s of checker.getExportsOfModule(mod)) {
    let ns = s;
    if (s.getFlags() & ts.SymbolFlags.Alias) {
      try {
        ns = checker.getAliasedSymbol(s);
      } catch {
        /* skip */
      }
    }
    const isNs =
      ns.getFlags() &
      (ts.SymbolFlags.Module | ts.SymbolFlags.NamespaceModule | ts.SymbolFlags.ValueModule);
    if (!isNs) continue;
    for (const e of checker.getExportsOfModule(ns)) {
      let et = e;
      if (e.getFlags() & ts.SymbolFlags.Alias) {
        try {
          et = checker.getAliasedSymbol(e);
        } catch {
          /* skip */
        }
      }
      const ef = et.getFlags();
      const key = `${label}\0${e.getName()}`;
      if (ef & TYPE_FLAGS && !(ef & VALUE_FLAGS) && !typeOwner.has(key))
        typeOwner.set(key, s.getName());
    }
  }
}

const flat: PageItem[] = groups
  .flatMap((g) => g.items.map((it) => ({ ...it, module: g.label, label: it.name })))
  .filter((it) => it.kind !== "function" || !memberNames.get(it.module)?.has(it.name));

// Promote nested sub-namespaces (Audio.Music, Audio.Mixer) to their OWN cards;
// the parent keeps just its direct functions/properties. They sort right after
// the parent (label "Audio" < "Audio.Mixer"), so in the sidebar they land after
// the namespace's own members, at the top level (not indented).
const expanded: PageItem[] = flat.flatMap((it) => {
  if (it.kind !== "namespace" || !it.members?.some((m) => m.members?.length)) return [it];
  const subs = it.members.filter((m) => m.members?.length);
  const leaves = it.members.filter((m) => !m.members?.length);
  return [
    { ...it, members: leaves },
    ...subs.map(
      // A facade property with an inlined type (`Phys: Component<...>` in the
      // d.ts) carries no doc of its own — borrow it from the same-named
      // top-level export of the same module (e.g. `Phys` documents
      // `Physics2D.Phys`).
      (s): PageItem => ({
        name: `${it.name}.${s.name}`,
        kind: "namespace",
        doc: s.doc || (flat.find((x) => x.module === it.module && x.name === s.name)?.doc ?? ""),
        members: s.members ?? [],
        module: it.module,
        label: `${it.name}.${s.name}`,
      }),
    ),
  ];
});

const allItems: PageItem[] = expanded.map((it) => {
  // Prefix types with their owning namespace where known. Ownership is scoped
  // to an entry point so same-named types in different subpaths cannot collide.
  const owner =
    (it.kind === "type" || it.kind === "interface") && typeOwner.get(`${it.module}\0${it.name}`);
  return { ...it, label: owner ? `${owner}.${it.name}` : it.name };
});
allItems.sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || a.label.localeCompare(b.label));

// Some names are exported by more than one entry point (e.g. `Room` from both
// `minimotor` and `minimotor/server`) — give each a unique anchor slug and tag
// the label with its module so navigation doesn't clash.
const nameCount = new Map<string, number>();
for (const it of allItems) nameCount.set(it.name, (nameCount.get(it.name) ?? 0) + 1);
for (const it of allItems) {
  const dup = (nameCount.get(it.name) ?? 0) > 1 && it.module !== "index";
  it.slug = dup ? `${it.module}.${it.name}` : it.name;
  if (dup) it.label = `${it.label} · ${it.module}`;
}
for (const it of allItems)
  if (nameCount.get(it.name) === 1 && it.slug) linkTarget.set(it.name, it.slug);

// Sidebar member sub-links (indented), so functions like `Draw.rect` are
// directly navigable — anchor ids match renderMember's.
function navMembers(members: MemberEntry[], path: string, depth = 0): string {
  return members
    .map((m) => {
      const id = `${path}.${m.name}`;
      const isSub = m.members?.length;
      // Sub-namespaces show their qualified name (Audio.Music); leaf methods the
      // bare name. Slightly indented under their namespace, each with a kind icon.
      const label = isSub ? id : m.name;
      const self = `<a class="sub" style="padding-left:${14 + depth * 11}px" href="#${esc(id)}" data-name="${esc(id.toLowerCase())}"><span class="ico ${m.kind}">${ICON[m.kind]}</span><span class="lbl">${esc(label)}</span></a>`;
      return isSub ? self + navMembers(m.members ?? [], id, depth + 1) : self;
    })
    .join("");
}
const nav = allItems
  .map(
    (it) =>
      `<a href="#${esc(it.slug)}" data-name="${esc(it.label.toLowerCase())}"><span class="ico ${it.kind}">${ICON[it.kind]}</span><span class="lbl">${esc(it.label)}</span></a>` +
      // Only namespaces list members in the sidebar (functions / sub-namespaces);
      // interface data-fields would just be noise.
      (it.kind === "namespace" && it.members?.length
        ? navMembers(it.members, it.slug ?? it.name)
        : ""),
  )
  .join("");
// Autocomplete data for the filter box — every export label + member path,
// each with its anchor and kind. Rendered by the page's own dropdown (a native
// <datalist> popup is browser chrome and can't be styled to match the theme).
type Suggestion = [label: string, anchor: string, kind: Kind];
const suggestions: Suggestion[] = [];
{
  const seenLabel = new Set<string>();
  const add = (label: string, anchor: string, kind: Kind) => {
    if (seenLabel.has(label)) return;
    seenLabel.add(label);
    suggestions.push([label, anchor, kind]);
  };
  const walk = (members: MemberEntry[], path: string) => {
    for (const m of members) {
      const id = `${path}.${m.name}`;
      add(id, id, m.kind);
      if (m.members?.length) walk(m.members, id);
    }
  };
  for (const it of allItems) {
    add(it.label, it.slug ?? it.name, it.kind);
    // Member ids are built from the SLUG (see renderMember), so qualify with it
    // — with it.name, a dup like `server.Room`'s members would point nowhere.
    walk(it.members ?? [], it.slug ?? it.name);
  }
}
const body = allItems.map(renderItem).join("\n");

const html = `<!doctype html>
<!-- GENERATED FILE — do not edit by hand. Produced by tools/gen-api-docs.ts
     (npm run docs:api) from the package's exported types. Re-run after API changes. -->
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="description" content="Minimotor API reference — every public package export, generated from the package's TypeScript types." />
<title>Minimotor · API reference</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0d0f12;--panel:#16191e;--border:#2a2f38;--text:#e7ecf0;--dim:#8b94a0;--accent:#4ecdc4;--accent2:#ffd166;color-scheme:dark}
  body{font-family:"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.55}
  a{color:var(--accent);text-decoration:none}
  /* Match the landing page's 56px sticky navbar exactly. */
  header{height:56px;border-bottom:1px solid var(--border);padding:0 20px;display:flex;align-items:center;gap:14px;position:sticky;top:0;background:rgba(13,15,18,.82);backdrop-filter:blur(8px);z-index:5}
  header .brand{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--text);letter-spacing:.2px}
  header input{margin-left:auto;background:var(--panel);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 12px;font-size:.9rem;width:min(280px,40vw)}
  header input:focus{outline:none;border-color:var(--accent)}
  /* Autocomplete dropdown — our own, so it can match the theme (a native
     datalist popup can't be styled). Positioned under the input by JS. */
  #suggest{position:absolute;z-index:30;background:var(--panel);border:1px solid var(--border);border-radius:10px;max-height:min(48vh,420px);overflow-y:auto;overscroll-behavior:contain;box-shadow:0 12px 30px rgba(0,0,0,.5);padding:4px}
  #suggest .opt{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:6px;font-family:ui-monospace,monospace;font-size:.82rem;color:var(--dim);cursor:pointer}
  #suggest .opt .lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #suggest .opt.sel,#suggest .opt:hover{background:rgba(78,205,196,.1);color:var(--text)}
  #suggest .opt b{color:var(--accent);font-weight:600}
  .layout{display:grid;grid-template-columns:230px 1fr;max-width:1180px;margin:0 auto}
  /* align-self:start stops the grid from stretching the aside to full content
     height, which would defeat position:sticky. */
  aside{align-self:start;border-right:1px solid var(--border);padding:20px 10px;position:sticky;top:57px;height:calc(100vh - 57px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
  aside a{display:flex;align-items:center;gap:7px;min-width:0;color:var(--dim);font-size:.85rem;padding:3px 8px;border-radius:6px;font-family:ui-monospace,monospace}
  aside a:hover{color:var(--text);background:var(--panel)}
  /* Scrollspy: the entry whose article is currently on screen. */
  aside a.active{color:var(--accent);background:var(--panel)}
  /* Ellipsis-truncate long member names so the sidebar never scrolls sideways. */
  aside a .lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* member sub-links: slightly indented, dimmer; icon distinguishes the kind */
  aside a.sub{font-size:.8rem;color:var(--dim)}
  aside a.sub:hover{color:var(--text)}
  aside a.sub.active{color:var(--accent)}
  /* Drawer header (mobile only): title + explicit close button. */
  .nav-head{display:none}
  .ico{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 auto;border-radius:6px;border:1px solid var(--border)}
  .ico svg{display:block;width:64%;height:64%}
  aside .ico,#suggest .ico{width:17px;height:17px;border-radius:5px}
  .ico.namespace{color:var(--accent);border-color:var(--accent)}
  .ico.function{color:#82aaff;border-color:#82aaff88}
  .ico.interface,.ico.type{color:var(--accent2);border-color:#ffd16688}
  .ico.value{color:var(--dim)}
  main{padding:28px 32px 80px;min-width:0}
  main>p.lead{color:var(--dim);margin-bottom:26px;max-width:70ch}
  /* Shown when the filter matches nothing — never a silently blank page. */
  #noresults{color:var(--dim);border:1px dashed var(--border);border-radius:12px;padding:36px 20px;text-align:center}
  #noresults code{font-family:ui-monospace,monospace;color:var(--text)}
  /* scroll-margin-top keeps a clicked anchor clear of the 56px sticky navbar. */
  .item{border:1px solid var(--border);background:var(--panel);border-radius:12px;padding:20px 22px;margin-bottom:16px;scroll-margin-top:72px}
  .item h3{font-family:ui-monospace,monospace;font-size:1.25rem;display:flex;align-items:center;gap:10px}
  /* Heading self-link: same color, reveals the anchor affordance on hover. */
  .item h3 a.self{color:inherit}
  .item h3 a.self:hover{text-decoration:underline;text-decoration-color:var(--accent);text-underline-offset:4px}
  .kind{font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:2px 7px;border-radius:5px;font-family:system-ui,sans-serif;border:1px solid var(--border);color:var(--dim)}
  .kind.namespace{color:var(--accent);border-color:var(--accent)}
  .kind.function{color:#82aaff;border-color:#82aaff55}
  .kind.interface,.kind.type{color:var(--accent2);border-color:#ffd16655}
  .doc{color:var(--dim);margin:10px 0 4px;white-space:pre-wrap}
  .doc code.ic{white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:.85em;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:5px;padding:1px 5px}
  .mdoc code.ic{font-family:ui-monospace,monospace;font-size:.85em;background:rgba(255,255,255,.06);border-radius:4px;padding:0 4px}
  pre.doc-code{white-space:normal;background:#11141a;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin:9px 0;overflow-x:auto}
  pre.doc-code code{font-size:.8rem;white-space:pre;color:#c8d1dc}
  .members{margin-top:12px;display:flex;flex-direction:column;gap:2px}
  .member{padding:9px 0;border-top:1px solid var(--border);scroll-margin-top:72px}
  a.tlink{text-decoration:none;border-bottom:1px dotted rgba(255,255,255,.25)}
  a.tlink:hover{border-bottom-color:currentColor}
  .member.sub .subhead{font-family:ui-monospace,monospace;font-size:.92rem;color:var(--accent);font-weight:600}
  .members.nested{margin:6px 0 2px 14px;padding-left:12px;border-left:2px solid var(--border)}
  .members.nested .member:first-child{border-top:0;padding-top:0}
  code.sig{font-family:ui-monospace,monospace;font-size:.82rem;color:#c8d1dc;white-space:pre-wrap;word-break:break-word;display:block}
  code.sig.block{margin-top:10px}
  /* token colors come from Shiki as inline styles */
  .mdoc{display:block;color:var(--dim);font-size:.82rem;margin-top:3px}
  footer{color:var(--dim);text-align:center;padding:30px;border-top:1px solid var(--border)}
  /* Header buttons: hidden on desktop, shown on mobile. */
  .hbtn{display:none;background:var(--panel);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px;cursor:pointer}
  .hbtn svg{display:block;width:17px;height:17px}
  .hbtn:hover{border-color:var(--accent)}
  #backdrop{display:none}
  @media(max-width:760px){
    header{padding:0 12px;gap:10px}
    .hbtn{display:inline-flex;align-items:center;justify-content:center}
    #searchBtn{margin-left:auto;order:2}
    .rlabel{display:none}
    /* Filter collapses behind the search button. Opened, it joins the header's
       flex row in place of the brand (order puts it left of the ✕ button), so
       it aligns with the buttons exactly — no absolute-position offsets. */
    header input{display:none}
    header.search-open .brand{display:none}
    header.search-open input{display:block;flex:1;min-width:0;width:auto;margin:0;order:1}
    .layout{grid-template-columns:1fr}
    /* Sidebar becomes an off-canvas drawer toggled by the menu button.
       align-self:auto — the desktop align-self:start would make the fixed
       drawer take its (huge) content height, so it could never scroll. */
    aside{align-self:auto;position:fixed;top:56px;left:0;bottom:0;height:auto;width:min(82vw,300px);background:var(--bg);z-index:9;transform:translateX(-100%);transition:transform .22s ease;padding:0 12px 12px}
    body.nav-open aside{transform:none}
    body.nav-open #backdrop{display:block;position:fixed;inset:56px 0 0 0;background:rgba(0,0,0,.5);z-index:8}
    /* Lock the page while the drawer is open, so touch scrolling scrolls the
       drawer — not the document behind it. */
    body.nav-open{overflow:hidden}
    /* Sticky inside the scrolling drawer, so ✕ never scrolls out of reach. */
    .nav-head{display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:0;z-index:1;background:var(--bg);margin:0 -12px 10px;padding:10px 12px 10px 20px;border-bottom:1px solid var(--border);color:var(--dim);font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.6px}
    .nav-head .hbtn{padding:6px}
    .nav-head .hbtn svg{width:14px;height:14px}
    main{padding:22px 18px 70px}
  }
</style></head>
<body>
<header>
  <button id="menuBtn" class="hbtn" aria-label="Toggle navigation" aria-controls="nav" aria-expanded="false">${MENU_ICON}</button>
  <a class="brand" href="../">
    <svg width="26" height="26" viewBox="-2 -2 36 36"><defs><mask id="mlogo-api"><rect x="-2" y="-2" width="36" height="36" fill="#fff"/><text x="16" y="24" font-family="ui-monospace,monospace" font-size="17" font-weight="800" fill="#000" text-anchor="middle">m</text></mask></defs><g transform="rotate(-7 16 16)"><rect x="9.4" y="2.2" width="13.2" height="2.6" rx="1.3" fill="#4ecdc4"/><rect x="9.4" y="5.6" width="13.2" height="2.6" rx="1.3" fill="#4ecdc4"/><rect x="10.6" y="9.0" width="10.8" height="2.6" rx="1.3" fill="#4ecdc4"/><rect x="3.6" y="12" width="24.8" height="15.8" rx="5.5" fill="#4ecdc4" mask="url(#mlogo-api)"/><rect x="27.4" y="16.4" width="4.2" height="5" rx="1.5" fill="#4ecdc4"/></g></svg>
    minimotor
  </a>
  <span class="rlabel" style="color:var(--dim)">API reference</span>
  <button id="searchBtn" class="hbtn" aria-label="Search" aria-controls="filter" aria-expanded="false">${SEARCH_ICON}</button>
  <input id="filter" type="search" placeholder="Filter types…  ( / )" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="suggest" aria-expanded="false" />
  <div id="suggest" role="listbox" aria-label="Suggestions" hidden></div>
</header>
<div id="backdrop"></div>
<div class="layout">
  <aside id="nav" aria-label="API index">
    <div class="nav-head">Index <button id="navClose" class="hbtn" aria-label="Close navigation">${CLOSE_ICON}</button></div>
    ${nav}
  </aside>
  <main>
    ${body}
    <p id="noresults" hidden></p>
  </main>
</div>
<footer>Generated from the public package exports · <a href="../">back to samples</a></footer>
<script>
  const f = document.getElementById("filter");
  const items = [...document.querySelectorAll(".item")];
  const links = [...document.querySelectorAll("#nav a")];
  const noResults = document.getElementById("noresults");
  const applyFilter = () => {
    const q = f.value.trim().toLowerCase();
    let shown = 0;
    for (const el of items) {
      const hit = !q || el.dataset.name.includes(q);
      el.style.display = hit ? "" : "none";
      if (hit) shown++;
    }
    for (const el of links) el.style.display = !q || el.dataset.name.includes(q) ? "" : "none";
    noResults.hidden = !q || shown > 0;
    if (!noResults.hidden) noResults.innerHTML = "No exports match <code></code>.";
    if (!noResults.hidden) noResults.querySelector("code").textContent = f.value.trim();
    updateSpy();
  };

  // Autocomplete dropdown. SUGGEST rows are [label, anchor, kind]; ranked
  // name-start match > segment start (after a ".") > substring, then shortest.
  const SUGGEST = ${JSON.stringify(suggestions)};
  const KIND_ICON = ${JSON.stringify(ICON)};
  const sbox = document.getElementById("suggest");
  const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let sugSel = -1;
  const hideSug = () => {
    sbox.hidden = true;
    sugSel = -1;
    f.setAttribute("aria-expanded", "false");
    f.removeAttribute("aria-activedescendant");
  };
  const markSel = () => {
    [...sbox.children].forEach((el, i) => el.classList.toggle("sel", i === sugSel));
    const el = sbox.children[sugSel];
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    f.setAttribute("aria-activedescendant", el.id);
  };
  const pickSug = (el) => {
    f.value = el.dataset.label;
    applyFilter();
    hideSug();
    location.hash = "#" + el.dataset.anchor;
  };
  const showSug = () => {
    const q = f.value.trim().toLowerCase();
    if (!q) return hideSug();
    const ranked = [];
    for (const [label, anchor, kind] of SUGGEST) {
      const i = label.toLowerCase().indexOf(q);
      if (i < 0) continue;
      const rank = i === 0 ? 0 : label[i - 1] === "." ? 1 : 2;
      ranked.push({ rank, label, anchor, kind, i });
    }
    if (!ranked.length) return hideSug();
    ranked.sort((a, b) => a.rank - b.rank || a.label.length - b.label.length || (a.label < b.label ? -1 : 1));
    sbox.innerHTML = ranked.slice(0, 12).map((s, n) =>
      '<div class="opt" role="option" id="sug-' + n + '" data-label="' + s.label + '" data-anchor="' + s.anchor + '">' +
      '<span class="ico ' + s.kind + '">' + KIND_ICON[s.kind] + '</span>' +
      '<span class="lbl">' + escHtml(s.label.slice(0, s.i)) + "<b>" + escHtml(s.label.slice(s.i, s.i + q.length)) + "</b>" + escHtml(s.label.slice(s.i + q.length)) + "</span></div>",
    ).join("");
    // Pin under the input (the sticky header is the positioning context).
    const fr = f.getBoundingClientRect(), hr = header.getBoundingClientRect();
    sbox.style.left = fr.left - hr.left + "px";
    sbox.style.top = fr.bottom - hr.top + 6 + "px";
    sbox.style.width = fr.width + "px";
    sbox.hidden = false;
    sugSel = -1;
    f.setAttribute("aria-expanded", "true");
  };
  // pointerdown (not click) + preventDefault: select before the input blurs.
  sbox.addEventListener("pointerdown", (e) => {
    const opt = e.target.closest(".opt");
    if (!opt) return;
    e.preventDefault();
    pickSug(opt);
  });
  f.addEventListener("input", () => { applyFilter(); showSug(); });
  f.addEventListener("focus", () => { if (f.value) showSug(); });
  f.addEventListener("blur", hideSug);
  f.addEventListener("keydown", (e) => {
    if (sbox.hidden) {
      if (e.key === "ArrowDown" && f.value) { e.preventDefault(); showSug(); }
      return;
    }
    const n = sbox.children.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sugSel = (sugSel + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      markSel();
    } else if (e.key === "Enter") {
      if (sugSel >= 0) { e.preventDefault(); pickSug(sbox.children[sugSel]); }
      else hideSug();
    }
  });

  // Mobile: menu button toggles the nav drawer; search button reveals the filter.
  const body = document.body, header = document.querySelector("header"),
    menuBtn = document.getElementById("menuBtn"), searchBtn = document.getElementById("searchBtn"),
    backdrop = document.getElementById("backdrop"), navEl = document.getElementById("nav");
  const isMobile = () => matchMedia("(max-width:760px)").matches;
  const setNav = (open) => {
    body.classList.toggle("nav-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
  };
  menuBtn.addEventListener("click", () => setNav(!body.classList.contains("nav-open")));
  document.getElementById("navClose").addEventListener("click", () => setNav(false));
  backdrop.addEventListener("click", () => setNav(false));
  // Close the drawer after picking an entry.
  navEl.addEventListener("click", (e) => { if (e.target.closest("a")) setNav(false); });

  const setSearch = (open) => {
    header.classList.toggle("search-open", open);
    searchBtn.setAttribute("aria-expanded", String(open));
    searchBtn.innerHTML = open ? ${JSON.stringify(CLOSE_ICON)} : ${JSON.stringify(SEARCH_ICON)};
    searchBtn.setAttribute("aria-label", open ? "Close search" : "Search");
    if (open) f.focus();
    else { hideSug(); if (isMobile()) { f.value = ""; applyFilter(); } }
  };
  searchBtn.addEventListener("click", () => setSearch(!header.classList.contains("search-open")));

  // Esc peels back one layer (suggestions → drawer → search → filter text);
  // "/" jumps to the filter from anywhere.
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!sbox.hidden) hideSug();
      else if (body.classList.contains("nav-open")) setNav(false);
      else if (header.classList.contains("search-open")) setSearch(false);
      else if (f.value) { f.value = ""; applyFilter(); }
      else f.blur();
    } else if (e.key === "/" && document.activeElement !== f) {
      e.preventDefault();
      if (isMobile()) setSearch(true); else f.focus();
      f.select();
    }
  });

  // Scrollspy: highlight the sidebar entry for the topmost on-screen article and
  // keep it visible in the sidebar's own scroll area. Articles are in document
  // order, so stop at the first one below the fold.
  const linkFor = new Map();
  for (const a of links) {
    const id = decodeURIComponent(a.getAttribute("href").slice(1));
    if (!linkFor.has(id)) linkFor.set(id, a);
  }
  let activeLink = null, spyQueued = false;
  const updateSpy = () => {
    if (spyQueued) return;
    spyQueued = true;
    requestAnimationFrame(() => {
      spyQueued = false;
      let current = null;
      for (const el of items) {
        if (el.style.display === "none") continue;
        if (el.getBoundingClientRect().top <= 90) current = el; else break;
      }
      const link = (current && linkFor.get(current.id)) ?? null;
      if (link === activeLink) return;
      activeLink?.classList.remove("active");
      activeLink = link;
      if (!activeLink) return;
      activeLink.classList.add("active");
      // Nudge the sidebar so the active entry stays in view (desktop; the mobile
      // drawer is closed while the page scrolls).
      const r = activeLink.getBoundingClientRect(), n = navEl.getBoundingClientRect();
      if (r.top < n.top + 40 || r.bottom > n.bottom - 40)
        navEl.scrollTop += r.top - (n.top + n.height / 2);
    });
  };
  addEventListener("scroll", updateSpy, { passive: true });
  updateSpy();
</script>
</body></html>`;

const outDir = join(root, "samples/api");
if (html.includes("__@"))
  throw new Error("Generated API docs contain an internal TypeScript symbol");

if (process.argv.includes("--check")) {
  console.log(
    `API docs ok (${allItems.length} exports across ${groups.length} public entry points)`,
  );
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.html"), html);
  console.log(
    `API docs → samples/api/index.html  (${allItems.length} exports across ${groups.length} public entry points)`,
  );
}
