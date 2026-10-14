import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  ForgeInstallationSchema,
  type ForgeInstallation,
  type ForgeRegisterInstallation,
} from "@forge/contracts";
import { EE_TARGETS, detectInstallTarget, installEvidence } from "@forge/core";
import { z } from "zod";
import type { ForgeContext } from "./context.js";
import { notFound, unprocessable } from "./errors.js";

const RegistrySchema = z.object({
  version: z.literal(1),
  installations: z.array(ForgeInstallationSchema),
});

const supported = (): string => EE_TARGETS.map((t) => t.id).join(", ");

/** Stable across restarts and distinct per path: two copies of one engine stay two installs. */
export function installationId(target: string, path: string): string {
  return `${target}-${createHash("sha1").update(resolve(path)).digest("hex").slice(0, 8)}`;
}

/**
 * The installs Forge knows about, each with an identity grounded in evidence.
 *
 * A path is not a version. `verified` is true only when the install's own
 * `script_reference.html` matched a build in the target registry; an install
 * the author had to label by hand is kept, reported unverified, and never
 * promoted by being registered.
 */
export class InstallationService {
  constructor(private readonly ctx: ForgeContext) {}

  private load(): ForgeInstallation[] {
    if (!existsSync(this.ctx.registryPath)) return [];
    try {
      return RegistrySchema.parse(JSON.parse(readFileSync(this.ctx.registryPath, "utf8"))).installations;
    } catch (error) {
      this.ctx.logger.warn({ err: error, path: this.ctx.registryPath }, "forge: unreadable installation registry, starting empty");
      return [];
    }
  }

  private save(installations: readonly ForgeInstallation[]): void {
    mkdirSync(dirname(this.ctx.registryPath), { recursive: true });
    const tmp = `${this.ctx.registryPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, installations }, null, 2)}\n`, "utf8");
    renameSync(tmp, this.ctx.registryPath);
  }

  list(): ForgeInstallation[] {
    return this.load().sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): ForgeInstallation | null {
    return this.load().find((candidate) => candidate.id === id) ?? null;
  }

  require(id: string): ForgeInstallation {
    const found = this.get(id);
    if (found === null) throw notFound(`no registered installation "${id}"`, "install");
    return found;
  }

  /**
   * Identify an install and remember it. Idempotent per path. Throws when the
   * directory is missing, when the declared version contradicts the evidence,
   * or when the install is unrecognised and no version was declared.
   */
  register(request: ForgeRegisterInstallation): ForgeInstallation {
    const path = resolve(request.path);
    if (!existsSync(path)) throw notFound(`no EE install at ${request.path}`, "eeDir");

    const declared = request.eeVersion ?? null;
    if (declared !== null && !EE_TARGETS.some((t) => t.id === declared)) {
      throw unprocessable(`"${declared}" is not a verified target (supported: ${supported()})`, "eeVersion");
    }
    const detected = detectInstallTarget(path);
    if (detected !== null && declared !== null && detected !== declared) {
      throw unprocessable(`${request.path} is ${detected}, not ${declared}`, "eeVersion");
    }
    const target = detected ?? declared;
    if (target === null) {
      throw unprocessable(
        `${request.path} is not a recognised EmptyEpsilon build; pass eeVersion (one of ${supported()}) to register it as unverified`,
        "eeDir",
      );
    }

    const id = installationId(target, path);
    const all = this.load();
    const previous = all.find((candidate) => candidate.id === id);
    const entry: ForgeInstallation = {
      id,
      path,
      label: request.label ?? previous?.label ?? basename(dirname(path)) + "/" + basename(path),
      target,
      verified: detected !== null,
      evidence: installEvidence(path),
      addedAt: previous?.addedAt ?? new Date().toISOString(),
      scannedAt: previous?.scannedAt ?? null,
    };
    this.save([...all.filter((candidate) => candidate.id !== id), entry]);
    this.ctx.logger.info({ id, target, verified: entry.verified }, "forge: installation registered");
    return entry;
  }

  markScanned(id: string): ForgeInstallation {
    const all = this.load();
    const current = all.find((candidate) => candidate.id === id);
    if (current === undefined) throw notFound(`no registered installation "${id}"`, "install");
    const next = { ...current, scannedAt: new Date().toISOString() };
    this.save(all.map((candidate) => (candidate.id === id ? next : candidate)));
    return next;
  }

  /** Forget an install. Its files are never touched; its library and cache stay on disk. */
  remove(id: string): void {
    const all = this.load();
    if (!all.some((candidate) => candidate.id === id)) throw notFound(`no registered installation "${id}"`, "install");
    this.save(all.filter((candidate) => candidate.id !== id));
  }

  /**
   * The install a project of this target should use: the most recently
   * scanned verified one, then any verified, then any declared.
   */
  activeFor(target: string): ForgeInstallation | null {
    const candidates = this.load().filter((candidate) => candidate.target === target);
    const rank = (c: ForgeInstallation): string => `${c.verified ? "1" : "0"}${c.scannedAt ?? ""}`;
    return candidates.sort((a, b) => rank(b).localeCompare(rank(a)))[0] ?? null;
  }

  /**
   * Re-check an install against its recorded identity. A verified install
   * whose reference no longer matches (the engine was upgraded in place) is an
   * error: its library and cache describe a different build.
   */
  assertStillIdentical(entry: ForgeInstallation): void {
    if (!existsSync(entry.path)) throw notFound(`installation ${entry.id} is gone: ${entry.path}`, "install");
    if (!entry.verified) return;
    const now = detectInstallTarget(entry.path);
    if (now !== entry.target) {
      throw unprocessable(
        `${entry.path} was registered as ${entry.target} but now identifies as ${now ?? "an unrecognised build"} — register it again`,
        "install",
      );
    }
  }
}
