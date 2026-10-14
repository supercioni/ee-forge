/**
 * Minimal reader for EmptyEpsilon's Lua *data* scripts.
 *
 * `model_data.lua`, `shiptemplates/*.lua` and `factionInfo.lua` are not
 * general programs — they are long lists of chained setter calls on a few
 * locals. That regularity is what makes them scannable, and scanning them
 * is the only way to enumerate an install's content: EE exposes no Lua API
 * that lists templates, models or factions (ADR-0034 §Context).
 *
 * This is intentionally NOT a Lua parser. It understands assignments and
 * method chains and ignores everything else, reporting what it skipped so a
 * stale reader shows up as warnings instead of a silently thinner library.
 */

export type LuaArg = string | number | boolean | null;

export interface LuaCall {
  readonly method: string;
  readonly args: readonly LuaArg[];
  /**
   * Per argument: did it resolve to a literal, or is `args[i]` the raw
   * source text kept verbatim?
   *
   * `parseArg` returns unresolved text as a string so callers can follow
   * references such as `kraylor:setEnemy(human)`. A reader that wants a
   * *value* cannot tell those apart from a real string — and
   * `setLocaleName(string.format(...))` would be stored as the literal
   * characters `string.format(...)`. This flag is how a reader refuses
   * that instead of recording it.
   */
  readonly literal: readonly boolean[];
}

export interface LuaStatement {
  /** Variable being assigned, when the statement is an assignment. */
  readonly assignsTo: string | null;
  /** Constructor at the head of the chain (`ShipTemplate`, `ModelData`, …). */
  readonly constructs: string | null;
  /** Variable the chain starts from, for `foo:setX()` or `foo:copy("y")`. */
  readonly subject: string | null;
  readonly calls: readonly LuaCall[];
  readonly raw: string;
}

