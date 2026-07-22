// Generate the API reference page from minimotor's built TypeScript types.
//
//   pnpm run build && node tools/gen-api-docs.mjs   (or: pnpm run docs:api)
//
// Walks build/index.d.ts with the TypeScript compiler API, pulls every export
// (namespaces + their members, standalone functions, types/interfaces) together
// with its JSDoc, and writes a single self-contained page to samples/api/.
// No new dependency — `typescript` already ships as a devDep.
import ts from "typescript";
import { createHighlighter } from "shiki";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

// Real TS syntax highlighting (build-time; emits self-contained inline colors,
// no client JS). Shiki is a devDependency — the engine's runtime stays 0-dep.
const THEME = "github-dark-default";
const shiki = await createHighlighter({ themes: [THEME], langs: ["typescript"] });

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
// An interface member is "ours" if it's declared in the package (build/*.d.ts),
// not inherited from a lib type — otherwise `extends HTMLCanvasElement` etc.
// dump the whole DOM (hundreds of `(ev) => any` handlers) into the page.
const isOwnMember = (sym) =>
  (sym.declarations ?? []).some((d) => (d.getSourceFile?.().fileName ?? "").startsWith(buildDir));

const entries = [
  ["index", join(root, "build/index.d.ts")],
  ["physics2d", join(root, "build/physics2d.d.ts")],
  ["server", join(root, "build/server.d.ts")],
];

const program = ts.createProgram(
  entries.map(([, f]) => f),
  { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, skipLibCheck: true },
);
const checker = program.getTypeChecker();

const docOf = (sym) =>
  sym ? ts.displayPartsToString(sym.getDocumentationComment(checker)).trim() : "";

