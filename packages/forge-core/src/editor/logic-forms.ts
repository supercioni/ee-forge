import {
  AlertLevelSchema,
  EELogColorSchema,
  EE_AI_STATES,
  ShipSystemNameSchema,
  type EEAction,
  type EEPointRef,
  type EEPredicate,
  type EETargetRef,
} from "@forge/contracts";

/** Option lists read off the schemas themselves, so they cannot drift. */
const SHIP_SYSTEMS = ShipSystemNameSchema.options;
const LOG_COLORS = EELogColorSchema.options;
const ALERT_LEVELS = AlertLevelSchema.options;

/**
 * Form descriptors for the narrative model — the logic half of what
 * `fields.ts` does for map objects.
 *
 * A predicate or an action is a tagged record with its own shape, so the
 * editor needs to know, per kind, which controls to draw and what an empty
 * one looks like. Putting that here rather than in the React panels buys
 * the thing that matters: a test can assert the descriptors cover **every**
 * variant of the schema's unions, so a kind added to the model can never
 * quietly become unauthorable. The panel is then a renderer with no
 * knowledge of the domain.
 *
 * The "one deliberate omission" worth stating: these describe the shape,
 * not the legality. `order` carries both a position and an object id and
 * only some orders use each — the emitter is the authority on that, and it
 * already refuses the invalid combinations.
 */

/** Controls the narrative forms need, beyond the object inspector's set. */
export type LogicWidget =
  | "text"
  | "textarea"
  | "number"
  | "seconds"
  | "boolean"
  | "select"
  | "target"
  | "objectRef"
  | "groupRef"
  /** One of the project's sectors (ADR-0056). */
  | "sectorRef"
  /** A marker filed under the sector chosen in the record's `sectorId` field. */
  | "arrivalMarker"
  | "zoneRef"
  /** One of the project's dialogues, or none. */
  | "dialogueRef"
  /** The without-EXODUS step an EXODUS action points at (ADR-0049). */
  | "exodusStep"
  | "point"
  | "variableValue"
  | "variableName"
  | "json";

export interface LogicFieldSpec {
  readonly key: string;
  readonly label: string;
  readonly widget: LogicWidget;
  readonly nullable?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly hint?: string;
}