/** Remove comments while respecting quoted and long-bracket strings. */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";

    if (ch === "-" && next === "-") {
      // Long comment --[[ … ]] (with optional = padding) or line comment.
      const long = /^--\[(=*)\[/.exec(source.slice(i));
      if (long !== null) {
        const close = `]${long[1] ?? ""}]`;
        const end = source.indexOf(close, i + long[0].length);
        i = end === -1 ? n : end + close.length;
        continue;
      }
      const eol = source.indexOf("\n", i);
      i = eol === -1 ? n : eol;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < n) {
        const c = source[i] ?? "";
        out += c;
        i += 1;
        if (c === "\\") {
          out += source[i] ?? "";
          i += 1;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }

    const longString = /^\[(=*)\[/.exec(source.slice(i));
    if (longString !== null) {
      const close = `]${longString[1] ?? ""}]`;
      const end = source.indexOf(close, i + longString[0].length);
      const stop = end === -1 ? n : end + close.length;
      out += source.slice(i, stop);
      i = stop;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Unroll the numeric `for` loops EE's data scripts use to generate families
 * of templates.
 *
 * `transport.lua` builds all 25 `Transport<n>x<m>` hulls in a nested loop,
 * and `corvette.lua` builds five freighter families the same way — 40
 * templates between them, a quarter of the install's list. A static reader
 * that skips loops therefore shows an author a library visibly poorer than
 * EmptyEpsilon's own ship picker, which is what this closes.
 *
 * The scope is deliberately narrow and stated rather than discovered:
 *
 *  - `for NAME = A, B [, STEP] do … end`, all bounds integer literals.
 *  - Nested loops, expanded outward-in.
 *  - `if NAME <op> NUMBER then … end` inside a body, evaluated with the
 *    loop variable bound (EE guards its jump-drive variants that way).
 *  - The loop variable substituted where it is read, not where it is part
 *    of a field access or a call.
 *
 * Anything outside that grammar is left exactly as it was and reported.
 * This is still not a Lua interpreter and must not become one: the moment
 * it starts guessing at control flow, the library it produces stops being
 * evidence about the install.
 */
export interface UnrollResult {
  readonly source: string;
  readonly warnings: readonly string[];
}

/** Guards against a pathological file turning into an unbounded expansion. */
const MAX_UNROLL_ITERATIONS = 200;
const MAX_UNROLLED_LENGTH = 4_000_000;

export function unrollNumericLoops(source: string): UnrollResult {
  const warnings: string[] = [];
  // Comments first: a prose apostrophe ("don't") reads as an opening quote
  // to the substituter and swallows the rest of the body.
  let text = stripComments(source);

  for (let iteration = 0; iteration < MAX_UNROLL_ITERATIONS; iteration += 1) {
    const header =
      /(^|[^\w])for\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?do\b/.exec(
        text,
      );
    if (header === null) return { source: text, warnings };

    const start = header.index + (header[1]?.length ?? 0);
    const bodyStart = header.index + header[0].length;
    const bodyEnd = findBlockEnd(text, bodyStart);
    if (bodyEnd === null) {
      warnings.push(`unterminated for loop over "${header[2] ?? "?"}" — left unexpanded`);
      return { source: text, warnings };
    }

    const name = header[2] ?? "";
    const from = Number(header[3]);
    const to = Number(header[4]);
    const step = header[5] === undefined ? 1 : Number(header[5]);
    const body = text.slice(bodyStart, bodyEnd.bodyEnd);

    if (step === 0) {
      warnings.push(`for loop over "${name}" has a zero step — left unexpanded`);
      return { source: text, warnings };
    }

    const pieces: string[] = [];
    for (let value = from; step > 0 ? value <= to : value >= to; value += step) {
      const bound = substituteVariable(body, name, value);
      const { text: resolved, warning } = evaluateNumericIfs(bound);
      if (warning !== null) warnings.push(warning);
      pieces.push(resolved);
    }

    text = `${text.slice(0, start)}\n${pieces.join("\n")}\n${text.slice(bodyEnd.after)}`;
    if (text.length > MAX_UNROLLED_LENGTH) {
      warnings.push("loop expansion grew past the size limit — stopped");
      return { source: text, warnings };
    }
  }

  warnings.push("too many nested loops to expand — some templates may be missing");
  return { source: text, warnings };
}

/** Match `do`/`then`/`function` against `end`, starting one level deep. */
function findBlockEnd(
  text: string,
  from: number,
): { bodyEnd: number; after: number } | null {
  const token = /\b(do|then|function|end|repeat)\b/g;
  token.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = token.exec(text)) !== null) {
    const word = match[1];
    // `repeat … until` closes without an `end`, so a body containing one
    // cannot be depth-counted; refuse rather than mis-slice it.
    if (word === "repeat") return null;
    if (word === "end") {
      depth -= 1;
      if (depth === 0) return { bodyEnd: match.index, after: match.index + 3 };
    } else {
      depth += 1;
    }
  }
  return null;
}

/**
 * Replace a bound loop variable with its value, outside strings.
 *
 * Skips `foo.name` / `foo:name` (a field, not the variable) and `name(`
 * (a call — `type` is both a common loop variable in these files and a Lua
 * builtin, so this distinction is load-bearing).
 */
function substituteVariable(text: string, name: string, value: number): string {
  const pattern = new RegExp(`(^|[^\\w.:])${name}\\b(\\s*\\()?`, "g");
  let out = "";
  let inString: string | null = null;
  let segment = "";

  const flush = (): void => {
    out += segment.replace(pattern, (whole, prefix: string, call: string | undefined) =>
      call === undefined ? `${prefix}${value}` : whole,
    );
    segment = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (inString !== null) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 1;
      } else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      flush();
      inString = ch;
      out += ch;
      continue;
    }
    // Long-bracket strings hold EE's ship descriptions, which are English
    // prose full of apostrophes — read as quotes they would swallow the
    // rest of the loop body and leave its variables unsubstituted.
    const long = /^\[(=*)\[/.exec(text.slice(i));
    if (long !== null) {
      flush();
      const close = `]${long[1] ?? ""}]`;
      const end = text.indexOf(close, i + long[0].length);
      const stop = end === -1 ? text.length : end + close.length;
      out += text.slice(i, stop);
      i = stop - 1;
      continue;
    }
    segment += ch;
  }
  flush();
  return out;
}

const COMPARISONS: Record<string, (a: number, b: number) => boolean> = {
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "==": (a, b) => a === b,
  "~=": (a, b) => a !== b,
};

/**
 * Resolve `if <number> <op> <number> then … end` blocks inside an unrolled
 * body, keeping or dropping the body accordingly.
 *
 * Only fully numeric comparisons — which is what a bound loop variable
 * produces. An `if` this cannot decide is left in place, and its body
 * therefore still reaches the reader; the returned warning says so, because
 * a template that only exists on one branch would otherwise be reported as
 * present without qualification.
 */
function evaluateNumericIfs(text: string): { text: string; warning: string | null } {
  let out = text;
  let warning: string | null = null;

  for (let guard = 0; guard < 100; guard += 1) {
    const match = /(^|[^\w])if\s+(-?\d+)\s*(<=|>=|==|~=|<|>)\s*(-?\d+)\s*then\b/.exec(out);
    if (match === null) break;

    const start = match.index + (match[1]?.length ?? 0);
    const bodyStart = match.index + match[0].length;
    const block = findBlockEnd(out, bodyStart);
    if (block === null) break;

    const body = out.slice(bodyStart, block.bodyEnd);
    if (/\b(else|elseif)\b/.test(body)) {
      // An else branch means the block is a choice, not a gate. Leaving it
      // whole is the honest option; saying so is the other half.
      warning = "conditional with else/elseif inside a loop — both branches read";
      break;
    }

    const compare = COMPARISONS[match[3] ?? ""];
    const keep = compare !== undefined && compare(Number(match[2]), Number(match[4]));
    out = `${out.slice(0, start)}\n${keep ? body : ""}\n${out.slice(block.after)}`;
  }

  return { text: out, warning };
}

/**
 * Split a data script into statements.
 *
 * A character scanner rather than a line loop, because EE's data files are
 * full of multi-line `[[ … ]]` descriptions containing blank lines and
 * unbalanced parentheses — a line-based splitter shreds them, and the
 * damage shows up as *missing* templates and factions rather than as an
 * error (observed: 39 of ~190 templates, 2 of 9 factions).
 *
 * Statements end at a newline that sits at paren depth 0 outside any
 * string, unless the next non-blank character is `:` — which means the
 * chain continues on the following line.
 */
export function splitStatements(source: string): string[] {
  const text = stripComments(source);
  const statements: string[] = [];

  let buffer = "";
  let depth = 0;
  let quote: string | null = null;
  let longLevel: number | null = null;
  let i = 0;

  const flush = (): void => {
    const trimmed = buffer.trim().replace(/\s+/g, " ");
    if (trimmed !== "") statements.push(trimmed);
    buffer = "";
  };

  while (i < text.length) {
    const ch = text[i] ?? "";

    if (quote !== null) {
      buffer += ch;
      if (ch === "\\") {
        buffer += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (longLevel !== null) {
      const close = `]${"=".repeat(longLevel)}]`;
      if (text.startsWith(close, i)) {
        buffer += close;
        i += close.length;
        longLevel = null;
        continue;
      }
      buffer += ch;
      i += 1;
      continue;
    }

    const longOpen = /^\[(=*)\[/.exec(text.slice(i));
    if (longOpen !== null) {
      longLevel = (longOpen[1] ?? "").length;
      buffer += longOpen[0];
      i += longOpen[0].length;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      i += 1;
      continue;
    }

    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);

    if (ch === "\n") {
      if (depth === 0) {
        const rest = text.slice(i + 1);
        const nextChar = /^\s*(\S)/.exec(rest)?.[1];
        if (nextChar !== ":") flush();
        else buffer += " ";
      } else {
        buffer += " ";
      }
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return statements;
}

function parseArgListTagged(text: string): { value: LuaArg; literal: boolean }[] {
  const args: { value: LuaArg; literal: boolean }[] = [];
  let depth = 0;
  let current = "";
  let inString: string | null = null;

  const push = (): void => {
    const trimmed = current.trim();
    if (trimmed !== "") args.push(parseArgTagged(trimmed));
    current = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (inString !== null) {
      current += ch;
      if (ch === "\\") {
        current += text[i + 1] ?? "";
        i += 1;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      push();
      continue;
    }
    current += ch;
  }
  push();
  return args;
}

/**
 * Fold a concatenation of literals into the string it produces.
 *
 * After a loop is unrolled, `"Transport" .. type .. "x" .. cnt` has become
 * `"Transport" .. 1 .. "x" .. 2` — every operand a literal, so the result
 * is known exactly. Anything with a non-literal operand is left alone and
 * reported as computed rather than guessed at.
 */
function foldConcatenation(text: string): string | null {
  if (!text.includes("..")) return null;

  const parts: string[] = [];
  let current = "";
  let inString: string | null = null;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (inString !== null) {
      current += ch;
      if (ch === "\\") {
        current += text[i + 1] ?? "";
        i += 1;
      } else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "." && text[i + 1] === "." && text[i + 2] !== ".") {
      parts.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  if (parts.length < 2) return null;

  let out = "";
  for (const part of parts) {
    const trimmed = part.trim();
    const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
    if (quoted !== null) {
      out += (quoted[2] ?? "").replace(/\\(.)/g, "$1");
      continue;
    }
    // Lua renders an integer-valued number without a decimal point, which
    // is what makes "Transport" .. 1 come out as Transport1 and not
    // Transport1.0.
    if (/^-?\d+$/.test(trimmed)) {
      out += trimmed;
      continue;
    }
    return null;
  }
  return out;
}

/**
 * Evaluate an arithmetic expression made **only** of numeric literals.
 *
 * The loop unroller substitutes `cnt` textually, so a template family's
 * `setSpeed(60 - 5 * cnt, 6, 10)` arrives here as `60 - 5 * 1` — no
 * identifiers left, just arithmetic. Without this, the 50 loop-generated
 * freighters and transports lose their speed entirely and a copy made of
 * one comes out dead in the water.
 *
 * Strictly literals: an identifier, a call, an index — anything that is not
 * a number or an operator — and this returns null and the argument stays
 * unresolved and reported. That is the same bargain `foldConcatenation`
 * already strikes one line below, and it is deliberately NOT an evaluator:
 * nothing here resolves a name or reads state.
 */
export function foldArithmetic(text: string): number | null {
  if (!/^[\d\s+\-*/().]+$/.test(text)) return null;
  if (!/\d/.test(text)) return null;

  let at = 0;
  const skip = (): void => {
    while (/\s/.test(text[at] ?? "")) at += 1;
  };

  // expression := term (('+' | '-') term)*
  const expression = (): number | null => {
    let left = term();
    if (left === null) return null;
    for (;;) {
      skip();
      const op = text[at];
      if (op !== "+" && op !== "-") return left;
      at += 1;
      const right = term();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
  };

  // term := factor (('*' | '/') factor)*
  const term = (): number | null => {
    let left = factor();
    if (left === null) return null;
    for (;;) {
      skip();
      const op = text[at];
      if (op !== "*" && op !== "/") return left;
      at += 1;
      const right = factor();
      if (right === null) return null;
      left = op === "*" ? left * right : left / right;
    }
  };

  // factor := '-'? ( '(' expression ')' | number )
  const factor = (): number | null => {
    skip();
    if (text[at] === "-") {
      at += 1;
      const inner = factor();
      return inner === null ? null : -inner;
    }
    if (text[at] === "(") {
      at += 1;
      const inner = expression();
      if (inner === null) return null;
      skip();
      if (text[at] !== ")") return null;
      at += 1;
      return inner;
    }
    const digits = /^\d+(?:\.\d+)?/.exec(text.slice(at));
    if (digits === null) return null;
    at += digits[0].length;
    return Number(digits[0]);
  };

  const value = expression();
  skip();
  return at === text.length && value !== null && Number.isFinite(value) ? value : null;
}

/**
 * One argument, with whether it actually resolved.
 *
 * The unresolved case returns the source text verbatim — callers such as
 * the faction reader follow references that way (`kraylor:setEnemy(human)`)
 * — so the flag is the only thing separating a real string from a snippet
 * of Lua that happens to be a string in TypeScript.
 */
function parseArgTagged(text: string): { value: LuaArg; literal: boolean } {
  const resolved = (value: LuaArg): { value: LuaArg; literal: boolean } => ({
    value,
    literal: true,
  });

  // Translation wrapper: _("Atlantis") or _("ship", "Atlantis") — the last
  // string is the value, the first is a translation category.
  const translated = /^_\s*\(([\s\S]*)\)$/.exec(text);
  if (translated !== null) {
    const inner = parseArgListTagged(translated[1] ?? "");
    const last = inner[inner.length - 1];
    return last ?? { value: null, literal: false };
  }

  const folded = foldConcatenation(text);
  if (folded !== null) return resolved(folded);

  const quoted = /^(['"])([\s\S]*)\1$/.exec(text);
  if (quoted !== null) {
    return resolved((quoted[2] ?? "").replace(/\\(.)/g, "$1"));
  }

  const long = /^\[(=*)\[([\s\S]*)\]\1\]$/.exec(text);
  if (long !== null) return resolved(long[2] ?? "");

  if (text === "true") return resolved(true);
  if (text === "false") return resolved(false);
  if (text === "nil") return resolved(null);

  const numeric = Number(text);
  if (text !== "" && Number.isFinite(numeric)) return resolved(numeric);

  const arithmetic = foldArithmetic(text);
  if (arithmetic !== null) return resolved(arithmetic);

  // Anything else (a variable, an expression) is kept verbatim so callers
  // can resolve references such as `kraylor:setEnemy(human)`.
  return { value: text, literal: false };
}

/** Extract the `:method(args)` chain from a statement. */
function parseCalls(text: string): LuaCall[] {
  const calls: LuaCall[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== ":") {
      i += 1;
      continue;
    }
    const nameMatch = /^:([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(text.slice(i));
    if (nameMatch === null) {
      i += 1;
      continue;
    }
    const open = i + nameMatch[0].length;
    let depth = 1;
    let j = open;
    let inString: string | null = null;
    while (j < text.length && depth > 0) {
      const ch = text[j] ?? "";
      if (inString !== null) {
        if (ch === "\\") j += 1;
        else if (ch === inString) inString = null;
      } else if (ch === '"' || ch === "'") inString = ch;
      else if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      j += 1;
    }
    const parsed = parseArgListTagged(text.slice(open, j - 1));
    calls.push({
      method: nameMatch[1] ?? "",
      args: parsed.map((a) => a.value),
      literal: parsed.map((a) => a.literal),
    });
    i = j;
  }
  return calls;
}

/**
 * Read a data script the way the install scanner wants it: loops unrolled
 * first, so a template family generated in a `for` is enumerated rather
 * than skipped, with whatever the unroller could not resolve reported.
 *
 * `parseStatements` stays the plain splitter-and-parser — no expansion, no
 * interpretation — because that is what most callers and its own tests
 * want to reason about.
 */
export function parseDataScript(source: string): {
  statements: LuaStatement[];
  warnings: readonly string[];
} {
  const unrolled = unrollNumericLoops(source);
  return { statements: parseStatements(unrolled.source), warnings: unrolled.warnings };
}

export function parseStatements(source: string): LuaStatement[] {
  return splitStatements(source).map((raw) => {
    const assignment = /^(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/.exec(raw);
    const body = assignment === null ? raw : (assignment[2] ?? "");
    const constructs = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)/.exec(body);
    const subject = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(body);

    return {
      assignsTo: assignment?.[1] ?? null,
      constructs: constructs?.[1] ?? null,
      subject: subject?.[1] ?? null,
      calls: parseCalls(body),
      raw,
    };
  });
}

/** First argument of a call, when it is a string. */
export function firstString(call: LuaCall | undefined): string | null {
  const value = call?.args[0];
  return typeof value === "string" ? value : null;
}

/** First argument of a call, when it is a number. */
export function firstNumber(call: LuaCall | undefined): number | null {
  const value = call?.args[0];
  return typeof value === "number" ? value : null;
}
