/** Expand only flat ipairs lists of string literals used by stock model_data.lua. Never execute Lua. */
export function expandModelStringLoops(source: string): string {
  return source.replace(/^\s*for\s+(\w+)\s*,\s*(\w+)\s+in\s+ipairs\(\{([^}\n]+)\}\)\s+do\s*\n([\s\S]*?)^\s*end\s*$/gm,
    (whole, index: string, variable: string, list: string, body: string) => {
      // Deliberately refuse control flow inside these blocks. Numeric nested loops are handled separately.
      if (/^\s*(?:for|if|while|function|repeat)\b/m.test(body)) return whole;
      const values = list.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g) ?? [];
      if (!values.length || values.length > 32 || list.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '').replace(/[\s,]/g, '') !== '') return whole;
      return values.map((literal, i) => body.replace(/--[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b[a-zA-Z_]\w*\b/g,
        (token: string) => token === variable ? literal : token === index ? String(i + 1) : token)).join('\n');
    });
}