const sig = (type) =>
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
function describe(rawSym) {
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

  // Namespace object literal (`export const Draw = { ... }`): object type,
  // has members, no call signature of its own.
  const isObjectNamespace =
    !isNamespace &&
    callSigs.length === 0 &&
    props.length > 0 &&
    !(flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class));

  if (isNamespace) {
    const members = checker
      .getExportsOfModule(sym)
      .filter((m) => !(m.getFlags() & ts.SymbolFlags.Alias) || checker.getAliasedSymbol(m))
      .map((mem) => memberEntry(mem))
      .filter(Boolean);
    return { name, kind: "namespace", doc: docOf(sym), members };
  }
  if (isObjectNamespace) {
    return {
      name,
      kind: "namespace",
      doc: docOf(sym),
      members: props.map((mem) => memberEntry(mem)).filter(Boolean),
    };
  }
  if (callSigs.length > 0) {
    return { name, kind: "function", doc: docOf(sym), signature: name + sig(type), members: [] };
  }
  if (flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class)) {
    // Use the DECLARED type (the interface itself), not the value type — the
    // latter is `any` for a type-only interface, yielding no members.
    const iprops = checker
      .getDeclaredTypeOfSymbol(sym)
      .getProperties()
      .filter(isOwnMember) // drop members inherited from lib types (e.g. DOM)
      .map((p) => {
        const pd = p.declarations?.[0];
        const pt = pd ? checker.getTypeOfSymbolAtLocation(p, pd) : null;
        const opt = p.getFlags() & ts.SymbolFlags.Optional ? "?" : "";
        const name = `${p.getName()}${opt}`;
        return { name, signature: `${name}: ${pt ? sig(pt) : "unknown"}`, doc: docOf(p) };
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
    return { name, kind: "type", doc: docOf(sym), signature: `= ${rhs}`, members: [] };
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

const isMethod = (p) => {
  const pd = p.declarations?.[0];
  return pd && checker.getTypeOfSymbolAtLocation(p, pd).getCallSignatures().length > 0;
};

function memberEntry(m, depth = 0) {
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
      const members = own.map((p) => memberEntry(p, depth + 1)).filter(Boolean);
      if (members.length) return { name, kind: "namespace", doc: docOf(sym), members };
    }
  }
  // Methods render as `name(args) => ret`; other props as `name: Type`.
  const isFn = type.getCallSignatures().length > 0;
  const signature = isFn ? name + sig(type) : `${name}: ${sig(type)}`;
  return { name, kind: isFn ? "function" : "value", signature, doc: docOf(sym) };
}

// ---- collect all modules ----
const groups = [];
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
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Highlight a TS snippet with Shiki → inline-colored spans (works for a single
// signature line and for multi-line code examples alike).
function highlightSig(code) {
  const { tokens } = shiki.codeToTokens(code, { lang: "typescript", theme: THEME });
  return tokens
    .map((line) =>
      line
        .map((t) => {
          const span = `<span style="color:${t.color}">${esc(t.content)}</span>`;
          // A token that names a documented export → link to its anchor.
          const target = linkTarget.get(t.content);
          return target ? `<a class="tlink" href="#${esc(target)}">${span}</a>` : span;
        })
        .join(""),
    )
    .join("\n");
}

// Render a JSDoc string as a small markdown subset: fenced ```code``` blocks,
// inline `code` (type-highlighted) and **bold**. Everything else stays literal.
function inlineMd(s) {
  let out = "";
  let last = 0;
  let m;
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
function codeBlock(lines) {
  const body = [...lines];
  while (body.length && body[0].trim() === "") body.shift();
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  if (!body.length) return "";
  const min = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length));
  const src = body.map((l) => l.slice(min)).join("\n");
  return `<pre class="doc-code"><code class="sig">${highlightSig(src)}</code></pre>`;
}
function renderDoc(text) {
  // Fenced ```blocks``` split out first; then, within prose, runs of indented
  // lines (JSDoc examples use a 2-space indent) become code blocks too.
  const fenced = text.split(/```[a-z]*\n?([\s\S]*?)```/g);
  let html = "";
  for (let i = 0; i < fenced.length; i++) {
    if (i % 2) {
      html += codeBlock(fenced[i].split("\n"));
      continue;
    }
    let prose = [];
    let code = [];
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

const kindRank = { namespace: 0, function: 1, interface: 2, type: 3, value: 4 };
// A little glyph per kind, so you can scan the type of each entry at a glance.
const ICON = { namespace: "{}", function: "ƒ", interface: "I", type: "T", value: "◆" };

// A member is either a leaf (signature) or a sub-namespace (nested members).
// `path` is the qualified prefix (e.g. "Audio" / "Audio.Mixer") → each member
// gets a unique anchor id like "Audio.Mixer.bus".
function renderMember(m, path) {
  const id = `${path}.${m.name}`;
  const mdoc = m.doc ? `<span class="mdoc">${inlineMd(m.doc)}</span>` : "";
  if (m.members?.length) {
    return `<div class="member sub" id="${esc(id)}"><div class="subhead">${esc(m.name)}</div>${mdoc}<div class="members nested">${m.members.map((x) => renderMember(x, id)).join("")}</div></div>`;
  }
  return `<div class="member" id="${esc(id)}"><code class="sig">${highlightSig(m.signature)}</code>${mdoc}</div>`;
}

// Flatten a member tree into qualified names, for the article's search text.
function memberSearch(members, path) {
  return members.flatMap((m) => {
    const id = `${path}.${m.name}`;
    return m.members?.length ? [id, ...memberSearch(m.members, id)] : [id];
  });
}

function renderItem(it) {
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
  return `<article class="item" id="${esc(slug)}" data-name="${esc(search)}">
    <h3><span class="ico ${it.kind}">${ICON[it.kind] ?? "?"}</span>${esc(label)} <span class="kind ${it.kind}">${it.kind}</span></h3>
    ${doc}${body}
  </article>`;
}

// Names that already appear as a member of some namespace (e.g. Collision's
// slide/moveAndSlide, also exported standalone) — so we don't also list them as
// top-level functions. They belong inside their namespace.
const memberNames = new Set();
for (const g of groups)
  for (const it of g.items) for (const m of it.members ?? []) memberNames.add(m.name);

// Which namespace re-exports each type — so top-level types can be labeled
// `Namespace.Type` (e.g. `Audio.SfxSpec`, `Anim.SheetOptions`) in the sidebar,
// filter and heading. Built from each `import * as X` namespace's type exports.
const typeOwner = new Map();
for (const [, file] of entries) {
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
      if (ef & TYPE_FLAGS && !(ef & VALUE_FLAGS) && !typeOwner.has(e.getName()))
        typeOwner.set(e.getName(), s.getName());
    }
  }
}

const flat = groups
  .flatMap((g) => g.items.map((it) => ({ ...it, module: g.label })))
  .filter((it) => it.kind !== "function" || !memberNames.has(it.name));

// Promote nested sub-namespaces (Audio.Music, Audio.Mixer) to their OWN cards;
// the parent keeps just its direct functions/properties. They sort right after
// the parent (label "Audio" < "Audio.Mixer"), so in the sidebar they land after
// the namespace's own members, at the top level (not indented).
const expanded = flat.flatMap((it) => {
  if (it.kind !== "namespace" || !it.members?.some((m) => m.members?.length)) return [it];
  const subs = it.members.filter((m) => m.members?.length);
  const leaves = it.members.filter((m) => !m.members?.length);
  return [
    { ...it, members: leaves },
    ...subs.map((s) => ({
      name: `${it.name}.${s.name}`,
      kind: "namespace",
      doc: s.doc,
      members: s.members,
      module: it.module,
    })),
  ];
});

const allItems = expanded.map((it) => {
  // Prefix types with their owning namespace where known (only the main-entry
  // types — a same-named type in `minimotor/server` isn't the Net one).
  const owner =
    it.module === "index" &&
    (it.kind === "type" || it.kind === "interface") &&
    typeOwner.get(it.name);
  return { ...it, label: owner ? `${owner}.${it.name}` : it.name };
});
allItems.sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || a.label.localeCompare(b.label));

