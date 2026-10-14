/** Every record (an object with a string `kind`) inside `value`, at any depth, in document order. */
export function collectRecords(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRecords(item, out));
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["kind"] === "string") out.push(record);
    Object.values(record).forEach((item) => collectRecords(item, out));
  }
  return out;
}
