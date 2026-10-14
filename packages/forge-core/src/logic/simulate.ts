import type {
  EEAction,
  EEObject,
  EEPointRef,
  EEPredicate,
  EEProject,
  EETargetRef,
  EEVariableValue,
  Vec2,
} from "@forge/contracts";
import { markerIndex, resolvePoint } from "../points.js";
import { isExtensionAction } from "../extensions.js";
import { startSectorOf, usesSectorRuntime } from "../sector-runtime.js";
import { scopeOf, usesPersistence } from "../persistence.js";

/**
 * TypeScript executor for a project's narrative model.
 *
 * Two jobs (ADR-0034 §5):
 *  1. **Authoring dry-run** — walk a chapter's beats and rules on a virtual
 *     clock, with mock events for the things only a live game produces, and
 *     see what fires when. No EmptyEpsilon required.
 *  2. **Test oracle** — the generated Lua must fire the same things in the
 *     same order; the parity test compares the two.
 *
 * Semantics mirror the emitted scheduler exactly: beats fire in ascending
 * `at` order and never re-fire; rules are edge-triggered on the conjunction
 * of `when` and `conditions`, and `once` rules stop after their first fire.
 */

export type SimEvent =
  | { readonly at: number; readonly kind: "destroy_object"; readonly objectId: string }
  | { readonly at: number; readonly kind: "destroy_group"; readonly groupId: string }
  | {
      readonly at: number;
      readonly kind: "player_position";
      readonly x: number;
      readonly y: number;
    }
  | { readonly at: number; readonly kind: "player_hull"; readonly fraction: number }
  | {
      readonly at: number;
      readonly kind: "system_health";
      readonly system: string;
      readonly value: number;
    }
  | {
      readonly at: number;
      readonly kind: "scan";
      readonly objectId: string;
      readonly full: boolean;
    }
  /** The crew presses Save checkpoint (campaign saves on). */
  | { readonly at: number; readonly kind: "checkpoint" }
  /** EmptyEpsilon is closed and started again: the world is rebuilt from the latest checkpoint and the campaign clock continues from it. */
  | { readonly at: number; readonly kind: "restart" };

/** Outcomes the EXODUS service can report for a request that has one. */
export type SimOutcome = "solved" | "bypassed" | "failed" | "timeout" | "aborted";

/**
 * Mock events only a live game produces, for the EXODUS-family actions.
 * `exodus_outcome` is the service answering a puzzle request; `gm_press` is
 * the GM pressing the button a step's alternative added.
 */
export type SimExodusEvent =
  | {
      readonly at: number;
      readonly kind: "exodus_outcome";
      readonly stepId: string;
      readonly outcome: SimOutcome;
    }
  | { readonly at: number; readonly kind: "gm_press"; readonly stepId: string };

/**
 * What stands behind the EXODUS actions during the run (ADR-0049).
 *
 * - `vanilla` — the export has no extension; every EXODUS action runs its
 *   recorded alternative.
 * - `integrated` — the extension is in the scenario; whether it can act
 *   depends on the service. `lostAt` is the moment the scenario *notices* the
 *   loss (the generated gate waits for a missed heartbeat), `restoredAt` the
 *   moment it sees the service back. Neither replays what already ran.
 *
 * With no `exodus` option a project that uses the extension is simulated as
 * integrated with a service that never fails — the old behaviour.
 */
export type SimExodus =
  | { readonly mode: "vanilla" }
  | {
      readonly mode: "integrated";
      readonly service:
        | { readonly kind: "absent" }
        /** A beacon was left behind (or never beats): present, but no beat ever changes. */
        | { readonly kind: "stale" }
        | { readonly kind: "incompatible" }
        | {
            readonly kind: "active";
            /** When the scenario first sees a changed beat; requests made before wait. Default 0. */
            readonly connectedAt?: number;
            readonly lostAt?: number;
            readonly restoredAt?: number;
          };
      /** The protocol's startup wait (seconds) for absent/stale services. Default 10, as in the gate. */
      readonly startupS?: number;
    };

export interface SimOptions {
  /** Virtual seconds to run. */
  readonly untilSeconds: number;
  /** Tick size. 1 s matches EE closely enough for authoring. */
  readonly stepSeconds?: number;
  readonly events?: readonly (SimEvent | SimExodusEvent)[];
  readonly exodus?: SimExodus;
}

export interface SimFiring {
  readonly at: number;
  readonly source: "beat" | "rule";
  readonly id: string;
  readonly label: string;
  /** Human-readable action descriptions, in execution order. */
  readonly actions: readonly string[];
}