// Some names are exported by more than one entry point (e.g. `Room` from both
// `minimotor` and `minimotor/server`) — give each a unique anchor slug and tag
// the label with its module so navigation doesn't clash.
const nameCount = new Map();
for (const it of allItems) nameCount.set(it.name, (nameCount.get(it.name) ?? 0) + 1);
for (const it of allItems) {
  const dup = nameCount.get(it.name) > 1 && it.module !== "index";
  it.slug = dup ? `${it.module}.${it.name}` : it.name;
  if (dup) it.label = `${it.label} · ${it.module}`;
}
// Token → anchor for clickable types; only unambiguous names (skip the dupes).
const linkTarget = new Map();
for (const it of allItems) if (nameCount.get(it.name) === 1) linkTarget.set(it.name, it.slug);

// Sidebar member sub-links (indented), so functions like `Draw.rect` are
// directly navigable — anchor ids match renderMember's.
function navMembers(members, path, depth = 0) {
  return members
    .map((m) => {
      const id = `${path}.${m.name}`;
      const isSub = m.members?.length;
      // Sub-namespaces show their qualified name (Audio.Music); leaf methods the
      // bare name. Slightly indented under their namespace, each with a kind icon.
      const label = isSub ? id : m.name;
      const self = `<a class="sub" style="padding-left:${20 + depth * 12}px" href="#${esc(id)}" data-name="${esc(id.toLowerCase())}"><span class="ico ${m.kind}">${ICON[m.kind] ?? "?"}</span>${esc(label)}</a>`;
      return isSub ? self + navMembers(m.members, id, depth + 1) : self;
    })
    .join("");
}
const nav = allItems
  .map(
    (it) =>
      `<a href="#${esc(it.slug)}" data-name="${esc(it.label.toLowerCase())}"><span class="ico ${it.kind}">${ICON[it.kind] ?? "?"}</span>${esc(it.label)}</a>` +
      // Only namespaces list members in the sidebar (functions / sub-namespaces);
      // interface data-fields would just be noise.
      (it.kind === "namespace" && it.members?.length ? navMembers(it.members, it.slug) : ""),
  )
  .join("");
// Native autocomplete for the filter box — every export label + member path.
const datalist = allItems
  .flatMap((it) => [it.label, ...memberSearch(it.members ?? [], it.name)])
  .map((v) => `<option value="${esc(v)}"></option>`)
  .join("");