export interface LogicKindSpec<Kind extends string> {
  readonly kind: Kind;
  readonly label: string;
  /** Grouping for the palette; also the vanilla/exodus split for actions. */
  readonly group: string;
  readonly fields: readonly LogicFieldSpec[];
  readonly hint?: string;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export type PredicateKind = EEPredicate["kind"];

const SECONDS: LogicFieldSpec = {
  key: "seconds",
  label: "At (s)",
  widget: "seconds",
  min: 0,
};

const FRACTION = (key: string, label: string, min = 0): LogicFieldSpec => ({
  key,
  label,
  widget: "number",
  min,
  max: 1,
  step: 0.05,
});

export const PREDICATE_SPECS: readonly LogicKindSpec<PredicateKind>[] = [
  { kind: "always", label: "Always", group: "Time", fields: [] },
  {
    kind: "elapsed",
    label: "Scenario time reaches",
    group: "Time",
    fields: [SECONDS],
  },
  {
    kind: "object_destroyed",
    label: "Object destroyed",
    group: "Combat",
    fields: [{ key: "objectId", label: "Object", widget: "objectRef" }],
  },
  {
    kind: "group_destroyed",
    label: "Group wiped out",
    group: "Combat",
    fields: [{ key: "groupId", label: "Group", widget: "groupRef" }],
    hint: "True once every member that spawned has been destroyed.",
  },
  {
    kind: "player_in_zone",
    label: "Player inside zone",
    group: "Position",
    fields: [{ key: "zoneId", label: "Zone", widget: "zoneRef" }],
    hint: "Uses EE's own Zone:isInside — no point-in-polygon of our own.",
  },
  {
    kind: "player_near_object",
    label: "Player near object",
    group: "Position",
    fields: [
      { key: "objectId", label: "Object", widget: "objectRef" },
      { key: "distance", label: "Within (GU)", widget: "number", min: 1, step: 500 },
    ],
  },
  {
    kind: "player_near_point",
    label: "Player near point",
    group: "Position",
    fields: [
      { key: "position", label: "Point", widget: "point" },
      { key: "distance", label: "Within (GU)", widget: "number", min: 1, step: 500 },
    ],
  },
  {
    kind: "player_hull_below",
    label: "Player hull below",
    group: "Damage",
    fields: [FRACTION("fraction", "Fraction")],
  },
  {
    kind: "player_system_below",
    label: "Player system below",
    group: "Damage",
    fields: [
      { key: "system", label: "System", widget: "select", options: SHIP_SYSTEMS },
      FRACTION("fraction", "Health", -1),
    ],
  },
  {
    kind: "object_scanned",
    label: "Object scanned",
    group: "Science",
    fields: [
      { key: "objectId", label: "Object", widget: "objectRef" },
      { key: "full", label: "Full scan required", widget: "boolean" },
    ],
  },
  {
    kind: "variable_equals",
    label: "Variable equals",
    group: "State",
    fields: [
      { key: "name", label: "Variable", widget: "text" },
      { key: "value", label: "Value", widget: "variableValue" },
    ],
  },
  {
    kind: "variable_at_least",
    label: "Variable at least",
    group: "State",
    fields: [
      { key: "name", label: "Variable", widget: "text" },
      { key: "value", label: "Value", widget: "number" },
    ],
  },
  {
    kind: "object_variable_equals",
    label: "Object variable equals",
    group: "State",
    fields: [
      { key: "objectId", label: "Object", widget: "objectRef" },
      { key: "name", label: "Variable", widget: "variableName" },
      { key: "value", label: "Value", widget: "variableValue" },
    ],
    hint: "Readable after the object is destroyed — the variable belongs to the project, not to the handle.",
  },
  {
    kind: "object_variable_at_least",
    label: "Object variable at least",
    group: "State",
    fields: [
      { key: "objectId", label: "Object", widget: "objectRef" },
      { key: "name", label: "Variable", widget: "variableName" },
      { key: "value", label: "Value", widget: "number" },
    ],
  },
  {
    kind: "current_sector",
    label: "Current sector is",
    group: "Sector",
    fields: [{ key: "sectorId", label: "Sector", widget: "sectorRef" }],
    hint: "True while the game is in that sector. Needs a starting sector. Use it to keep a rule to the sector where it makes sense.",
  },
];

/**
 * Placeholder for a reference the author has not chosen yet.
 *
 * It has to be *something*: an id is a constrained string in the schema,
 * so an empty one would make a half-built predicate fail to save — and
 * saving a work in progress is the normal state of authoring. This value
 * is schema-valid, reads as unset everywhere it is displayed, and is
 * refused by the emitter ("references unknown object"), so a forgotten one
 * stops the build rather than reaching EmptyEpsilon.
 */
export const UNSET_REF = "unset";

/** References the editor can pre-fill from the project it has open. */
export interface RefDefaults {
  readonly objectId?: string | undefined;
  readonly groupId?: string | undefined;
  readonly zoneId?: string | undefined;
  readonly dialogueId?: string | undefined;
  readonly sectorId?: string | undefined;
  readonly markerId?: string | undefined;
}

const ref = (value: string | undefined): string =>
  value === undefined || value === "" ? UNSET_REF : value;

/** True for a reference nobody has chosen yet. */
export function isUnsetRef(value: string): boolean {
  return value === "" || value === UNSET_REF;
}

/**
 * A schema-valid predicate of the requested kind.
 *
 * `defaults` is how the editor pre-fills references with something from
 * the open project — a new "object destroyed" arrives pointing at the
 * selected object rather than at nothing.
 */
export function emptyPredicate(kind: PredicateKind, defaults: RefDefaults = {}): EEPredicate {
  switch (kind) {
    case "always":
      return { kind: "always" };
    case "elapsed":
      return { kind: "elapsed", seconds: 60 };
    case "object_destroyed":
      return { kind: "object_destroyed", objectId: ref(defaults.objectId) };
    case "group_destroyed":
      return { kind: "group_destroyed", groupId: ref(defaults.groupId) };
    case "player_in_zone":
      return { kind: "player_in_zone", zoneId: ref(defaults.zoneId) };
    case "player_near_object":
      return { kind: "player_near_object", objectId: ref(defaults.objectId), distance: 5000 };
    case "player_near_point":
      return { kind: "player_near_point", position: blankPlace(), distance: 5000 };
    case "player_hull_below":
      return { kind: "player_hull_below", fraction: 0.5 };
    case "player_system_below":
      return { kind: "player_system_below", system: "reactor", fraction: 0.5 };
    case "object_scanned":
      return { kind: "object_scanned", objectId: ref(defaults.objectId), full: false };
    case "variable_equals":
      return { kind: "variable_equals", name: "flag", value: 1 };
    case "variable_at_least":
      return { kind: "variable_at_least", name: "flag", value: 1 };
    case "object_variable_equals":
      return {
        kind: "object_variable_equals",
        objectId: ref(defaults.objectId),
        name: "flag",
        value: 1,
      };
    case "object_variable_at_least":
      return {
        kind: "object_variable_at_least",
        objectId: ref(defaults.objectId),
        name: "flag",
        value: 1,
      };
    case "current_sector":
      return { kind: "current_sector", sectorId: ref(defaults.sectorId) };
  }
}

export function describeTargetRef(target: EETargetRef): string {
  switch (target.ref) {
    case "player":
      return "the player ship";
    case "object":
      return isUnsetRef(target.objectId) ? "(no object)" : target.objectId;
    case "group":
      return isUnsetRef(target.groupId) ? "(no group)" : `group ${target.groupId}`;
  }
}

/** How an unchosen reference reads in a summary line. */
const shownRef = (value: string, noun: string): string =>
  isUnsetRef(value) ? `(no ${noun})` : value;

/**
 * A place, as a summary line shows it.
 *
 * A marker reads by name, because that is what the author will recognise
 * and what they can move; a literal reads as its coordinates.
 */
export const shownPlace = (place: EEPointRef): string =>
  place.ref === "marker"
    ? shownRef(place.markerId, "marker")
    : `${place.position.x}, ${place.position.y}`;

/** A fresh place: coordinates, which is what an author with no markers means. */
export const blankPlace = (): EEPointRef => ({ ref: "point", position: { x: 0, y: 0 } });

/** One-line reading of a predicate, for the rules table. */
export function describePredicate(predicate: EEPredicate): string {
  switch (predicate.kind) {
    case "always":
      return "always";
    case "elapsed":
      return `T+${predicate.seconds}s`;
    case "object_destroyed":
      return `${shownRef(predicate.objectId, "object")} destroyed`;
    case "group_destroyed":
      return `group ${shownRef(predicate.groupId, "group")} wiped`;
    case "player_in_zone":
      return `player inside ${shownRef(predicate.zoneId, "zone")}`;
    case "player_near_object":
      return `player within ${predicate.distance} of ${shownRef(predicate.objectId, "object")}`;
    case "player_near_point":
      return `player within ${predicate.distance} of ${shownPlace(predicate.position)}`;
    case "player_hull_below":
      return `player hull < ${predicate.fraction}`;
    case "player_system_below":
      return `player ${predicate.system} < ${predicate.fraction}`;
    case "object_scanned":
      return `${shownRef(predicate.objectId, "object")} ${predicate.full ? "fully " : ""}scanned`;
    case "variable_equals":
      return `${predicate.name || "(var)"} == ${String(predicate.value)}`;
    case "variable_at_least":
      return `${predicate.name || "(var)"} >= ${predicate.value}`;
    case "object_variable_equals":
      return `${shownRef(predicate.objectId, "object")}.${predicate.name} == ${String(predicate.value)}`;
    case "object_variable_at_least":
      return `${shownRef(predicate.objectId, "object")}.${predicate.name} >= ${predicate.value}`;
    case "current_sector":
      return `current sector is ${shownRef(predicate.sectorId, "sector")}`;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ActionKind = EEAction["kind"];

const TARGET: LogicFieldSpec = { key: "target", label: "Target", widget: "target" };
const POINT: LogicFieldSpec = { key: "position", label: "Position", widget: "point" };

export const ACTION_SPECS: readonly LogicKindSpec<ActionKind>[] = [
  {
    kind: "global_message",
    label: "Global message",
    group: "Message",
    fields: [
      { key: "text", label: "Text", widget: "textarea" },
      { key: "timeoutS", label: "Timeout (s)", widget: "number", nullable: true, min: 1 },
    ],
  },
  {
    kind: "banner",
    label: "Banner (cinematic / top-down view)",
    group: "Message",
    // Observed in EmptyEpsilon 2026: the crew's stations and the main screen do not show it.
    hint: "EmptyEpsilon shows this scrolling banner only on the cinematic and top-down views — not on the crew stations or the main screen. Use a global message or a ship log entry for text the crew must see.",
    fields: [{ key: "text", label: "Text", widget: "text" }],
  },
  {
    kind: "ship_log",
    label: "Ship log entry",
    group: "Message",
    fields: [
      { key: "text", label: "Text", widget: "textarea" },
      { key: "color", label: "Colour", widget: "select", options: LOG_COLORS },
    ],
  },
  {
    kind: "gm_message",
    label: "GM message",
    group: "Message",
    fields: [{ key: "text", label: "Text", widget: "textarea" }],
  },
  {
    kind: "play_sound",
    label: "Play sound",
    group: "Message",
    fields: [{ key: "file", label: "File", widget: "text", hint: "Path under EE's resources/" }],
  },
  {
    kind: "spawn_group",
    label: "Spawn group",
    group: "Map",
    fields: [{ key: "groupId", label: "Group", widget: "groupRef" }],
    hint: "Only groups marked on_call wait for this.",
  },
  {
    kind: "destroy",
    label: "Destroy",
    group: "Map",
    fields: [TARGET],
  },
  {
    kind: "change_sector",
    label: "Change sector",
    group: "Map",
    fields: [
      { key: "sectorId", label: "Destination sector", widget: "sectorRef" },
      { key: "arrivalMarkerId", label: "Arrival marker", widget: "arrivalMarker" },
      { key: "rotation", label: "Arrival heading (deg)", widget: "number", nullable: true, min: 0, max: 360, hint: "Leave empty to keep the ship's own heading." },
    ],
    hint: "Unloads the old sector (not a destruction), creates the destination's At mission start groups from their initial settings and moves the same player ship to the marker. Variables and rules already fired are not reset; the rules after this one wait for the next update. Leave the heading empty to keep the ship's own.",
  },
  {
    kind: "save_checkpoint",
    label: "Save checkpoint",
    group: "Map",
    fields: [],
    hint: "Writes a campaign checkpoint now: the state of the active sector, of every visited sector and of the campaign. Needs campaign saves to be on (Mission → Campaign). A checkpoint is also written when a new campaign starts and after every Change sector.",
  },
  {
    kind: "set_variable",
    label: "Set variable",
    group: "State",
    fields: [
      { key: "name", label: "Variable", widget: "text" },
      { key: "value", label: "Value", widget: "variableValue" },
    ],
  },
  {
    kind: "add_variable",
    label: "Add to variable",
    group: "State",
    fields: [
      { key: "name", label: "Variable", widget: "text" },
      { key: "delta", label: "Delta", widget: "number" },
    ],
  },
  {
    kind: "set_object_variable",
    label: "Set object variable",
    group: "State",
    fields: [
      TARGET,
      { key: "name", label: "Variable", widget: "variableName" },
      { key: "value", label: "Value", widget: "variableValue" },
    ],
    hint: "A group target writes to every member.",
  },
  {
    kind: "add_object_variable",
    label: "Add to object variable",
    group: "State",
    fields: [
      TARGET,
      { key: "name", label: "Variable", widget: "variableName" },
      { key: "delta", label: "Delta", widget: "number" },
    ],
  },
  {
    kind: "set_dialogue",
    label: "Set dialogue",
    group: "Comms",
    fields: [
      TARGET,
      { key: "dialogueId", label: "Dialogue", widget: "dialogueRef" },
    ],
    hint: "Changes what the object says when hailed. Clearing it restores EmptyEpsilon's own menu for that class.",
  },
  {
    kind: "hail_player",
    label: "Hail the player",
    group: "Comms",
    fields: [
      { key: "objectId", label: "Caller", widget: "objectRef" },
      { key: "text", label: "Message", widget: "textarea" },
    ],
    hint: "The object calls the ship. Relay may refuse the hail, and the scenario does not retry.",
  },
  {
    kind: "set_ai",
    label: "Set combat AI",
    // Its own group, following EE's own wording: combat AI states are
    // "distinct from orders, which determine the ship's active objectives".
    // One says how a ship fights, the other says what it is doing.
    group: "Combat AI",
    fields: [TARGET, { key: "ai", label: "AI", widget: "select", options: EE_AI_STATES }],
  },
  // Twelve orders, twelve records. Each names only what its EE method
  // takes, so the form has no field to ignore and no pairing to get wrong.
  { kind: "order_idle", label: "Order: idle", group: "Orders", fields: [TARGET] },
  { kind: "order_roaming", label: "Order: roam", group: "Orders", fields: [TARGET] },
  {
    kind: "order_stand_ground",
    label: "Order: stand ground",
    group: "Orders",
    fields: [TARGET],
  },
  {
    kind: "order_roaming_at",
    label: "Order: roam around a point",
    group: "Orders",
    fields: [TARGET, POINT],
  },
  {
    kind: "order_defend_location",
    label: "Order: defend a location",
    group: "Orders",
    fields: [TARGET, POINT],
  },
  {
    kind: "order_fly_towards",
    label: "Order: fly towards",
    group: "Orders",
    fields: [TARGET, POINT],
    hint: "Engages hostiles that come within short-range radar on the way.",
  },
  {
    kind: "order_fly_towards_blind",
    label: "Order: fly towards (ignore hostiles)",
    group: "Orders",
    fields: [TARGET, POINT],
    hint: "Reverts to idle on arrival.",
  },
  {
    kind: "order_attack",
    label: "Order: attack",
    group: "Orders",
    fields: [TARGET, { key: "objectId", label: "Enemy", widget: "objectRef" }],
  },
  {
    kind: "order_dock",
    label: "Order: dock",
    group: "Orders",
    fields: [TARGET, { key: "objectId", label: "Dock with", widget: "objectRef" }],
  },
  {
    kind: "order_retreat",
    label: "Order: retreat and repair",
    group: "Orders",
    fields: [TARGET, { key: "objectId", label: "Fall back to", widget: "objectRef" }],
  },
  {
    kind: "order_defend_target",
    label: "Order: escort",
    group: "Orders",
    fields: [TARGET, { key: "objectId", label: "Escort", widget: "objectRef" }],
    hint: "Keeps a 2U station on the target and engages hostiles near it.",
  },
  {
    kind: "order_fly_formation",
    label: "Order: fly formation",
    group: "Orders",
    fields: [
      TARGET,
      { key: "leaderId", label: "Leader", widget: "objectRef" },
      { key: "offset", label: "Offset from leader", widget: "point" },
    ],
    hint: "Follows the leader at the given offset and shares its target.",
  },
  {
    kind: "set_hull",
    label: "Set hull",
    group: "Damage",
    fields: [TARGET, { key: "value", label: "Hull", widget: "number", min: 0 }],
  },
  {
    kind: "damage_hull",
    label: "Damage hull",
    group: "Damage",
    fields: [TARGET, { key: "amount", label: "Amount", widget: "number", min: 1 }],
  },
  {
    kind: "set_system_health",
    label: "Set system health",
    group: "Damage",
    fields: [
      TARGET,
      { key: "system", label: "System", widget: "select", options: SHIP_SYSTEMS },
      FRACTION("value", "Health", -1),
    ],
  },
  {
    kind: "set_system_heat",
    label: "Set system heat",
    group: "Damage",
    fields: [
      TARGET,
      { key: "system", label: "System", widget: "select", options: SHIP_SYSTEMS },
      FRACTION("value", "Heat"),
    ],
  },
  {
    kind: "set_alert_level",
    label: "Set alert level",
    group: "Damage",
    fields: [{ key: "level", label: "Level", widget: "select", options: ALERT_LEVELS }],
  },
  {
    kind: "victory",
    label: "Victory",
    group: "Scenario",
    fields: [{ key: "faction", label: "Winning faction", widget: "text" }],
    hint: "Ends the scenario.",
  },
  { kind: "pause_game", label: "Pause game", group: "Scenario", fields: [] },

  // --- exodus tier ---------------------------------------------------------
  {
    kind: "exodus_event",
    label: "Bridge event",
    group: "EXODUS",
    fields: [
      { key: "stepId", label: "Without EXODUS", widget: "exodusStep", nullable: true, hint: "What the crew gets when EXODUS is not there. Required for a vanilla export." },
      { key: "eventType", label: "Event type", widget: "text" },
      { key: "payload", label: "Payload", widget: "json" },
    ],
  },
  {
    kind: "exodus_puzzle",
    label: "Request puzzle",
    group: "EXODUS",
    fields: [
      { key: "stepId", label: "Without EXODUS", widget: "exodusStep", nullable: true, hint: "What the crew gets when EXODUS is not there. Required for a vanilla export." },
      { key: "puzzleId", label: "Puzzle", widget: "text" },
      { key: "role", label: "Role", widget: "text" },
      { key: "params", label: "Params", widget: "json" },
      { key: "timeoutS", label: "Timeout (s)", widget: "number", nullable: true, min: 1 },
    ],
  },
  {
    kind: "exodus_action",
    label: "Request critical action",
    group: "EXODUS",
    fields: [
      { key: "stepId", label: "Without EXODUS", widget: "exodusStep", nullable: true, hint: "What the crew gets when EXODUS is not there. Required for a vanilla export." },
      { key: "actionId", label: "Action", widget: "text" },
    ],
  },
  {
    kind: "exodus_lore",
    label: "Lore drop",
    group: "EXODUS",
    fields: [
      { key: "stepId", label: "Without EXODUS", widget: "exodusStep", nullable: true, hint: "What the crew gets when EXODUS is not there. Required for a vanilla export." },
      { key: "fragmentId", label: "Fragment", widget: "text" },
      {
        key: "foundBy",
        label: "Found by",
        widget: "text",
        nullable: true,
        hint: "Station credited with the discovery. Blank leaves it unattributed.",
      },
    ],
  },
  {
    kind: "exodus_encrypted_comms",
    label: "Encrypted comms",
    group: "EXODUS",
    fields: [
      { key: "stepId", label: "Without EXODUS", widget: "exodusStep", nullable: true, hint: "What the crew gets when EXODUS is not there. Required for a vanilla export." },
      { key: "channel", label: "Channel", widget: "text" },
      { key: "from", label: "From", widget: "text" },
      { key: "text", label: "Plaintext", widget: "textarea" },
    ],
    hint: "Enciphered in the scenario with the codeword for this channel and sender — the plaintext never leaves.",
  },
  {
    kind: "exodus_set_state",
    label: "Set campaign state",
    group: "EXODUS",
    fields: [
      { key: "stepId", label: "Without EXODUS", widget: "exodusStep", nullable: true, hint: "What the crew gets when EXODUS is not there. Required for a vanilla export." },
      { key: "key", label: "Key", widget: "text" },
      { key: "value", label: "Value", widget: "text" },
    ],
  },
  {
    kind: "exodus_complete_chapter",
    label: "Complete chapter",
    group: "EXODUS",
    fields: [
      { key: "stepId", label: "Without EXODUS", widget: "exodusStep", nullable: true, hint: "What the crew gets when EXODUS is not there. Required for a vanilla export." },
      { key: "nextChapterId", label: "Next chapter", widget: "text", nullable: true },
    ],
  },
];

/** Action kinds that need `requires: ["exodus"]` on the project. */
export function isExodusAction(kind: ActionKind): boolean {
  return kind.startsWith("exodus_");
}

/** A schema-valid action of the requested kind, with neutral defaults. */
export function emptyAction(kind: ActionKind, defaults: RefDefaults = {}): EEAction {
  const target: EETargetRef = { ref: "player" };
  switch (kind) {
    case "global_message":
      return { kind: "global_message", text: "", timeoutS: null };
    case "banner":
      return { kind: "banner", text: "" };
    case "ship_log":
      return { kind: "ship_log", text: "", color: "white" };
    case "gm_message":
      return { kind: "gm_message", text: "" };
    case "play_sound":
      return { kind: "play_sound", file: "sfx/alarm.wav" };
    case "spawn_group":
      return { kind: "spawn_group", groupId: ref(defaults.groupId) };
    case "destroy":
      return { kind: "destroy", target };
    case "change_sector":
      return { kind: "change_sector", sectorId: ref(defaults.sectorId), arrivalMarkerId: ref(defaults.markerId), rotation: null };
    case "set_variable":
      return { kind: "set_variable", name: "flag", value: 1 };
    case "add_variable":
      return { kind: "add_variable", name: "flag", delta: 1 };
    case "set_object_variable":
      return { kind: "set_object_variable", target, name: "flag", value: 1 };
    case "add_object_variable":
      return { kind: "add_object_variable", target, name: "flag", delta: 1 };
    case "set_dialogue":
      return { kind: "set_dialogue", target, dialogueId: defaults.dialogueId ?? null };
    case "hail_player":
      return { kind: "hail_player", objectId: ref(defaults.objectId), text: "" };
    case "set_ai":
      return { kind: "set_ai", target, ai: "default" };
    case "order_idle":
      return { kind: "order_idle", target };
    case "order_roaming":
      return { kind: "order_roaming", target };
    case "order_stand_ground":
      return { kind: "order_stand_ground", target };
    case "order_roaming_at":
      return { kind: "order_roaming_at", target, position: blankPlace() };
    case "order_defend_location":
      return { kind: "order_defend_location", target, position: blankPlace() };
    case "order_fly_towards":
      return { kind: "order_fly_towards", target, position: blankPlace() };
    case "order_fly_towards_blind":
      return { kind: "order_fly_towards_blind", target, position: blankPlace() };
    case "order_attack":
      return { kind: "order_attack", target, objectId: ref(defaults.objectId) };
    case "order_dock":
      return { kind: "order_dock", target, objectId: ref(defaults.objectId) };
    case "order_retreat":
      return { kind: "order_retreat", target, objectId: ref(defaults.objectId) };
    case "order_defend_target":
      return { kind: "order_defend_target", target, objectId: ref(defaults.objectId) };
    case "order_fly_formation":
      return {
        kind: "order_fly_formation",
        target,
        leaderId: ref(defaults.objectId),
        offset: { x: 800, y: 0 },
      };
    case "set_hull":
      return { kind: "set_hull", target, value: 100 };
    case "damage_hull":
      return { kind: "damage_hull", target, amount: 10 };
    case "set_system_health":
      return { kind: "set_system_health", target, system: "reactor", value: 0.5 };
    case "set_system_heat":
      return { kind: "set_system_heat", target, system: "reactor", value: 0.5 };
    case "set_alert_level":
      return { kind: "set_alert_level", level: "red" };
    case "victory":
      return { kind: "victory", faction: "Human Navy" };
    case "pause_game":
      return { kind: "pause_game" };
    case "save_checkpoint":
      return { kind: "save_checkpoint" };
    case "exodus_event":
      return { kind: "exodus_event", stepId: null, eventType: "chapter_event", payload: {} };
    case "exodus_puzzle":
      return {
        kind: "exodus_puzzle",
        stepId: null,
        puzzleId: "cooling_redirect",
        role: "engineer",
        params: {},
        timeoutS: null,
      };
    case "exodus_action":
      return { kind: "exodus_action", stepId: null, actionId: "jump_authorisation" };
    case "exodus_lore":
      return { kind: "exodus_lore", stepId: null, fragmentId: "frag_001", foundBy: null };
    case "exodus_encrypted_comms":
      return { kind: "exodus_encrypted_comms", stepId: null, channel: "tactical", from: "Athena-7", text: "" };
    case "exodus_set_state":
      return { kind: "exodus_set_state", stepId: null, key: "flag", value: "1" };
    case "exodus_complete_chapter":
      return { kind: "exodus_complete_chapter", stepId: null, nextChapterId: null };
  }
}
