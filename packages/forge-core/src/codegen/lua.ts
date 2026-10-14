import { lookupMethod, type EECatalog, type EEMethod } from "@forge/contracts";

/**
 * Lua rendering primitives, with every emitted call checked against the
 * generated EE API catalog.
 *
 * This module is where root `CLAUDE.md` §0.3 ("never invent EE Lua API")
 * becomes mechanical: `renderChain` and `renderGlobalCall` refuse to
 * produce text for a method that does not resolve in the catalog, so an
 * invented call is a build failure rather than a runtime surprise in EE
 * (ADR-0034 §2).
 */

export class CodegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodegenError";
  }
}

export type LuaValue =
  | { readonly k: "number"; readonly v: number }
  | { readonly k: "string"; readonly v: string }
  | { readonly k: "boolean"; readonly v: boolean }
  | { readonly k: "nil" }
  /** A verbatim Lua expression — variable names, function calls, tables. */
  | { readonly k: "raw"; readonly v: string };

export const num = (v: number): LuaValue => ({ k: "number", v });
export const str = (v: string): LuaValue => ({ k: "string", v });
export const bool = (v: boolean): LuaValue => ({ k: "boolean", v });
export const nil: LuaValue = { k: "nil" };
export const raw = (v: string): LuaValue => ({ k: "raw", v });

/**
 * Lua long strings (`[[...]]`) are tempting for prose but break on `]]`
 * and on leading newlines, so everything goes through quoted escaping.
 */
export function luaString(value: string): string {
  let out = "";
  for (const ch of value) {
    switch (ch) {
      case "\\":
        out += "\\\\";
        break;
      case '"':
        out += '\\"';
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      default: {
        const code = ch.codePointAt(0) ?? 0;
        // Escape C0 controls; leave everything else (incl. UTF-8) intact.
        out += code < 0x20 ? `\\${code}` : ch;
      }
    }
  }
  return `"${out}"`;
}

export function renderValue(value: LuaValue): string {
  switch (value.k) {
    case "number":
      if (!Number.isFinite(value.v)) {
        throw new CodegenError(`non-finite number cannot be emitted: ${String(value.v)}`);
      }
      // Avoid exponent notation, which EE's Lua accepts but which makes
      // generated files hard to diff against hand-written scenarios.
      return Number.isInteger(value.v) ? value.v.toFixed(0) : String(value.v);
    case "string":
      return luaString(value.v);
    case "boolean":
      return value.v ? "true" : "false";
    case "nil":
      return "nil";
    case "raw":
      return value.v;
  }
}