const body = allItems.map(renderItem).join("\n");

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Minimotor · API reference</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0d0f12;--panel:#16191e;--border:#2a2f38;--text:#e7ecf0;--dim:#8b94a0;--accent:#4ecdc4;--accent2:#ffd166}
  body{font-family:"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.55}
  a{color:var(--accent);text-decoration:none}
  /* Match the landing page's 56px sticky navbar exactly. */
  header{height:56px;border-bottom:1px solid var(--border);padding:0 20px;display:flex;align-items:center;gap:14px;position:sticky;top:0;background:rgba(13,15,18,.82);backdrop-filter:blur(8px);z-index:5}
  header .brand{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--text);letter-spacing:.2px}
  header input{margin-left:auto;background:var(--panel);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 12px;font-size:.9rem;width:min(280px,40vw)}
  .layout{display:grid;grid-template-columns:230px 1fr;max-width:1180px;margin:0 auto}
  /* align-self:start stops the grid from stretching the aside to full content
     height, which would defeat position:sticky. */
  aside{align-self:start;border-right:1px solid var(--border);padding:20px 12px;position:sticky;top:57px;height:calc(100vh - 57px);overflow:auto}
  aside a{display:flex;align-items:center;gap:7px;color:var(--dim);font-size:.85rem;padding:3px 8px;border-radius:6px;font-family:ui-monospace,monospace}
  aside a:hover{color:var(--text);background:var(--panel)}
  /* member sub-links: slightly indented, dimmer; icon distinguishes the kind */
  aside a.sub{font-size:.8rem;color:var(--dim)}
  aside a.sub:hover{color:var(--text)}
  .ico{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 auto;border-radius:6px;border:1px solid var(--border);font-family:ui-monospace,monospace;font-size:.72rem;font-weight:700;line-height:1}
  aside .ico{width:17px;height:17px;font-size:.6rem;border-radius:5px}
  .ico.namespace{color:var(--accent);border-color:var(--accent)}
  .ico.function{color:#82aaff;border-color:#82aaff88}
  .ico.interface,.ico.type{color:var(--accent2);border-color:#ffd16688}
  .ico.value{color:var(--dim)}
  main{padding:28px 32px 80px;min-width:0}
  main>p.lead{color:var(--dim);margin-bottom:26px;max-width:70ch}
  /* scroll-margin-top keeps a clicked anchor clear of the 56px sticky navbar. */
  .item{border:1px solid var(--border);background:var(--panel);border-radius:12px;padding:20px 22px;margin-bottom:16px;scroll-margin-top:72px}
  .item h3{font-family:ui-monospace,monospace;font-size:1.25rem;display:flex;align-items:center;gap:10px}
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
</style></head>
<body>
<header>
  <a class="brand" href="../">
    <svg width="24" height="24" viewBox="0 0 32 32"><rect x="2" y="4" width="28" height="24" rx="5" fill="none" stroke="#4ecdc4" stroke-width="2.4"/><rect x="8" y="18" width="4" height="6" rx="1" fill="#4ecdc4"/><rect x="14" y="13" width="4" height="11" rx="1" fill="#4ecdc4"/><rect x="20" y="9" width="4" height="15" rx="1" fill="#ffd166"/></svg>
    minimotor
  </a>
  <span style="color:var(--dim)">API reference</span>
  <input id="filter" type="search" placeholder="Filter types…" autocomplete="off" list="api-names" />
  <datalist id="api-names">${datalist}</datalist>
</header>
<div class="layout">
  <aside id="nav">${nav}</aside>
  <main>
    ${body}
  </main>
</div>
<footer>Generated from build/*.d.ts · <a href="../">back to samples</a></footer>
<script>
  const f=document.getElementById("filter"),items=[...document.querySelectorAll(".item")],links=[...document.querySelectorAll("#nav a")];
  f.addEventListener("input",()=>{const q=f.value.toLowerCase();
    for(const el of items) el.style.display = !q||el.dataset.name.includes(q)?"":"none";
    for(const el of links) el.style.display = !q||el.dataset.name.includes(q)?"":"none";
  });
</script>
</body></html>`;

const outDir = join(root, "samples/api");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), html);
console.log(
  `API docs → samples/api/index.html  (${allItems.length} exports across ${groups.length} modules)`,
);
