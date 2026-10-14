import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EEDmxRigSchema,
  type EEDmxRig,
  type EEDmxTelemetry,
  type EEDmxTriggerReading,
  type ForgeDmxBuildResult,
  type ForgeDmxImportResult,
} from "@forge/contracts";
import { readHardwareIni, triggerValues, writeHardwareIni } from "@forge/core";
import type { ForgeContext } from "./context.js";
import { badRequest, notFound } from "./errors.js";
import type { InstallationService } from "./installations.js";

/**
 * Optional live ship telemetry for the DMX preview, one adapter per engine.
 * The editor and simulator work without any: with none registered the
 * preview simply reports `live: false`.
 */
export interface DmxTelemetrySource {
  /** Engine this adapter can read, e.g. `EE-2026.09.22PR`. */
  readonly target: string;
  /** Null when the game is not reachable. */
  read(): Promise<EEDmxTelemetry | null>;
}

/** Where EmptyEpsilon reads `hardware.ini`: beside the executable. */
const hardwareIni = (eeDir: string): string => join(eeDir, "hardware.ini");

/**
 * The DMX rig (ADR-0040): the room's lights, beside the projects rather than
 * inside one. Editing, importing, building and previewing need no game and no
 * EXODUS; only live telemetry does, and only through a registered source.
 */
export class DmxService {
  constructor(
    private readonly ctx: ForgeContext,
    private readonly installations: InstallationService,
    private readonly sources: readonly DmxTelemetrySource[] = [],
  ) {}

  rig(): EEDmxRig | null {
    if (!existsSync(this.ctx.dmxRigPath)) return null;
    try {
      return EEDmxRigSchema.parse(JSON.parse(readFileSync(this.ctx.dmxRigPath, "utf8")));
    } catch (error) {
      this.ctx.logger.warn({ err: error, path: this.ctx.dmxRigPath }, "forge: ignoring unreadable DMX rig");
      return null;
    }
  }

  save(body: unknown): { saved: true; savedAt: string } {
    const parsed = EEDmxRigSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw badRequest(issue?.message ?? "invalid DMX rig", issue === undefined ? null : issue.path.join("."));
    }
    mkdirSync(this.ctx.stateDir, { recursive: true });
    writeFileSync(this.ctx.dmxRigPath, `${JSON.stringify(parsed.data, null, 2)}\n`, "utf8");
    this.ctx.logger.info("forge: DMX rig saved");
    return { saved: true, savedAt: new Date().toISOString() };
  }

  private installDir(eeDir: string | undefined, installId: string | undefined): string {
    if (installId !== undefined && installId !== "") return this.installations.require(installId).path;
    if (eeDir === undefined || eeDir === "") throw badRequest("no EE install directory given", "eeDir");
    return eeDir;
  }

  /** Read the install's own `hardware.ini`. Warnings travel with the rig: a silent drop would lose work. */
  importFrom(request: { eeDir?: string; install?: string }): ForgeDmxImportResult {
    const path = hardwareIni(this.installDir(request.eeDir, request.install));
    if (!existsSync(path)) throw notFound(`no hardware.ini at ${path}`, "eeDir");
    const { rig, warnings } = readHardwareIni(readFileSync(path, "utf8"));
    this.ctx.logger.info({ path, warnings: warnings.length }, "forge: imported hardware.ini");
    return { rig, warnings: [...warnings], path };
  }

  /** Render the rig; install only when asked, with a backup — `hardware.ini` may be hand-edited. */
  build(request: { install?: string }): ForgeDmxBuildResult {
    const rig = this.rig();
    if (rig === null) throw notFound("no DMX rig saved yet");

    const outDir = join(this.ctx.stateDir, "dmx-rig", "build");
    mkdirSync(outDir, { recursive: true });
    const contents = writeHardwareIni(rig);
    const outPath = join(outDir, "hardware.ini");
    writeFileSync(outPath, contents, "utf8");

    let installedTo: string | null = null;
    let backedUpTo: string | null = null;
    if (request.install !== undefined && request.install !== "") {
      const target = hardwareIni(this.installations.get(request.install)?.path ?? request.install);
      if (existsSync(target)) {
        backedUpTo = `${target}.bak`;
        writeFileSync(backedUpTo, readFileSync(target, "utf8"), "utf8");
      }
      writeFileSync(target, contents, "utf8");
      installedTo = target;
    }
    this.ctx.logger.info({ outPath, installedTo }, "forge: DMX rig built");
    return { outPath, bytes: Buffer.byteLength(contents), installedTo, backedUpTo };
  }

  /** What the rig's triggers read on the live ship; `live: false` when no source answers. */
  async triggers(target: string | null): Promise<EEDmxTriggerReading> {
    const source = target === null ? this.sources[0] : this.sources.find((candidate) => candidate.target === target);
    if (source === undefined) return triggerValues(null);
    try {
      return triggerValues(await source.read());
    } catch (error) {
      this.ctx.logger.debug({ err: error }, "forge: DMX telemetry unavailable");
      return triggerValues(null);
    }
  }
}
