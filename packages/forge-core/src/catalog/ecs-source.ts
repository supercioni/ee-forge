import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EECatalog } from "@forge/contracts";

/** Fill omissions in the 2026 HTML using declarations in that same installation.
 * This is a bounded declaration reader, not a Lua interpreter. No legacy catalog
 * is merged: every factory and optional argument has current source evidence.
 */
export function supplementEcsSources(catalog: EECatalog, apiDir: string): void {
  if (!catalog.classes["Entity"]) return;
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.name.endsWith(".lua")) continue;
      const source = readFileSync(path, "utf8");
      // Function bodies end at the next top-level `end`, as in EE's API files.
      for (const match of source.matchAll(/^function (\w+)(?::(\w+))?\(([^)]*)\)([\s\S]*?)^end/gm)) {
        const owner = match[1]!;
        const name = match[2];
        const body = match[4] ?? "";
        if (!name && /^\s*local \w+ = createEntity\(\)/.test(body)) {
          catalog.classes[owner] ??= { name: owner, description: `Factory declared in scripts/api/${entry.name}`, subclassOf: "Entity", methods: [] };
          if (!catalog.globals.some((g) => g.name === owner)) {
            catalog.globals.push({ name: owner, kind: "method", params: [], returns: ["Entity"], doc: `Factory declared in scripts/api/${entry.name}`, example: null });
          }
        }
        // Undocumented methods such as orderRoamingAt still have a declaration.
        if (name && !name.startsWith("__") && catalog.classes[owner] &&
            !catalog.classes[owner]!.methods.some((m) => m.name === name)) {
          catalog.classes[owner]!.methods.push({ name, kind: "method", params: (match[3] ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => ({ type: "", name: p === "..." ? "values" : p, optional: p === "...", variadic: p === "...", defaultValue: null })), returns: [], doc: `Declared in scripts/api/${entry.name}`, example: null });
        }
        const method = name
          ? catalog.classes[owner]?.methods.find((m) => m.name === name)
          : catalog.globals.find((m) => m.name === owner);
        if (!method) continue;
        for (const param of method.params) {
          if (!/^\w+$/.test(param.name)) continue;
          const fallback = new RegExp(`\\bif\\s+${param.name}\\s*==\\s*nil\\s+then\\s+${param.name}\\s*=`);
          const orDefault = new RegExp(`\\b${param.name}\\s+or\\s+`);
          if (fallback.test(body) || orDefault.test(body)) {
            param.optional = true;
            param.defaultValue = "nil";
          }
        }
      }
    }
  };
  visit(apiDir);
  // Native entity lifecycle methods: verified over /exec.lua on 20260922,
  // and described in docs/ee-api-reference.md §16. They are not in API Lua.
  for (const name of ["isValid", "destroy"]) {
    if (!catalog.classes["Entity"]!.methods.some((m) => m.name === name)) {
      catalog.classes["Entity"]!.methods.push({ name, kind: "method", params: [], returns: name === "isValid" ? ["boolean"] : [], doc: "Native entity lifecycle; verified on EE 20260922 (API reference §16).", example: null });
    }
  }
  // System names are explicitly enumerated by __getSystemByName in this install.
  const shipSource = readFileSync(join(apiDir, "entity", "spaceship.lua"), "utf8");
  const systems = [...new Set([...shipSource.matchAll(/system_name == "([^"\n]+)"/g)].map((m) => m[1]!))];
  catalog.enums["ESystem"] = { name: "ESystem", description: "scripts/api/entity/spaceship.lua: __getSystemByName", values: systems };
  for (const method of catalog.classes["Entity"]!.methods) {
    for (const param of method.params) {
      if (param.name === "system_name") param.type = "ESystem";
    }
    // Numeric contracts documented in multiuse.lua and spaceship.lua.
    if (method.name === "setSize" && method.params[0]) method.params[0].type = "number";
    if (method.name === "setSystemHealth" && method.params[1]) method.params[1].type = "number";
  }
}
