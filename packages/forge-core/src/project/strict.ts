import { z, type ZodTypeAny } from "zod";

/**
 * A deep "strict" twin of a schema: unknown object keys become
 * `unrecognized_keys` issues instead of being stripped silently.
 *
 * Zod has no deep strict mode, and a plain diff of "input vs parsed" cannot
 * tell a dropped field from a deliberate normalisation (the schemas rewrite a
 * bare `{x, y}` into a tagged point on read). Running the schema's own
 * preprocessors and then asking only "which keys were left over" separates
 * the two. Handles exactly the Zod node kinds the Forge contracts use and
 * throws on any other, so a new kind fails loudly instead of hiding fields.
 */
export function deepStrict<T extends ZodTypeAny>(schema: T): ZodTypeAny {
  const s: ZodTypeAny = schema;
  if (s instanceof z.ZodObject) {
    const shape = s.shape as Record<string, ZodTypeAny>;
    return z.object(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, deepStrict(v)]))).strict();
  }
  if (s instanceof z.ZodArray) return z.array(deepStrict(s.element));
  if (s instanceof z.ZodTuple) {
    return z.tuple((s.items as ZodTypeAny[]).map(deepStrict) as [ZodTypeAny, ...ZodTypeAny[]]);
  }
  if (s instanceof z.ZodRecord) return z.record(s.keySchema, deepStrict(s.valueSchema));
  if (s instanceof z.ZodOptional) return deepStrict(s.unwrap()).optional();
  if (s instanceof z.ZodNullable) return deepStrict(s.unwrap()).nullable();
  if (s instanceof z.ZodDefault) return deepStrict(s.removeDefault()).default(s._def.defaultValue());
  if (s instanceof z.ZodEffects) {
    return new z.ZodEffects({ ...s._def, schema: deepStrict(s._def.schema) });
  }
  if (s instanceof z.ZodDiscriminatedUnion) {
    const options = (s.options as ZodTypeAny[]).map(deepStrict) as [
      z.ZodDiscriminatedUnionOption<string>,
      ...z.ZodDiscriminatedUnionOption<string>[],
    ];
    return z.discriminatedUnion(s.discriminator as string, options);
  }
  if (s instanceof z.ZodUnion) {
    return z.union((s.options as ZodTypeAny[]).map(deepStrict) as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }
  if (
    s instanceof z.ZodString ||
    s instanceof z.ZodNumber ||
    s instanceof z.ZodBoolean ||
    s instanceof z.ZodLiteral ||
    s instanceof z.ZodEnum ||
    s instanceof z.ZodUnknown ||
    s instanceof z.ZodAny
  ) {
    return s;
  }
  throw new Error(`deepStrict: unsupported schema node ${s._def.typeName as string}`);
}

/** Every `unrecognized_keys` path under an issue list, unions included. */
export function unrecognizedPaths(issues: readonly z.ZodIssue[]): (string | number)[][] {
  const out: (string | number)[][] = [];
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) out.push([...issue.path, key]);
    } else if (issue.code === "invalid_union") {
      for (const err of issue.unionErrors) out.push(...unrecognizedPaths(err.issues));
    }
  }
  return out;
}
