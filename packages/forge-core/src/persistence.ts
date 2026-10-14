import type { EEProject } from "@forge/contracts";
import { foundKind, startSectorOf } from "./sector-runtime.js";
import { usesExodusSteps } from "./extensions.js";

/**
 * Campaign saves (ADR-0058) — the questions both the emitter and the editor's problem list ask of a project.
 *
 * Like `sector-runtime.ts`, this sits above `codegen/` and `editor/` so that the build and Problems read one list and cannot drift.
 */

/** True when the project asks for campaign saves. Otherwise the generated Lua is exactly what it always was. */
export function usesPersistence(project: EEProject): boolean {
  return (project as { campaign?: { persistence?: boolean } }).campaign?.persistence === true;
}

/** The sector a beat or rule is scoped to, or null (global). Tolerant of a hand-built record with no such field. */
export function scopeOf(item: { readonly sector?: string | null }): string | null {
  return typeof item.sector === "string" ? item.sector : null;
}

/** True when any beat or rule is scoped to a sector. */
export function usesScopes(project: EEProject): boolean {
  return project.logic.beats.some((b) => scopeOf(b) !== null) || project.logic.rules.some((r) => scopeOf(r) !== null);
}

/** 32-bit FNV-1a over a string, as 8 hex digits. Not a security measure: it tells a save which project structure it was made from. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The structural fingerprint of a project: the identifiers a save refers to — sectors, groups (their sector and timing), objects (their type),
 * rules and beats (their scope), variables, dialogues — and nothing else. Tuning (a hull value, a position, a text) does not change it, so a
 * save survives an edit that only retunes; adding, removing, renaming or re-filing an identifier does, and the save is then refused.
 */
export function structuralFingerprint(project: EEProject): string {
  const lines: string[] = [`project ${project.id}`, `target ${project.eeVersion}`];
  for (const s of [...project.map.sectors].sort((a, b) => a.id.localeCompare(b.id))) lines.push(`sector ${s.id}`);
  lines.push(`start ${startSectorOf(project) ?? "-"}`);
  for (const g of project.map.groups) {
    lines.push(`group ${g.id} ${g.sector ?? "-"} ${g.when}`);
    for (const o of g.objects) lines.push(`object ${o.id} ${o.type}`);
  }
  for (const b of project.logic.beats) lines.push(`beat ${b.id} ${scopeOf(b) ?? "-"}`);
  for (const r of project.logic.rules) lines.push(`rule ${r.id} ${scopeOf(r) ?? "-"} ${r.once ? "once" : "repeat"}`);
  for (const v of project.logic.variables) lines.push(`var ${v.name}`);
  for (const d of project.logic.dialogues) lines.push(`dialogue ${d.id}`);
  return fnv1a(lines.join("\n"));
}

export interface PersistenceIssue {
  readonly severity: "error" | "warning";
  readonly code: "persistence-needs-start-sector" | "checkpoint-needs-persistence" | "scope-needs-persistence" | "scope-unknown-sector" | "steps-not-saved";
  readonly subject: string;
  readonly title: string;
  readonly message: string;
  readonly action: string;
  /** A rule or beat the problem list can open (id and label), when there is one. */
  readonly where: { readonly kind: "rule" | "beat"; readonly id: string; readonly label: string } | null;
  readonly key: string;
}

const q = (s: string): string => `“${s}”`;

export function persistenceIssues(project: EEProject): readonly PersistenceIssue[] {
  const issues: PersistenceIssue[] = [];
  const on = usesPersistence(project);
  const sectors = new Set(project.map.sectors.map((s) => s.id));
  if (on && startSectorOf(project) === null) {
    issues.push({
      severity: "error",
      code: "persistence-needs-start-sector",
      subject: "Campaign saves",
      title: "Campaign saves need a starting sector",
      message: "Campaign saves are on, but the project has no starting sector: a save has to say which sector the game was in.",
      action: "Choose the starting sector (the flag on a sector's header), or turn campaign saves off.",
      where: null,
      key: "start",
    });
  }
  if (!on && foundKind(project, "save_checkpoint").length > 0) {
    issues.push({
      severity: "error",
      code: "checkpoint-needs-persistence",
      subject: "Save checkpoint",
      title: "A Save checkpoint action needs campaign saves",
      message: "An action writes a campaign checkpoint, but campaign saves are off for this project.",
      action: "Turn campaign saves on (Mission → Campaign), or remove the action.",
      where: null,
      key: "checkpoint",
    });
  }
  const scoped: { kind: "rule" | "beat"; id: string; label: string; sector: string }[] = [
    ...project.logic.rules.flatMap((r) => (scopeOf(r) === null ? [] : [{ kind: "rule" as const, id: r.id, label: r.label, sector: scopeOf(r) ?? "" }])),
    ...project.logic.beats.flatMap((b) => (scopeOf(b) === null ? [] : [{ kind: "beat" as const, id: b.id, label: b.label, sector: scopeOf(b) ?? "" }])),
  ];
  for (const item of scoped) {
    if (!on) {
      issues.push({
        severity: "error",
        code: "scope-needs-persistence",
        subject: `${item.kind === "rule" ? "Rule" : "Beat"} ${q(item.label)}`,
        title: `A ${item.kind} scoped to a sector needs campaign saves`,
        message: `The ${item.kind} ${q(item.label)} belongs to the sector ${q(item.sector)}, which means it runs on that sector's own clock — a clock that only exists when campaign saves are on.`,
        action: `Turn campaign saves on, or make the ${item.kind} global.`,
        where: { kind: item.kind, id: item.id, label: item.label },
        key: `${item.kind}:${item.id}`,
      });
    }
    if (!sectors.has(item.sector)) {
      issues.push({
        severity: "error",
        code: "scope-unknown-sector",
        subject: `${item.kind === "rule" ? "Rule" : "Beat"} ${q(item.label)}`,
        title: `A ${item.kind} belongs to a sector that does not exist`,
        message: `The ${item.kind} ${q(item.label)} is scoped to ${q(item.sector)}, which is not in this project.`,
        action: `Choose an existing sector for the ${item.kind}, or make it global.`,
        where: { kind: item.kind, id: item.id, label: item.label },
        key: `${item.kind}:${item.id}:unknown`,
      });
    }
  }
  if (on && usesExodusSteps(project)) {
    issues.push({
      severity: "warning",
      code: "steps-not-saved",
      subject: "Campaign saves",
      title: "EXODUS steps and their timers are not saved",
      message: "This project uses EXODUS steps. A checkpoint does not keep their state or their delays: after a resume a step that was waiting starts again.",
      action: "Keep steps out of a campaign you intend to resume, or accept that they restart.",
      where: null,
      key: "steps",
    });
  }
  return issues;
}
