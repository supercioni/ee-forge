import type {
  EECatalog,
  EEClass,
  EEEnum,
  EEMethod,
  EEParam,
} from "@forge/contracts";

/**
 * Parser for EmptyEpsilon's `script_reference.html`.
 *
 * The file ships with every EE install and is the closest thing to a
 * machine-readable API description EE has. Its shape (EE-2024.12.08):
 *
 *   <div class="section">
 *     <a name="class_Asteroid"></a><h2>Asteroid</h2>
 *     <div>…prose description with <br> separators…</div>
 *     Subclass of: <a href="#class_SpaceObject">SpaceObject</a>
 *     <dl>
 *       <dt><a href="#class_Asteroid">Asteroid</a> Asteroid:setSize(number size)</dt>
 *       <dd>Sets this Asteroid's radius.<br> Example: asteroid:setSize(150)</dd>
 *       …
 *     </dl>
 *   </div>
 *
 * Globals live in their own section using <li> instead of <dt>, and the
 * enums are prose bullets (`<li><a name="enum_ESystem">…`) whose valid
 * values appear as quoted strings.
 *
 * Deliberately hand-rolled rather than pulling in an HTML parser: the
 * package must stay dependency-light (ADR-0034 §7) and the markup is
 * regular enough that regex over `<div class="section">` slices is both
 * adequate and easy to assert against.
 */

/** Strip tags, decode the handful of entities EE emits, collapse spaces. */
function textOf(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a parameter list on top-level commas. EE never nests parentheses
 * inside a parameter list, but callback types (`ScriptSimpleCallback`)
 * and defaults (`number timeout=nil`) both contain no commas either — so
 * a depth counter is belt-and-braces against future reference changes.
 */
function splitParams(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of raw) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") out.push(current);
  return out.map((p) => p.trim()).filter((p) => p !== "");
}

function parseParam(raw: string): EEParam {
  // Shapes seen in EE-2024.12.08:
  //   "number size"                     type + name
  //   "number timeout=nil"              type + name + default
  //   "number values..."                variadic
  //   "string classes..."               variadic
  //   "SpaceObject target"              class-typed
  //   "TemplateType type"               enum-typed
  //   "callback"                        bare name, no type
  let text = raw.trim();
  let variadic = false;
  if (text.endsWith("...")) {
    variadic = true;
    text = text.slice(0, -3).trim();
  }

  let defaultValue: string | null = null;
  const eq = text.indexOf("=");
  if (eq >= 0) {
    defaultValue = text.slice(eq + 1).trim();
    text = text.slice(0, eq).trim();
  }

  const parts = text.split(/\s+/);
  if (parts.length >= 2) {
    const name = parts[parts.length - 1] ?? "";
    const type = parts.slice(0, -1).join(" ");
    return { type, name, optional: defaultValue !== null, variadic, defaultValue };
  }
  return {
    type: "",
    name: parts[0] ?? "",
    optional: defaultValue !== null,
    variadic,
    defaultValue,
  };
}

/**
 * Split "number x, number y SpaceObject:getPosition()" into its return
 * types and the qualified call. The class-qualified name is the anchor:
 * everything before the last `Word:` token is the return declaration.
 */
function parseSignature(
  signature: string,
): { returns: string[]; owner: string; name: string; params: EEParam[] } | null {
  const call = /([A-Za-z_][A-Za-z0-9_]*):([A-Za-z_][A-Za-z0-9_]*)\s*(\((.*)\))?\s*$/.exec(
    signature,
  );
  if (call === null) return null;

  const owner = call[1] ?? "";
  const name = call[2] ?? "";
  const hasParens = call[3] !== undefined;
  const paramText = call[4] ?? "";

  const returnText = signature.slice(0, call.index).trim();
  const returns = returnText === "" ? [] : splitParams(returnText).map((r) => r.trim());

  return {
    returns,
    owner,
    name,
    params: hasParens ? splitParams(paramText).map(parseParam) : [],
  };
}