/** `{ key = value, … }` with deterministic key order. */
export function luaTable(entries: Record<string, LuaValue>): string {
  const keys = Object.keys(entries).sort();
  if (keys.length === 0) return "{}";
  const body = keys
    .map((k) => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `[${luaString(k)}]`} = ${renderValue(entries[k] as LuaValue)}`)
    .join(", ");
  return `{ ${body} }`;
}

/** Convert arbitrary JSON (from a project's action payload) to a Lua table. */
export function jsonToLua(value: unknown): LuaValue {
  if (value === null || value === undefined) return nil;
  if (typeof value === "number") return num(value);
  if (typeof value === "boolean") return bool(value);
  if (typeof value === "string") return str(value);
  if (Array.isArray(value)) {
    return raw(`{ ${value.map((v) => renderValue(jsonToLua(v))).join(", ")} }`);
  }
  if (typeof value === "object") {
    const entries: Record<string, LuaValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      entries[k] = jsonToLua(v);
    }
    return raw(luaTable(entries));
  }
  throw new CodegenError(`value of type ${typeof value} cannot be emitted as Lua`);
}

export interface CallSpec {
  readonly method: string;
  readonly args: readonly LuaValue[];
}

/**
 * Enums the emitter checks strictly. `EAlertLevel` and `Color` are omitted
 * on purpose: EE documents both as accepting values beyond the listed set
 * (mixed-case alert strings; hex and rgb colour literals).
 */
const STRICT_ENUMS = new Set([
  "ESystem",
  "EMissileWeapons",
  "EMissileSizes",
  "EMainScreenSetting",
  "EMainScreenOverlay",
  "ECrewPosition",
  "EScannedState",
]);

function checkArgs(
  catalog: EECatalog,
  qualifiedName: string,
  method: EEMethod,
  args: readonly LuaValue[],
): void {
  const variadic = method.params.some((p) => p.variadic);
  const required = method.params.filter((p) => !p.optional && !p.variadic).length;
  const max = variadic ? Number.POSITIVE_INFINITY : method.params.length;

  if (args.length < required || args.length > max) {
    const expected = variadic ? `${required}+` : `${required}..${method.params.length}`;
    throw new CodegenError(
      `${qualifiedName} expects ${expected} argument(s), got ${args.length}`,
    );
  }

  method.params.forEach((param, i) => {
    const arg = args[i];
    if (arg === undefined || arg.k === "raw" || arg.k === "nil") return;
    if (param.type === "number" && arg.k !== "number") {
      throw new CodegenError(
        `${qualifiedName} argument ${i + 1} (${param.name}) must be a number, got ${arg.k}`,
      );
    }
    if (param.type === "string" && arg.k !== "string") {
      throw new CodegenError(
        `${qualifiedName} argument ${i + 1} (${param.name}) must be a string, got ${arg.k}`,
      );
    }
    if (param.type === "boolean" && arg.k !== "boolean") {
      throw new CodegenError(
        `${qualifiedName} argument ${i + 1} (${param.name}) must be a boolean, got ${arg.k}`,
      );
    }
    if (STRICT_ENUMS.has(param.type) && arg.k === "string") {
      const values = catalog.enums[param.type]?.values ?? [];
      if (values.length > 0 && !values.includes(arg.v)) {
        throw new CodegenError(
          `${qualifiedName} argument ${i + 1} (${param.name}) must be one of ${values.join(", ")}, got "${arg.v}"`,
        );
      }
    }
  });
}

/** Validate one method call against the catalog. Throws on anything unknown. */
export function validateCall(
  catalog: EECatalog,
  className: string,
  call: CallSpec,
): void {
  const found = lookupMethod(catalog, className, call.method);
  if (found === null) {
    throw new CodegenError(
      `${className}:${call.method} does not exist in ${catalog.eeVersion} — refusing to invent EE API (CLAUDE.md §0.3)`,
    );
  }
  checkArgs(catalog, `${className}:${call.method}`, found.method, call.args);
}

export interface ChainOptions {
  /** Indentation prefix for continuation lines. */
  readonly indent?: string;
  /** Emit as a single line regardless of length. */
  readonly inline?: boolean;
}

/**
 * `Ctor():setA(1):setB(2)` — EE's idiomatic constructor chain.
 *
 * `subject` is either a constructor name (rendered `Name()`) or a raw
 * expression such as an existing local. Every call is catalog-checked
 * against `className`.
 */
export function renderChain(
  catalog: EECatalog,
  className: string,
  subject: LuaValue,
  calls: readonly CallSpec[],
  options: ChainOptions = {},
): string {
  for (const call of calls) validateCall(catalog, className, call);

  const head = renderValue(subject);
  const parts = calls.map(
    (c) => `:${c.method}(${c.args.map(renderValue).join(", ")})`,
  );
  if (parts.length === 0) return head;

  const oneLine = head + parts.join("");
  if (options.inline === true || oneLine.length <= 96) return oneLine;

  const indent = options.indent ?? "";
  return head + parts.map((p) => `\n${indent}  ${p}`).join("");
}

/** `Ctor()` as a subject for {@link renderChain}. */
export function ctor(className: string): LuaValue {
  return raw(`${className}()`);
}

/** A top-level EE function call (`victory("Human Navy")`). */
export function renderGlobalCall(
  catalog: EECatalog,
  name: string,
  args: readonly LuaValue[],
): string {
  const fn = catalog.globals.find((g) => g.name === name);
  if (fn === undefined) {
    throw new CodegenError(
      `global ${name}() does not exist in ${catalog.eeVersion} — refusing to invent EE API (CLAUDE.md §0.3)`,
    );
  }
  checkArgs(catalog, `${name}()`, fn, args);
  return `${name}(${args.map(renderValue).join(", ")})`;
}

/** Indent every non-empty line of a block. */
export function indentBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? line : indent + line))
    .join("\n");
}