export interface SimResult {
  readonly firings: readonly SimFiring[];
  readonly variables: Readonly<Record<string, EEVariableValue>>;
  readonly spawnedGroups: readonly string[];
  /**
   * Object variables at the end of the run, keyed by object id — including
   * for objects that were destroyed, which is the point of keeping them
   * beside the project's record rather than on the handle.
   */
  readonly objectVariables: Readonly<Record<string, Readonly<Record<string, EEVariableValue>>>>;
  readonly destroyedObjects: readonly string[];
  /** Ids of the objects that exist and are alive at the end of the run (an unloaded object is neither alive nor destroyed). */
  readonly aliveObjects: readonly string[];
  /** Set when a `victory` action ran; the scenario ends there. */
  readonly endedWith: string | null;
  /** Campaign checkpoints written during the run (0 when the project has campaign saves off; ADR-0058). */
  readonly checkpoints: number;
  /** The sector the game ended the run in (null when the project does not use sectors in play). */
  readonly sector: string | null;
  /** Every Change sector that went ahead, in order (ADR-0056). A request for the sector already current, or an invalid one, is not listed. */
  readonly sectorChanges: readonly { readonly at: number; readonly from: string | null; readonly to: string }[];
  /** What the sector runtime refused, in plain words (a spawn into an inactive sector, an unknown destination). */
  readonly sectorRefusals: readonly string[];
  /** Where the player ship is at the end of the run. */
  readonly playerPosition: { readonly x: number; readonly y: number };
  /**
   * Final phase of every EXODUS step that was touched: `settled` (paid out,
   * once), `fallback` (alternative started, waiting on the crew or GM),
   * `skipped` (nothing replaced it), or `exodus` (sent, awaiting an answer).
   */
  readonly steps: Readonly<Record<string, string>>;
  /**
   * For settled steps, who made them so: `service` (reported solved/bypassed),
   * `handoff` (request handed over; the service confirmed nothing) or `alternative`.
   */
  readonly settledBy: Readonly<Record<string, string>>;
  /** What the EXODUS gate did, in order — the part of the run that is not a rule firing. */
  readonly exodusLog: readonly { readonly at: number; readonly text: string }[];
  /** Steps that got an EXODUS answer after their alternative had taken over; ignored, never paid. */
  readonly lateAnswers: readonly string[];
  /**
   * Behaviour the simulator cannot model faithfully (absolute hull values
   * without knowing a template's hull max, AI orders, sounds). Surfaced so
   * an author knows what the dry-run is *not* telling them.
   */
  readonly notSimulated: readonly string[];
}

interface SimObject {
  readonly def: EEObject;
  alive: boolean;
  spawned: boolean;
  scan: "none" | "simple" | "full";
  /**
   * Variables declared on the object. Kept beside `alive` rather than
   * cleared with it: the emitted Lua keeps them in a table that outlives
   * the handle, so the dry run has to as well or the two executors would
   * disagree about a destroyed ship.
   */
  readonly vars: Map<string, EEVariableValue>;
}

interface SectorSnap {
  alive: string[];
  clock: number;
  beat: number;
  rules: [string, { wasTrue: boolean; fired: boolean }][];
}

interface SimWorld {
  time: number;
  vars: Map<string, EEVariableValue>;
  objects: Map<string, SimObject>;
  groupOf: Map<string, string>;
  spawnedGroups: Set<string>;
  player: { x: number; y: number; hullFraction: number; systems: Map<string, number> };
  ended: string | null;
  /** Sectors in play (ADR-0056): the sector the game is in, whether the project opted in, how many jumps this update has seen. */
  sector: string | null;
  sectorsInPlay: boolean;
  transitions: number;
  /** Campaign saves (ADR-0058). */
  persistence: boolean;
  dead: Set<string>;
  appeared: Set<string>;
  snaps: Map<string, SectorSnap>;
  sclock: Map<string, number>;
  sbeat: Map<string, number>;
  clockBase: number;
  saved: string | null;
  checkpoints: number;
  /** Next global beat, and the edge state of every rule (by id): world state, because a checkpoint keeps them. */
  gbeat: number;
  rules: Map<string, { wasTrue: boolean; fired: boolean }>;
  sectorChanges: { at: number; from: string | null; to: string }[];
  sectorRefusals: string[];
  notSimulated: Set<string>;
  /**
   * Marker id → position (ADR-0038). The simulator resolves places exactly
   * as the emitter does; the two executors of this model must not disagree
   * about where a trigger is.
   */
  markers: ReadonlyMap<string, Vec2>;
  /** Object id → the dialogue it currently answers with, or null. */
  dialogueOf: Map<string, string | null>;
  exodus: ExodusSim;
}

/**
 * A place, as the trace shows it: a marker by name, a literal by numbers.
 *
 * The name is what the author wrote, so a trace line matches the record
 * they are reading in the editor.
 */
function describePlace(ref: EEPointRef): string {
  return ref.ref === "marker" ? `@${ref.markerId}` : `${ref.position.x}, ${ref.position.y}`;
}