/** Lift the first `Example:` sentence out of a doc blob. */
function exampleOf(doc: string): string | null {
  const m = /Example:\s*(.+?)(?:\s*Returns the object it was called on\.)?$/.exec(doc);
  return m?.[1]?.trim() ?? null;
}

function parseMethods(dlHtml: string, ownerFilter: string | null): EEMethod[] {
  const methods: EEMethod[] = [];
  const entry = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(dlHtml)) !== null) {
    const signature = textOf(m[1] ?? "");
    const doc = textOf(m[2] ?? "");
    const parsed = parseSignature(signature);
    if (parsed === null) continue;
    // A <dt> repeats the owning class as its return type
    // ("Artifact Artifact:setSpin(...)"), so filter on the qualified name
    // to skip inherited entries the reference re-lists under a subclass.
    if (ownerFilter !== null && parsed.owner !== ownerFilter) continue;

    const isMember = !signature.includes("(");
    methods.push({
      name: parsed.name,
      kind: isMember ? "member" : "method",
      params: parsed.params,
      returns: parsed.returns,
      doc,
      example: exampleOf(doc),
    });
  }
  return methods;
}

function parseGlobals(sectionHtml: string): EEMethod[] {
  const methods: EEMethod[] = [];
  // <li>number random(number min_value, number max_value)<dd>doc</dd>
  const entry = /<li>([\s\S]*?)<dd>([\s\S]*?)<\/dd>/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(sectionHtml)) !== null) {
    const signature = textOf(m[1] ?? "");
    const doc = textOf(m[2] ?? "");
    const call = /^(.*?)\b([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/.exec(signature);
    if (call === null) continue;
    const returnText = (call[1] ?? "").trim();
    methods.push({
      name: call[2] ?? "",
      kind: "method",
      params: splitParams(call[3] ?? "").map(parseParam),
      returns: returnText === "" ? [] : splitParams(returnText).map((r) => r.trim()),
      doc,
      example: exampleOf(doc),
    });
  }
  return methods;
}

function parseEnums(html: string): Record<string, EEEnum> {
  const enums: Record<string, EEEnum> = {};
  const entry = /<li><a name="enum_([A-Za-z_][A-Za-z0-9_]*)"[^>]*>[\s\S]*?<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(html)) !== null) {
    const name = m[1] ?? "";
    const body = textOf(m[0] ?? "");
    // Values are the quoted strings in the prose; EDockingState is numeric
    // and legitimately yields none.
    const values = [...body.matchAll(/"([^"]*)"/g)]
      .map((v) => v[1] ?? "")
      .filter((v) => v !== "");
    enums[name] = {
      name,
      description: body,
      values: [...new Set(values)],
    };
  }
  return enums;
}

export interface ParseOptions {
  eeVersion: string;
  source: string;
  /** Injected so generated output is reproducible in tests. */
  generatedAt?: string;
}

export function parseScriptReference(html: string, opts: ParseOptions): EECatalog {
  if (/<div\s+id="entity"\s+class="section">/.test(html)) return parseEcsReference(html, opts);
  const classes: Record<string, EEClass> = {};
  let globals: EEMethod[] = [];

  // Sections are flat siblings; slicing on the opening tag is enough
  // because the reference never nests one section inside another.
  const sections = html.split('<div class="section">');
  for (const section of sections) {
    const classMatch = /<a name="class_([A-Za-z_][A-Za-z0-9_]*)"><\/a>\s*<h2>/.exec(section);
    if (classMatch !== null) {
      const name = classMatch[1] ?? "";
      const descMatch = /<h2>[^<]*<\/h2>\s*<div>([\s\S]*?)<\/div>/.exec(section);
      const subMatch = /Subclass of:\s*<a href="#class_([A-Za-z_][A-Za-z0-9_]*)">/.exec(
        section,
      );
      const dlMatch = /<dl>([\s\S]*?)<\/dl>/.exec(section);
      classes[name] = {
        name,
        description: textOf(descMatch?.[1] ?? ""),
        subclassOf: subMatch?.[1] ?? null,
        methods: dlMatch === null ? [] : parseMethods(dlMatch[1] ?? "", name),
      };
      continue;
    }
    if (/<h2>Functions<\/h2>/.test(section)) {
      globals = parseGlobals(section);
    }
  }

  return {
    eeVersion: opts.eeVersion,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    source: opts.source,
    classes,
    globals,
    enums: parseEnums(html),
  };
}

