/**
 * The words the editor uses for things, in one place.
 *
 * The UI is English, in plain terms an author would use; the engine's own names (`PlayerSpaceship`, `on_start`,
 * `narrative`) stay what the project file and the generated Lua call them — they are identifiers, not vocabulary,
 * and renaming one would break a document. A friendly label is shown, and the technical name is kept in the tooltip
 * or the details so nothing is hidden from someone who needs it.
 */

/** The editor's views. The ids are UI state only (never written to a project); the labels are what the author reads. */
export const VIEW_LABELS = {
  map: "Map",
  narrative: "Mission",
  ship: "Fleet",
  dialogues: "Dialogues",
  dmx: "DMX",
} as const;

export type ViewId = keyof typeof VIEW_LABELS;

/** One line on what each view is for, shown as the tab's tooltip. */
export const VIEW_HINTS: Readonly<Record<ViewId, string>> = {
  map: "Place and edit what is in the scene",
  narrative: "What happens and when: timed events, rules and GM buttons",
  ship: "Ship models: hulls, weapons and interiors",
  dialogues: "What an object says when it is hailed",
  dmx: "The room's lighting rig — a separate document, not part of the scenario",
};

const OBJECT_TYPE_LABELS: Readonly<Record<string, string>> = {
  PlayerSpaceship: "Player ship",
  CpuShip: "AI ship",
  SpaceStation: "Station",
  Asteroid: "Asteroid",
  VisualAsteroid: "Decorative asteroid",
  Planet: "Planet",
  Nebula: "Nebula",
  Mine: "Mine",
  BlackHole: "Black hole",
  WormHole: "Wormhole",
  Artifact: "Artifact",
  SupplyDrop: "Supply drop",
  ScanProbe: "Scan probe",
  WarpJammer: "Warp jammer",
  Zone: "Zone",
};

/** "PlayerSpaceship" → "Player ship". An unknown class is shown as it is: better the engine's word than a guess. */
export function objectTypeLabel(type: string): string {
  return OBJECT_TYPE_LABELS[type] ?? type;
}

/** When a group of objects appears. `value` is the project's own key; the label says it in words. */
export const GROUP_WHEN: readonly { readonly value: "on_start" | "on_call"; readonly label: string; readonly detail: string }[] = [
  { value: "on_start", label: "At mission start", detail: "on_start — spawned when the scenario starts" },
  { value: "on_call", label: "When spawned", detail: "on_call — waits for a “spawn group” action: from a rule, a timed event, a GM control, a dialogue reply or an EXODUS fallback" },
];

/** The Mission view's sections. Ids are UI state only. */
export const MISSION_TABS = [
  { id: "rules", label: "Rules", hint: "When something becomes true, do something" },
  { id: "timeline", label: "Timeline", hint: "Timed events: things that happen at a set time" },
  { id: "gm", label: "GM controls", hint: "Buttons on the GM console that run actions when pressed" },
  { id: "variables", label: "Variables", hint: "Values the mission remembers, and what sets or reads them" },
  { id: "diagram", label: "Diagram", hint: "How the parts connect: what spawns what, and what waits for what" },
  { id: "campaign", label: "Campaign", hint: "Whether the running game saves its state (every sector, the campaign) so it can be resumed after EmptyEpsilon is closed" },
] as const;
export type MissionTabId = (typeof MISSION_TABS)[number]["id"];

/**
 * Words for the logic parts. The project's own keys (`beats`, `gmButtons`, `kind: "beat"`) are unchanged: a *beat* is
 * shown as a *timed event*, a *GM button* as a *GM control*, the dry run as the *logic simulation*.
 */
export const LOGIC_WORDS = {
  beat: "Timed event",
  rule: "Rule",
  gmButton: "GM control",
  dialogueNode: "Dialogue",
  exodusStep: "EXODUS step",
  object: "Object",
} as const;

/** Why the simulation is not a game: said wherever its results are shown. */
export const SIMULATION_SCOPE =
  "Simulates the scenario's logic only — timers, rules, variables and spawned groups. It does not simulate EmptyEpsilon's combat, movement, AI or physics, and GM controls are not pressed.";
