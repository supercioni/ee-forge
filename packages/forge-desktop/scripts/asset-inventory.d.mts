export interface InventoryEntry {
  path: string;
  bytes: number;
  sha256: string;
  distribute: boolean;
  license: string | null;
  author: string | null;
  title: string | null;
  source: string | null;
  evidence: string | null;
  reason: string | null;
}
export function buildInventory(assetsDir: string, used?: ReadonlySet<string> | null): InventoryEntry[];
export function modelsUsedByForge(manifest: Record<string, { model?: string } | undefined>): Set<string>;
export function filterManifest<T extends Record<string, unknown>>(manifest: T, entries: readonly InventoryEntry[]): { manifest: Partial<T>; dropped: string[] };