/** EE 2026 reference: factories plus a shared Entity method table (ADR-0042). */
function parseEcsReference(html: string, opts: ParseOptions): EECatalog {
  const classes: Record<string, EEClass> = {};
  const globals: EEMethod[] = [];
  const ensureClass = (name: string): EEClass => classes[name] ??= {
    name, description: "", subclassOf: null, methods: [],
  };
  const section = (id: string): string => {
    const start = html.indexOf(`<div id="${id}" class="section">`);
    if (start < 0) return "";
    const end = html.indexOf('<div id="', start + 1);
    return html.slice(start, end < 0 ? undefined : end);
  };
  const entries = (part: string) => [...part.matchAll(/<li>\s*((?:(?!<li>)[\s\S])*?)<dd>([\s\S]*?)<\/dd>\s*<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>\s*<\/li>/g)];
  const decode = (value: string) => textOf(value).replace(/&#x27;/g, "'");
  const params = (value: string) => splitParams(value).map((raw) => {
    if (/^\.\.\.?$/.test(raw)) return { type: "", name: "values", optional: true, variadic: true, defaultValue: null };
    const param = parseParam(raw);
    const optional = /^std::optional<(.+)>$/.exec(param.type);
    if (optional) { param.type = optional[1]!; param.optional = true; param.defaultValue = "nil"; }
    if (["float", "int", "double"].includes(param.type)) param.type = "number";
    return param;
  });
  for (const entry of entries(section("creation"))) {
    const call = /^([A-Za-z_]\w*)\((.*)\)$/.exec(decode(entry[1] ?? ""));
    if (!call) continue;
    const name = call[1]!;
    const cls = ensureClass(name);
    cls.subclassOf = "Entity";
    cls.description = decode(entry[2] ?? "");
    globals.push({ name, kind: "method", params: params(call[2] ?? ""), returns: ["Entity"], doc: cls.description, example: decode(entry[3] ?? "") || null });
  }
  for (const entry of entries(section("entity"))) {
    const call = /^([A-Za-z_]\w*):([A-Za-z_]\w*)\((.*)\)$/.exec(decode(entry[1] ?? ""));
    if (!call) continue;
    ensureClass(call[1]!).methods.push({ name: call[2]!, kind: "method", params: params(call[3] ?? ""), returns: [], doc: decode(entry[2] ?? ""), example: decode(entry[3] ?? "") || null });
  }
  for (const entry of entries(section("global"))) {
    const signature = decode(entry[1] ?? "");
    const call = /^([A-Za-z_]\w*)\((.*)\)$/.exec(signature);
    if (!call) continue;
    const doc = decode(entry[2] ?? "");
    // C++ globals retain a typed declaration at the start of the prose.
    const typed = new RegExp(`^(.+?)\\b${call[1]}\\(([^)]*)\\)`).exec(doc);
    globals.push({ name: call[1]!, kind: "method", params: params(typed?.[2] ?? call[2] ?? ""), returns: typed ? splitParams(typed[1] ?? "") : [], doc, example: decode(entry[3] ?? "") || null });
  }
  const enums: Record<string, EEEnum> = {};
  for (const match of section("types").matchAll(/<li><a name="enum_(\w+)"[^>]*>[^<]*<\/a>:\s*([\s\S]*?)<\/li>/g)) {
    const name = match[1]!;
    const description = decode(match[2] ?? "");
    enums[name] = { name, description, values: [...new Set(description.split(",").map((v) => v.trim()).filter(Boolean))] };
  }
  return { eeVersion: opts.eeVersion, generatedAt: opts.generatedAt ?? new Date().toISOString(), source: opts.source, classes, globals, enums };
}