function pointInPolygon(
  point: { x: number; y: number },
  polygon: readonly { x: number; y: number }[],
): boolean {
  // Ray casting. EE does this natively via Zone:isInside; replicating it
  // here keeps the dry-run faithful without a mock "player entered" event.
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

type StepPhase = "idle" | "exodus" | "fallback" | "settled" | "skipped";

/**
 * The simulator's twin of the generated step runtime and extension gate.
 * Same rules: a step's phase only moves forward, `success` runs once on
 * settlement, an alternative starts once, and an answer from EXODUS counts
 * only while EXODUS still owns the step.
 */
class ExodusSim {
  readonly phase = new Map<string, StepPhase>();
  readonly pressed = new Set<string>();
  readonly timers: { at: number; stepId: string }[] = [];
  /** Step ids whose request EXODUS holds (sent, answer pending) → deadline (scenario s) or null. */
  readonly pending = new Map<string, number | null>();
  readonly settledBy = new Map<string, string>();
  /** Requests made before the first verdict, in order. */
  private queue: Extract<EEAction, { kind: `exodus_${string}` }>[] = [];
  private flushed = false;
  readonly log: { at: number; text: string }[] = [];
  readonly late: string[] = [];

  constructor(
    private readonly world: () => SimWorld,
    private readonly project: EEProject,
    private readonly config: SimExodus,
    private readonly apply: (actions: readonly EEAction[]) => void,
  ) {}

  private note(text: string): void {
    this.log.push({ at: this.world().time, text });
  }

  private phaseOf(id: string): StepPhase {
    return this.phase.get(id) ?? "idle";
  }

  /** Can the extension take a request right now? */
  up(t: number): boolean {
    if (this.config.mode === "vanilla") return false;
    const service = this.config.service;
    if (service.kind !== "active") return false;
    const lost = service.lostAt !== undefined && t >= service.lostAt;
    const back = service.restoredAt !== undefined && t >= service.restoredAt;
    return !lost || back;
  }

  private verdictAt(): number {
    if (this.config.mode !== "integrated") return 0;
    const service = this.config.service;
    if (service.kind === "active") return service.connectedAt ?? 0;
    if (service.kind === "incompatible") return 0;
    return this.config.startupS ?? 10;
  }

  settle(id: string, via: string = "alternative"): void {
    if (this.phaseOf(id) === "settled") return;
    this.settledBy.set(id, via);
    this.phase.set(id, "settled");
    const step = this.project.logic.exodusSteps.find((candidate) => candidate.id === id);
    this.note(`step ${id} settled (${via})`);
    if (step !== undefined) this.apply(step.onSuccess);
  }

  fallback(id: string): void {
    if (this.phaseOf(id) !== "idle" && this.phaseOf(id) !== "exodus") return;
    this.pending.delete(id);
    const step = this.project.logic.exodusSteps.find((candidate) => candidate.id === id);
    const alternative = step?.alternative ?? null;
    if (alternative === null || alternative.kind === "none") {
      this.phase.set(id, "skipped");
      this.note(`step ${id} skipped — nothing replaces it`);
      return;
    }
    this.phase.set(id, "fallback");
    if (alternative.kind === "immediate") {
      this.note(`step ${id} alternative: immediate`);
      this.apply(alternative.actions);
      this.settle(id, "alternative");
    } else if (alternative.kind === "wait") {
      this.note(`step ${id} alternative: wait ${alternative.seconds}s`);
      this.timers.push({ at: this.world().time + alternative.seconds, stepId: id });
    } else {
      this.note(`step ${id} alternative: GM button "${alternative.label}"`);
    }
  }

  /** An EXODUS action ran. */
  action(action: Extract<EEAction, { kind: `exodus_${string}` }>): void {
    const id = action.stepId;
    const t = this.world().time;
    if (this.config.mode === "vanilla") {
      if (id !== null) this.fallback(id);
      return;
    }
    if (!this.flushed && t < this.verdictAt()) {
      this.note(`${action.kind}: queued until the service answers`);
      this.queue.push(action);
      return;
    }
    this.dispatch(action);
  }

  private dispatch(action: Extract<EEAction, { kind: `exodus_${string}` }>): void {
    const id = action.stepId;
    const t = this.world().time;
    if (this.up(t)) {
      this.note(`sent ${action.kind}`);
      if (id === null) return;
      if (action.kind === "exodus_puzzle") {
        const within = this.project.logic.exodusSteps.find((step) => step.id === id)?.answerWithinS ?? null;
        this.phase.set(id, "exodus");
        this.pending.set(id, within === null ? null : t + within);
      } else {
        this.note(`handed over ${action.kind} (no confirmation exists)`);
        this.settle(id, "handoff");
      }
      return;
    }
    this.note(`${action.kind}: EXODUS unavailable`);
    if (id !== null) this.fallback(id);
  }

  /** Called once per tick before anything else. */
  tick(t: number): void {
    if (this.config.mode === "integrated" && !this.flushed && t >= this.verdictAt()) {
      this.flushed = true;
      const queued = this.queue;
      this.queue = [];
      for (const action of queued) this.dispatch(action);
    }
    if (this.config.mode === "integrated" && this.flushed && !this.up(t)) {
      for (const id of [...this.pending.keys()]) {
        this.note(`EXODUS lost while step ${id} was waiting`);
        this.fallback(id);
      }
    }
    // A live service that did not answer in time: this step passes to its alternative.
    for (const [id, deadline] of [...this.pending]) {
      if (deadline !== null && t >= deadline) {
        this.note(`no answer from EXODUS for step ${id} within its deadline`);
        this.fallback(id);
      }
    }
    for (const timer of [...this.timers]) {
      if (t < timer.at) continue;
      this.timers.splice(this.timers.indexOf(timer), 1);
      if (this.phaseOf(timer.stepId) === "fallback") {
        const step = this.project.logic.exodusSteps.find((c) => c.id === timer.stepId);
        if (step?.alternative !== null && step?.alternative !== undefined && step.alternative.kind === "wait") {
          this.apply(step.alternative.actions);
        }
        this.settle(timer.stepId, "alternative");
      }
    }
  }

  outcome(id: string, outcome: SimOutcome): void {
    if (this.pending.has(id)) {
      this.pending.delete(id);
      if (outcome === "solved" || outcome === "bypassed") {
        this.settle(id, "service");
      } else {
        this.phase.set(id, "skipped");
        this.note(`step ${id} closed: EXODUS reported ${outcome}`);
      }
      return;
    }
    this.late.push(id);
    this.note(`late EXODUS answer for step ${id} ignored (${this.phaseOf(id)})`);
  }

  press(id: string): void {
    if (this.phaseOf(id) !== "fallback" || this.pressed.has(id)) return;
    const step = this.project.logic.exodusSteps.find((candidate) => candidate.id === id);
    if (step?.alternative === null || step?.alternative === undefined || step.alternative.kind !== "gm") return;
    this.pressed.add(id);
    this.note(`GM pressed "${step.alternative.label}"`);
    this.apply(step.alternative.actions);
    this.settle(id, "alternative");
  }
}

function createWorld(project: EEProject, exodus: SimExodus): SimWorld {
  const objects = new Map<string, SimObject>();
  const groupOf = new Map<string, string>();
  for (const group of project.map.groups) {
    for (const object of group.objects) {
      objects.set(object.id, {
        def: object,
        alive: false,
        spawned: false,
        scan: "none",
        vars: new Map(object.variables.map((v) => [v.name, v.initial])),
      });
      groupOf.set(object.id, group.id);
    }
  }

  const vars = new Map<string, EEVariableValue>();
  for (const variable of project.logic.variables) vars.set(variable.name, variable.initial);

  const playerStart = [...objects.values()].find((o) => o.def.type === "PlayerSpaceship");

  const world: SimWorld = {
    time: 0,
    vars,
    objects,
    groupOf,
    spawnedGroups: new Set(),
    player: {
      x: playerStart?.def.position.x ?? 0,
      y: playerStart?.def.position.y ?? 0,
      hullFraction: 1,
      systems: new Map(),
    },
    ended: null,
    sector: startSectorOf(project),
    sectorsInPlay: usesSectorRuntime(project),
    transitions: 0,
    persistence: usesPersistence(project),
    dead: new Set(),
    appeared: new Set(),
    snaps: new Map(),
    sclock: new Map(),
    sbeat: new Map(),
    clockBase: 0,
    saved: null,
    checkpoints: 0,
    gbeat: 0,
    rules: new Map(project.logic.rules.map((r) => [r.id, { wasTrue: false, fired: false }])),
    sectorChanges: [],
    sectorRefusals: [],
    notSimulated: new Set(),
    markers: markerIndex(project.map.markers),
    dialogueOf: new Map(
      [...objects.values()]
        .filter((o) => "dialogueId" in o.def)
        .map((o) => [o.def.id, (o.def as { dialogueId: string | null }).dialogueId]),
    ),
    // Filled below: the twin needs the world it lives in.
    exodus: undefined as unknown as ExodusSim,
  };
  world.exodus = new ExodusSim(
    () => world,
    project,
    exodus,
    (actions) => {
      for (const action of actions) applyAction(world, project, action);
    },
  );
  return world;
}

function spawnGroup(world: SimWorld, project: EEProject, groupId: string, opts: { force?: boolean; skipDead?: boolean } = {}): void {
  const group = project.map.groups.find((g) => g.id === groupId);
  if (group === undefined) return;
  // A group of an inactive sector is never created: the same guard the generated map has.
  if (world.sectorsInPlay && group.sector !== null && group.sector !== world.sector && opts.force !== true) {
    world.sectorRefusals.push(`spawn_group ${groupId} refused: it belongs to sector ${group.sector} and the game is in ${String(world.sector)}`);
    return;
  }
  world.spawnedGroups.add(groupId);
  if (world.persistence) world.appeared.add(groupId);
  for (const object of group.objects) {
    const sim = world.objects.get(object.id);
    if (sim === undefined) continue;
    // Campaign saves (ADR-0058): an object recorded as destroyed is never rebuilt.
    if (opts.skipDead === true && world.dead.has(object.id)) continue;
    // The same player ship goes on through every jump: a group that holds it never makes a second one.
    if (world.sectorsInPlay && object.type === "PlayerSpaceship" && sim.spawned) continue;
    sim.spawned = true;
    sim.alive = true;
    // A fresh object: its own variables are re-read from the declaration only the first time (the record is the project's, ADR-0034).
  }
}

/** Remove one group's objects because the game left its sector: not destroyed, simply gone (the twin of `M.unload_group`). */
function unloadGroup(world: SimWorld, project: EEProject, groupId: string): void {
  const group = project.map.groups.find((g) => g.id === groupId);
  if (group === undefined) return;
  for (const object of group.objects) {
    if (object.type === "PlayerSpaceship") continue;
    const sim = world.objects.get(object.id);
    if (sim === undefined) continue;
    sim.alive = false;
    sim.spawned = false; // "never spawned" again: neither "destroyed" nor "wiped out"
  }
  world.spawnedGroups.delete(groupId);
}

/** Which of a sector's (or the Shared) objects are destroyed — recorded, so they are never rebuilt. */
function recordDead(world: SimWorld, project: EEProject, sector: string | null): void {
  for (const group of project.map.groups) {
    if (group.sector !== sector) continue;
    for (const object of group.objects) {
      const sim = world.objects.get(object.id);
      if (sim !== undefined && sim.spawned && !sim.alive) world.dead.add(object.id);
    }
  }
}

/** The state of one sector as it is now (the twin of `P.capture_sector`). */
function captureSector(world: SimWorld, project: EEProject, sector: string): SectorSnap {
  recordDead(world, project, sector);
  const alive: string[] = [];
  for (const group of project.map.groups) {
    if (group.sector !== sector) continue;
    for (const object of group.objects) if (world.objects.get(object.id)?.alive === true) alive.push(object.id);
  }
  const rules: SectorSnap["rules"] = [];
  for (const rule of project.logic.rules) {
    if (scopeOf(rule) === sector) {
      const st = world.rules.get(rule.id);
      if (st !== undefined) rules.push([rule.id, { ...st }]);
    }
  }
  return { alive, clock: world.sclock.get(sector) ?? 0, beat: world.sbeat.get(sector) ?? 1, rules };
}

/** Write a checkpoint: everything a resume needs, as text (a deep copy that nothing afterwards can change). */
function checkpoint(world: SimWorld, project: EEProject): void {
  if (!world.persistence || world.sector === null) return;
  recordDead(world, project, null);
  world.snaps.set(world.sector, captureSector(world, project, world.sector));
  world.checkpoints += 1;
  world.saved = JSON.stringify({
    sector: world.sector,
    clock: world.clockBase + world.time,
    vars: [...world.vars],
    objects: [...world.objects].map(([id, o]) => [id, o.alive, o.spawned, [...o.vars]]),
    spawnedGroups: [...world.spawnedGroups],
    dead: [...world.dead],
    appeared: [...world.appeared],
    snaps: [...world.snaps],
    sclock: [...world.sclock],
    sbeat: [...world.sbeat],
    gbeat: world.gbeat,
    rules: [...world.rules],
    player: world.player.x + "," + world.player.y,
    dialogueOf: [...world.dialogueOf],
  });
}

/** EmptyEpsilon closed and started again: the world is what the latest checkpoint says; the campaign clock goes on from it. */
function restart(world: SimWorld): void {
  if (world.saved === null) return;
  const d = JSON.parse(world.saved) as {
    sector: string; clock: number; vars: [string, EEVariableValue][];
    objects: [string, boolean, boolean, [string, EEVariableValue][]][]; spawnedGroups: string[]; dead: string[]; appeared: string[];
    snaps: [string, SectorSnap][]; sclock: [string, number][]; sbeat: [string, number][]; gbeat: number;
    rules: [string, { wasTrue: boolean; fired: boolean }][]; player: string; dialogueOf: [string, string | null][];
  };
  world.sector = d.sector;
  world.clockBase = d.clock - world.time;
  world.vars = new Map(d.vars);
  for (const [id, alive, spawned, vars] of d.objects) {
    const o = world.objects.get(id);
    if (o === undefined) continue;
    o.alive = alive; o.spawned = spawned; o.scan = "none";
    o.vars.clear();
    for (const [k, v] of vars) o.vars.set(k, v);
  }
  world.spawnedGroups = new Set(d.spawnedGroups);
  world.dead = new Set(d.dead);
  world.appeared = new Set(d.appeared);
  world.snaps = new Map(d.snaps);
  world.sclock = new Map(d.sclock);
  world.sbeat = new Map(d.sbeat);
  world.gbeat = d.gbeat;
  world.rules = new Map(d.rules);
  const [px, py] = d.player.split(",").map(Number);
  world.player.x = px ?? 0;
  world.player.y = py ?? 0;
  world.dialogueOf = new Map(d.dialogueOf);
}

/** Build the destination: from its snapshot when visited, from the initial settings when not (the twin of `P.build_sector`). */
function buildSector(world: SimWorld, project: EEProject, dest: string): void {
  const snap = world.snaps.get(dest);
  for (const group of project.map.groups) {
    if (group.sector !== dest) continue;
    if (snap === undefined) {
      if (group.when === "on_start") spawnGroup(world, project, group.id, { force: true, skipDead: true });
    } else if (world.appeared.has(group.id)) {
      spawnGroup(world, project, group.id, { force: true, skipDead: true });
    }
  }
}

/** The time and rule state of the sector just entered (the twin of `P.enter_state`). */
function enterState(world: SimWorld, project: EEProject, dest: string): void {
  const snap = world.snaps.get(dest);
  world.sclock.set(dest, snap?.clock ?? 0);
  world.sbeat.set(dest, snap?.beat ?? 1);
  const saved = new Map(snap?.rules ?? []);
  for (const rule of project.logic.rules) {
    if (scopeOf(rule) !== dest) continue;
    const st = saved.get(rule.id);
    world.rules.set(rule.id, st === undefined ? { wasTrue: false, fired: false } : { ...st });
  }
}

/** The twin of `rt.change_sector`. Returns whether a change happened. */
function changeSector(world: SimWorld, project: EEProject, action: Extract<EEAction, { kind: "change_sector" }>): boolean {
  if (!project.map.sectors.some((s) => s.id === action.sectorId)) {
    world.sectorRefusals.push(`change_sector refused: no sector called ${action.sectorId}`);
    return false;
  }
  if (world.sector === action.sectorId) return false;
  const marker = project.map.markers.find((m) => m.id === action.arrivalMarkerId);
  const from = world.sector;
  if (world.persistence && from !== null) {
    // Campaign saves: the old sector's last state, a checkpoint with it, the destination built, and only then the old sector unloaded.
    world.snaps.set(from, captureSector(world, project, from));
    recordDead(world, project, null);
    checkpoint(world, project);
    buildSector(world, project, action.sectorId);
    for (const group of project.map.groups) if (group.sector === from) unloadGroup(world, project, group.id);
    world.sector = action.sectorId;
    enterState(world, project, action.sectorId);
  } else {
    if (from !== null) {
      for (const group of project.map.groups) if (group.sector === from) unloadGroup(world, project, group.id);
    }
    world.sector = action.sectorId;
    for (const group of project.map.groups) {
      if (group.sector === action.sectorId && group.when === "on_start") spawnGroup(world, project, group.id);
    }
  }
  if (marker !== undefined) {
    world.player.x = marker.position.x;
    world.player.y = marker.position.y;
  }
  world.transitions += 1;
  world.sectorChanges.push({ at: world.time, from, to: action.sectorId });
  if (world.persistence) checkpoint(world, project);
  return true;
}

function resolveTargets(world: SimWorld, ref: EETargetRef): SimObject[] {
  switch (ref.ref) {
    case "player":
      return [...world.objects.values()].filter(
        (o) => o.def.type === "PlayerSpaceship" && o.alive,
      );
    case "object": {
      const object = world.objects.get(ref.objectId);
      return object !== undefined && object.alive ? [object] : [];
    }
    case "group":
      return [...world.objects.values()].filter(
        (o) => world.groupOf.get(o.def.id) === ref.groupId && o.alive,
      );
  }
}

function evaluatePredicate(world: SimWorld, predicate: EEPredicate, scope: string | null = null): boolean {
  switch (predicate.kind) {
    case "always":
      return true;
    case "elapsed":
      if (world.persistence) {
        // Campaign saves (ADR-0058): a global rule counts the campaign clock, a scoped one its sector's own clock.
        return (scope === null ? world.clockBase + world.time : (world.sclock.get(scope) ?? 0)) >= predicate.seconds;
      }
      return world.time >= predicate.seconds;
    case "object_destroyed": {
      const object = world.objects.get(predicate.objectId);
      if (world.persistence && world.dead.has(predicate.objectId)) return true;
      return object !== undefined && object.spawned && !object.alive;
    }
    case "group_destroyed": {
      if (world.persistence) {
        // Appeared at least once, and every member destroyed (recorded, or gone without having been unloaded).
        if (!world.appeared.has(predicate.groupId)) return false;
        const ids = [...world.objects.values()].filter((o) => world.groupOf.get(o.def.id) === predicate.groupId);
        return ids.length > 0 && ids.every((m) => world.dead.has(m.def.id) || (m.spawned && !m.alive));
      }
      if (!world.spawnedGroups.has(predicate.groupId)) return false;
      const members = [...world.objects.values()].filter(
        (o) => world.groupOf.get(o.def.id) === predicate.groupId,
      );
      return members.length > 0 && members.every((m) => !m.alive);
    }
    case "player_in_zone": {
      const zone = world.objects.get(predicate.zoneId);
      if (zone === undefined || !zone.alive || zone.def.type !== "Zone") return false;
      return pointInPolygon(world.player, zone.def.points);
    }
    case "player_near_object": {
      const object = world.objects.get(predicate.objectId);
      if (object === undefined || !object.alive) return false;
      const dx = world.player.x - object.def.position.x;
      const dy = world.player.y - object.def.position.y;
      return dx * dx + dy * dy <= predicate.distance * predicate.distance;
    }
    case "player_near_point": {
      // A dangling marker never fires, rather than firing at (0, 0) —
      // the build refuses the same document, and a dry run that quietly
      // triggered somewhere else would be worse than one that did not.
      const point = resolvePoint(world.markers, predicate.position);
      if (point === null) return false;
      const dx = world.player.x - point.x;
      const dy = world.player.y - point.y;
      return dx * dx + dy * dy <= predicate.distance * predicate.distance;
    }
    case "player_hull_below":
      return world.player.hullFraction < predicate.fraction;
    case "player_system_below":
      return (world.player.systems.get(predicate.system) ?? 1) < predicate.fraction;
    case "object_scanned": {
      const object = world.objects.get(predicate.objectId);
      if (object === undefined || !object.alive) return false;
      return predicate.full ? object.scan === "full" : object.scan !== "none";
    }
    case "variable_equals":
      return world.vars.get(predicate.name) === predicate.value;
    case "variable_at_least": {
      const value = world.vars.get(predicate.name);
      return typeof value === "number" && value >= predicate.value;
    }
    case "object_variable_equals": {
      // No aliveness check: the variable belongs to the project's record of
      // the object, not to the handle, so it reads the same after the ship
      // is gone — exactly as the emitted Lua does.
      const object = world.objects.get(predicate.objectId);
      return object?.vars.get(predicate.name) === predicate.value;
    }
    case "object_variable_at_least": {
      const value = world.objects.get(predicate.objectId)?.vars.get(predicate.name);
      return typeof value === "number" && value >= predicate.value;
    }
    case "current_sector":
      return world.sector === predicate.sectorId;
  }
}

function describeTarget(ref: EETargetRef): string {
  switch (ref.ref) {
    case "player":
      return "player";
    case "object":
      return `object ${ref.objectId}`;
    case "group":
      return `group ${ref.groupId}`;
  }
}

/** One-line human summary, used by the CLI dry-run and later by the editor. */
export function describeAction(action: EEAction): string {
  switch (action.kind) {
    case "global_message":
      return `message "${action.text}"`;
    case "banner":
      return `banner "${action.text}"`;
    case "ship_log":
      return `ship log (${action.color}) "${action.text}"`;
    case "gm_message":
      return `GM message "${action.text}"`;
    case "play_sound":
      return `play ${action.file}`;
    case "spawn_group":
      return `spawn group ${action.groupId}`;
    case "destroy":
      return `destroy ${describeTarget(action.target)}`;
    case "set_variable":
      return `${action.name} = ${String(action.value)}`;
    case "add_variable":
      return `${action.name} += ${action.delta}`;
    case "set_ai":
      return `${describeTarget(action.target)} AI → ${action.ai}`;
    case "set_dialogue":
      return `${describeTarget(action.target)} dialogue → ${action.dialogueId ?? "(EE default)"}`;
    case "hail_player":
      return `${action.objectId} hails the player`;
    case "order_idle":
    case "order_roaming":
    case "order_stand_ground":
      return `${describeTarget(action.target)} order → ${action.kind.slice(6)}`;
    case "order_roaming_at":
    case "order_defend_location":
    case "order_fly_towards":
    case "order_fly_towards_blind":
      return `${describeTarget(action.target)} order → ${action.kind.slice(6)} ${describePlace(action.position)}`;
    case "order_attack":
    case "order_dock":
    case "order_retreat":
    case "order_defend_target":
      return `${describeTarget(action.target)} order → ${action.kind.slice(6)} ${action.objectId}`;
    case "order_fly_formation":
      return `${describeTarget(action.target)} order → formation on ${action.leaderId} at ${action.offset.x}, ${action.offset.y}`;
    case "set_object_variable":
      return `${describeTarget(action.target)}.${action.name} = ${String(action.value)}`;
    case "add_object_variable":
      return `${describeTarget(action.target)}.${action.name} += ${action.delta}`;
    case "set_hull":
      return `${describeTarget(action.target)} hull = ${action.value}`;
    case "damage_hull":
      return `${describeTarget(action.target)} hull −${action.amount}`;
    case "set_system_health":
      return `${describeTarget(action.target)} ${action.system} health = ${action.value}`;
    case "set_system_heat":
      return `${describeTarget(action.target)} ${action.system} heat = ${action.value}`;
    case "set_alert_level":
      return `alert level → ${action.level}`;
    case "victory":
      return `victory: ${action.faction}`;
    case "pause_game":
      return "pause game";
    case "save_checkpoint":
      return "save a campaign checkpoint";
    case "change_sector":
      return `change sector → ${action.sectorId} at @${action.arrivalMarkerId}${action.rotation === null ? "" : ` facing ${action.rotation}°`}`;
    case "exodus_event":
      return `exodus event ${action.eventType}`;
    case "exodus_puzzle":
      return `exodus puzzle ${action.puzzleId} (${action.role})`;
    case "exodus_action":
      return `exodus critical action ${action.actionId}`;
    case "exodus_lore":
      return `exodus lore ${action.fragmentId}${
        action.foundBy === null ? "" : ` (found by ${action.foundBy})`
      }`;
    case "exodus_encrypted_comms":
      return `encrypted comms ${action.channel} from ${action.from}`;
    case "exodus_set_state":
      return `exodus state ${action.key} = ${action.value}`;
    case "exodus_complete_chapter":
      return `exodus complete chapter → ${action.nextChapterId ?? "(campaign end)"}`;
  }
}

function applyAction(world: SimWorld, project: EEProject, action: EEAction): void {
  if (isExtensionAction(action)) {
    world.exodus.action(action);
    return;
  }
  switch (action.kind) {
    case "spawn_group":
      spawnGroup(world, project, action.groupId);
      break;
    case "change_sector":
      changeSector(world, project, action);
      break;
    case "save_checkpoint":
      checkpoint(world, project);
      break;
    case "destroy":
      for (const object of resolveTargets(world, action.target)) object.alive = false;
      break;
    case "set_variable":
      world.vars.set(action.name, action.value);
      break;
    case "add_variable": {
      const current = world.vars.get(action.name);
      world.vars.set(action.name, (typeof current === "number" ? current : 0) + action.delta);
      break;
    }
    case "set_system_health":
      if (action.target.ref === "player") {
        world.player.systems.set(action.system, action.value);
      }
      break;
    case "victory":
      world.ended = action.faction;
      break;
    case "set_hull":
    case "damage_hull":
      // Hull is tracked as a fraction here; absolute values need a
      // template's hull max, which only EE knows.
      world.notSimulated.add(`${action.kind} (needs the template's hull max)`);
      break;
    case "set_ai":
    case "order_idle":
    case "order_roaming":
    case "order_stand_ground":
    case "order_roaming_at":
    case "order_defend_location":
    case "order_fly_towards":
    case "order_fly_towards_blind":
    case "order_attack":
    case "order_dock":
    case "order_retreat":
    case "order_defend_target":
    case "order_fly_formation":
      world.notSimulated.add("AI orders (no combat model)");
      break;
    case "set_object_variable":
      for (const object of resolveTargets(world, action.target)) {
        object.vars.set(action.name, action.value);
      }
      break;
    case "add_object_variable":
      for (const object of resolveTargets(world, action.target)) {
        const current = object.vars.get(action.name);
        object.vars.set(action.name, (typeof current === "number" ? current : 0) + action.delta);
      }
      break;
    case "set_dialogue":
      // Applied: which dialogue an object carries is plain state, and a
      // later `set_dialogue` overwriting an earlier one is worth seeing.
      for (const object of resolveTargets(world, action.target)) {
        world.dialogueOf.set(object.def.id, action.dialogueId);
      }
      break;
    case "hail_player":
      // A hail is a conversation, and a dry run has nobody to answer it.
      world.notSimulated.add("comms dialogues (the simulation cannot choose replies)");
      break;
    case "play_sound":
      world.notSimulated.add("sound playback");
      break;
    default:
      break;
  }
}

export function simulate(project: EEProject, options: SimOptions): SimResult {
  const step = options.stepSeconds ?? 1;
  const usesExtension = project.requires.includes("exodus");
  const world = createWorld(
    project,
    options.exodus ?? (usesExtension ? { mode: "integrated", service: { kind: "active" } } : { mode: "vanilla" }),
  );
  const firings: SimFiring[] = [];

  const beats = [...project.logic.beats].sort(
    (a, b) => a.at - b.at || a.id.localeCompare(b.id),
  );
  // Campaign saves (ADR-0058): global beats (campaign clock) and the beats scoped to each sector (that sector's own clock). Without saves, as before.
  const gbeats = world.persistence ? beats.filter((b) => scopeOf(b) === null) : beats;
  const sbeats = new Map<string, typeof beats>();
  if (world.persistence) {
    for (const beat of beats) {
      const sector = scopeOf(beat);
      if (sector !== null) sbeats.set(sector, [...(sbeats.get(sector) ?? []), beat]);
    }
  }

  const events = [...(options.events ?? [])].sort((a, b) => a.at - b.at);
  let eventIndex = 0;

  // The map's on_start groups spawn in init(), before the first tick.
  for (const group of project.map.groups) {
    if (group.when !== "on_start") continue;
    // With a start sector only that sector's groups and the Shared ones exist at the start (as in the generated map).
    if (world.sectorsInPlay && world.sector !== null && group.sector !== null && group.sector !== world.sector) continue;
    spawnGroup(world, project, group.id);
  }
  if (world.persistence && world.sector !== null) {
    world.sclock.set(world.sector, 0);
    world.sbeat.set(world.sector, 1);
    checkpoint(world, project); // a new campaign writes checkpoint 1
  }

  for (let t = 0; t <= options.untilSeconds; t += step) {
    world.time = t;
    world.exodus.tick(t);
    // The active sector's own clock runs; the others are frozen.
    if (world.persistence && world.sector !== null) world.sclock.set(world.sector, (world.sclock.get(world.sector) ?? 0) + step);

    while (eventIndex < events.length && (events[eventIndex]?.at ?? 0) <= t) {
      const event = events[eventIndex];
      eventIndex += 1;
      if (event === undefined) continue;
      switch (event.kind) {
        case "exodus_outcome":
          world.exodus.outcome(event.stepId, event.outcome);
          break;
        case "gm_press":
          world.exodus.press(event.stepId);
          break;
        case "destroy_object": {
          const object = world.objects.get(event.objectId);
          if (object !== undefined) object.alive = false;
          break;
        }
        case "destroy_group":
          for (const object of world.objects.values()) {
            if (world.groupOf.get(object.def.id) === event.groupId) object.alive = false;
          }
          break;
        case "player_position":
          world.player.x = event.x;
          world.player.y = event.y;
          break;
        case "player_hull":
          world.player.hullFraction = event.fraction;
          break;
        case "system_health":
          world.player.systems.set(event.system, event.value);
          break;
        case "scan": {
          const object = world.objects.get(event.objectId);
          if (object !== undefined) object.scan = event.full ? "full" : "simple";
          break;
        }
        case "checkpoint":
          checkpoint(world, project);
          break;
        case "restart":
          // The new process starts its own scenario clock at 0: this tick is its first, at the campaign clock the checkpoint holds.
          restart(world);
          if (world.persistence && world.sector !== null) world.sclock.set(world.sector, (world.sclock.get(world.sector) ?? 0) + step);
          break;
      }
    }

    const fireBeat = (beat: (typeof beats)[number]): void => {
      for (const action of beat.actions) applyAction(world, project, action);
      firings.push({ at: t, source: "beat", id: beat.id, label: beat.label, actions: beat.actions.map(describeAction) });
    };
    const campaignNow = world.persistence ? world.clockBase + t : t;
    while (world.gbeat < gbeats.length && campaignNow >= (gbeats[world.gbeat]?.at ?? 0)) {
      const beat = gbeats[world.gbeat];
      world.gbeat += 1;
      if (beat !== undefined) fireBeat(beat);
    }
    if (world.persistence && world.sector !== null) {
      const sector = world.sector;
      const list = sbeats.get(sector) ?? [];
      let idx = world.sbeat.get(sector) ?? 1;
      while (idx <= list.length && (world.sclock.get(sector) ?? 0) >= (list[idx - 1]?.at ?? 0)) {
        const beat = list[idx - 1];
        idx += 1;
        world.sbeat.set(sector, idx);
        if (beat !== undefined) fireBeat(beat);
        if (world.sector !== sector) break; // a jump inside the beat: the list belongs to the sector that was left
        idx = world.sbeat.get(sector) ?? idx;
      }
    }

    const transitionsAtStart = world.transitions;
    project.logic.rules.forEach((rule) => {
      const state = world.rules.get(rule.id);
      if (state === undefined) return;
      const scope = scopeOf(rule);
      // A scoped rule is evaluated only while its sector is the active one.
      if (world.persistence && scope !== null && scope !== world.sector) return;
      // A jump in this update: the rules after it belong to the old sector and wait for the next update, in the new world.
      if (world.transitions !== transitionsAtStart) return;
      if (rule.once && state.fired) return;
      const value = [rule.when, ...rule.conditions].every((p) =>
        evaluatePredicate(world, p, scope),
      );
      if (value && !state.wasTrue) {
        for (const action of rule.actions) applyAction(world, project, action);
        firings.push({
          at: t,
          source: "rule",
          id: rule.id,
          label: rule.label,
          actions: rule.actions.map(describeAction),
        });
        state.fired = true;
      }
      state.wasTrue = value;
    });

    if (world.ended !== null) break;
  }

  return {
    firings,
    variables: Object.fromEntries(world.vars),
    objectVariables: Object.fromEntries(
      [...world.objects.entries()]
        .filter(([, object]) => object.vars.size > 0)
        .map(([id, object]) => [id, Object.fromEntries(object.vars)]),
    ),
    spawnedGroups: [...world.spawnedGroups],
    aliveObjects: [...world.objects.values()].filter((o) => o.alive).map((o) => o.def.id).sort(),
    destroyedObjects: [...world.objects.values()]
      .filter((o) => o.spawned && !o.alive)
      .map((o) => o.def.id),
    endedWith: world.ended,
    checkpoints: world.checkpoints,
    sector: world.sectorsInPlay ? world.sector : null,
    sectorChanges: world.sectorChanges,
    sectorRefusals: world.sectorRefusals,
    playerPosition: { x: world.player.x, y: world.player.y },
    steps: Object.fromEntries(world.exodus.phase),
    settledBy: Object.fromEntries(world.exodus.settledBy),
    exodusLog: world.exodus.log,
    lateAnswers: world.exodus.late,
    notSimulated: [
      ...world.notSimulated,
      // Stated whenever the project has any, not only when one is
      // attached mid-run: an author reading a clean dry run should not
      // conclude the conversations were exercised.
      ...(project.logic.dialogues.length > 0
        ? ["comms dialogues (the simulation cannot choose replies)"]
        : []),
    ],
  };
}
