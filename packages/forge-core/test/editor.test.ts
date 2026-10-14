import { describe, expect, it } from "vitest";
import {
  EEActionSchema,
  EEIdSchema,
  EEObjectSchema,
  EEPredicateSchema,
  EEProjectSchema,
  EETargetRefSchema,
  EEDialogueNodeSchema,
  EEDialogueReplySchema,
  EEDialogueSchema,
  EELogicSchema,
  EESpawnOrderSchema,
  EE_SHIP_TEMPLATE_FIELDS,
  EETemplateDefSchema,
  SPAWNABLE_CLASSES,
  emptyEEProject,
  lookupMethod,
  type AssetManifest,
  type EEDialogue,
  type EELogic,
  type EEObject,
  type EEProject,
  type EETemplateRef,
  type SpawnableClass,
} from "@forge/contracts";
import { loadCatalog } from "../src/catalog/load.js";
import {
  CALLSIGN_PATTERN,
  callsignPrefix,
  existingCallsigns,
  groupByCallsignPrefix,
  memberCallsign,
  nextCallsign,
} from "../src/editor/callsigns.js";
import { brushAt, generateBrush, type Brush } from "../src/editor/brushes.js";
import { checkMarkerId, renameMarker } from "../src/editor/rename.js";
import {
  emptyDialogue,
  emptyNode,
  emptyReply,
  referencesToNode,
  renameNode,
} from "../src/editor/dialogue-forms.js";
import { addAction, addCondition, readRecord } from "../src/editor/logic-edits.js";
import { emptyAction, emptyPredicate } from "../src/editor/logic-forms.js";
import { danglingMarkerIds } from "../src/points.js";
import {
  createBeam,
  createObject,
  createTemplate,
  createTube,
  projectIdFor,
  starterProject,
  stockTemplateNamed,
  templateFromStock,
  uniqueObjectId,
} from "../src/editor/factories.js";
import { objectsUsingTemplate, retargetTemplate } from "../src/editor/retarget.js";
import {
  FIELD_SPECS,
  SPAWN_ORDER_OPTIONS,
  blankSpawnOrder,
  fieldDoc,
  fieldsFor,
} from "../src/editor/fields.js";
import { TEMPLATE_FIELDS, templateFieldGroups } from "../src/editor/template-fields.js";
import { previewClassFor, resolveShipModel } from "../src/editor/ship-preview.js";
import {
  GROUP_ID_KEYS,
  OBJECT_ID_KEYS,
  SECTOR_ID_KEYS,
  MARKER_ID_KEYS,
  checkObjectId,
  renameObject,
} from "../src/editor/rename.js";
import {
  applyMarquee,
  markersInRect,
  objectsInRect,
  rectBetween,
} from "../src/editor/selection.js";

const catalog = loadCatalog();

describe("callsign assignment", () => {
  it("produces callsigns the convention's own regex accepts", () => {
    for (const type of SPAWNABLE_CLASSES) {
      expect(nextCallsign([], type)).toMatch(CALLSIGN_PATTERN);
      expect(nextCallsign([], type, { subCode: "CL" })).toMatch(CALLSIGN_PATTERN);
    }
    expect(memberCallsign("AS-CL-01", 42)).toMatch(CALLSIGN_PATTERN);
  });

  it("uses the documented type and sub codes", () => {
    expect(callsignPrefix("Asteroid")).toBe("AS");
    expect(callsignPrefix("Asteroid", { subCode: "BE" })).toBe("AS-BE");
    expect(callsignPrefix("Planet", { typeCode: "SU" })).toBe("SU");
    expect(nextCallsign([], "CpuShip", { subCode: "EN" })).toBe("SH-EN-01");
  });

  it("fills the first free index rather than always appending", () => {
    expect(nextCallsign(["AS-01", "AS-03"], "Asteroid")).toBe("AS-02");
    expect(nextCallsign(["AS-01", "AS-02"], "Asteroid")).toBe("AS-03");
  });

  it("keeps prefixes independent", () => {
    const existing = ["AS-BE-01", "AS-CL-01", "SH-EN-01"];
    expect(nextCallsign(existing, "Asteroid", { subCode: "BE" })).toBe("AS-BE-02");
    expect(nextCallsign(existing, "Asteroid", { subCode: "CL" })).toBe("AS-CL-02");
    expect(nextCallsign(existing, "Nebula")).toBe("NB-01");
  });

  it("ignores per-member suffixes when picking the next group index", () => {
    // AS-CL-01-001 is a member of group 01, not a group of its own.
    expect(nextCallsign(["AS-CL-01", "AS-CL-01-001"], "Asteroid", { subCode: "CL" })).toBe(
      "AS-CL-02",
    );
  });

  it("groups shared callsigns the way the viewer is meant to", () => {
    const objects = [
      createObject("Asteroid", "a", { x: 0, y: 0 }, { callsign: "AS-BE-01" }),
      createObject("Asteroid", "b", { x: 1, y: 0 }, { callsign: "AS-BE-01" }),
      createObject("Asteroid", "c", { x: 2, y: 0 }, { callsign: "AS-CL-02" }),
    ];
    const grouped = groupByCallsignPrefix(objects);
    expect(grouped.get("AS-BE-01")).toHaveLength(2);
    expect(grouped.get("AS-CL-02")).toHaveLength(1);
  });

  it("collects callsigns across every group", () => {
    const groups = [
      {
        id: "a",
        label: "A",
        when: "on_start" as const,
        objects: [createObject("Mine", "m1", { x: 0, y: 0 }, { callsign: "MN-01" })],
      },
      {
        id: "b",
        label: "B",
        when: "on_call" as const,
        objects: [createObject("Mine", "m2", { x: 0, y: 0 }, { callsign: "MN-02" })],
      },
    ];
    expect(existingCallsigns(groups)).toEqual(["MN-01", "MN-02"]);
  });
});

describe("scatter brushes", () => {
  const belt: Brush = {
    kind: "belt",
    seed: "belt-01",
    count: 20,
    center: { x: 0, y: 0 },
    innerRadius: 14000,
    outerRadius: 16000,
  };

  it("is deterministic for a seed", () => {
    expect(generateBrush(belt)).toEqual(generateBrush(belt));
  });

  it("changes with the seed", () => {
    const other = generateBrush({ ...belt, seed: "belt-02" });
    expect(other).not.toEqual(generateBrush(belt));
  });

  it("emits whole game units so generated Lua stays diffable", () => {
    for (const point of generateBrush(belt)) {
      expect(Number.isInteger(point.position.x)).toBe(true);
      expect(Number.isInteger(point.position.y)).toBe(true);
      expect(Number.isInteger(point.size)).toBe(true);
    }
  });

  it("keeps a belt inside its radius band", () => {
    for (const point of generateBrush(belt)) {
      const distance = Math.hypot(point.position.x, point.position.y);
      expect(distance).toBeGreaterThanOrEqual(13990);
      expect(distance).toBeLessThanOrEqual(16010);
    }
  });

  it("spreads a belt around the full ring instead of clumping", () => {
    // Even spacing plus jitter: every quadrant should be occupied.
    const quadrants = new Set(
      generateBrush(belt).map((p) => {
        const angle = Math.atan2(p.position.y, p.position.x);
        return Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 4);
      }),
    );
    expect(quadrants.size).toBe(4);
  });

  it("draws every size from the requested band", () => {
    for (const point of generateBrush({ ...belt, count: 50, sizeRange: [60, 400] })) {
      expect(point.size).toBeGreaterThanOrEqual(60);
      expect(point.size).toBeLessThanOrEqual(400);
    }
  });

  it("actually varies the size across a wide band", () => {
    // A band the author widened on purpose has to show up as variety, not
    // as fifty identical rocks.
    const sizes = new Set(
      generateBrush({ ...belt, count: 50, sizeRange: [60, 400] }).map((p) => p.size),
    );
    expect(sizes.size).toBeGreaterThan(10);
  });

  it("reproduces the same sizes for the same seed and band", () => {
    const spec = { ...belt, count: 30, sizeRange: [60, 400] as const };
    expect(generateBrush(spec).map((p) => p.size)).toEqual(
      generateBrush(spec).map((p) => p.size),
    );
  });

  it("normalises an inverted band rather than emptying it", () => {
    // The band comes from two free-typed boxes; typing max before min must
    // not produce sizes below the floor.
    const inverted = generateBrush({ ...belt, count: 20, sizeRange: [400, 60] });
    expect(inverted.map((p) => p.size)).toEqual(
      generateBrush({ ...belt, count: 20, sizeRange: [60, 400] }).map((p) => p.size),
    );
  });

  it("never produces a size the project schema would reject", () => {
    // EEAsteroidObjectSchema.size is `.positive()`, so a scatter must not
    // be able to build a document the save then refuses.
    for (const point of generateBrush({ ...belt, count: 40, sizeRange: [0, 0] })) {
      expect(point.size).toBeGreaterThan(0);
      expect(() =>
        EEObjectSchema.parse(
          { ...createObject("Asteroid", "a", point.position), size: point.size },
        ),
      ).not.toThrow();
    }
  });

  it("carries the panel's band into every shape", () => {
    const spec = {
      seed: "s",
      count: 5,
      radius: 10000,
      sizeRange: [60, 400] as const,
    };
    for (const kind of ["belt", "cluster", "field"] as const) {
      expect(brushAt({ ...spec, kind }, { x: 0, y: 0 }).sizeRange).toEqual([60, 400]);
    }
  });

  it("keeps a cluster inside its radius", () => {
    const points = generateBrush({
      kind: "cluster",
      seed: "c",
      count: 50,
      center: { x: 5000, y: -5000 },
      radius: 3000,
    });
    for (const point of points) {
      expect(Math.hypot(point.position.x - 5000, point.position.y + 5000)).toBeLessThanOrEqual(
        3001,
      );
    }
  });

  it("keeps a field inside its box", () => {
    const points = generateBrush({
      kind: "field",
      seed: "f",
      count: 40,
      origin: { x: -1000, y: -2000 },
      width: 4000,
      height: 6000,
    });
    for (const point of points) {
      expect(point.position.x).toBeGreaterThanOrEqual(-1000);
      expect(point.position.x).toBeLessThanOrEqual(3000);
      expect(point.position.y).toBeGreaterThanOrEqual(-2000);
      expect(point.position.y).toBeLessThanOrEqual(4000);
    }
  });

  it("honours the requested count", () => {
    expect(generateBrush({ ...belt, count: 7 })).toHaveLength(7);
    expect(generateBrush({ ...belt, count: 0 })).toHaveLength(0);
  });
});

describe("placing a brush by its centre", () => {
  // The editor arms a brush and takes its centre from a click on the map,
  // so the shape maths lives here rather than in the panel that draws it.
  const spec = { seed: "s", count: 10, radius: 10000 } as const;
  const at = { x: 4000, y: -2000 };

  it("straddles the nominal radius with a belt, because a belt is a band", () => {
    const brush = brushAt({ ...spec, kind: "belt" }, at);
    if (brush.kind !== "belt") throw new Error("expected a belt");
    expect(brush.center).toEqual(at);
    expect(brush.innerRadius).toBeLessThan(spec.radius);
    expect(brush.outerRadius).toBeGreaterThan(spec.radius);
  });

  it("centres a field on the click rather than cornering it", () => {
    const brush = brushAt({ ...spec, kind: "field" }, at);
    if (brush.kind !== "field") throw new Error("expected a field");
    expect(brush.origin).toEqual({ x: at.x - spec.radius / 2, y: at.y - spec.radius / 2 });
    expect(brush.width).toBe(spec.radius);
    expect(brush.height).toBe(spec.radius);
  });

  it("keeps a cluster smaller than the belt at the same setting", () => {
    const cluster = brushAt({ ...spec, kind: "cluster" }, at);
    if (cluster.kind !== "cluster") throw new Error("expected a cluster");
    expect(cluster.center).toEqual(at);
    expect(cluster.radius).toBeLessThan(spec.radius);
  });

  it("carries the seed and count through every shape", () => {
    for (const kind of ["belt", "cluster", "field"] as const) {
      const brush = brushAt({ ...spec, kind }, at);
      expect(brush.seed, kind).toBe("s");
      expect(generateBrush(brush), kind).toHaveLength(10);
    }
  });

  it("puts the scatter where it was asked for, not where the view is", () => {
    // The bug this replaces: brushes always landed on the view centre.
    for (const point of generateBrush(brushAt({ ...spec, kind: "cluster" }, at))) {
      expect(Math.hypot(point.position.x - at.x, point.position.y - at.y)).toBeLessThanOrEqual(
        spec.radius * 0.25 + 1,
      );
    }
  });
});

describe("object factories", () => {
  it("produces a schema-valid object for every placeable class", () => {
    // The editor writes these straight into the document, so anything the
    // factory omits would only surface as a 400 on save.
    for (const type of SPAWNABLE_CLASSES) {
      const object = createObject(type, "obj", { x: 100, y: -200 }, { callsign: "AS-01" });
      const parsed = EEObjectSchema.safeParse(object);
      expect(parsed.success, `${type}: ${parsed.success ? "" : parsed.error.message}`).toBe(
        true,
      );
    }
  });

  it("defaults ship-like objects to stock templates so a fresh map builds", () => {
    const ship = createObject("CpuShip", "s", { x: 0, y: 0 });
    expect(ship.type === "CpuShip" && ship.template).toBe("Phobos T3");
    const station = createObject("SpaceStation", "st", { x: 0, y: 0 });
    expect(station.type === "SpaceStation" && station.template).toBe("Medium Station");
  });

  it("gives a probe an owner, because EE faults without one", () => {
    const probe = createObject("ScanProbe", "p", { x: 0, y: 0 });
    expect(probe.type === "ScanProbe" && probe.ownedByPlayer).toBe(true);
  });

  it("gives a zone a real polygon rather than a degenerate point", () => {
    const zone = createObject("Zone", "z", { x: 1000, y: 1000 });
    expect(zone.type === "Zone" && zone.points.length).toBe(4);
  });

  it("derives unique ids without colliding", () => {
    const taken = new Set(["asteroid", "asteroid_2"]);
    expect(uniqueObjectId(taken, "Asteroid")).toBe("asteroid_3");
    expect(uniqueObjectId(new Set(), "Corsair Mk2")).toBe("corsair_mk2");
    expect(uniqueObjectId(new Set(), "!!!")).toBe("obj");
  });
});

describe("inspector field descriptors", () => {
  it("covers every editable key of every object schema", () => {
    for (const variant of EEObjectSchema.options) {
      const shape = variant.shape as Record<string, unknown>;
      const type = (shape["type"] as { value: SpawnableClass }).value;
      const editable = Object.keys(shape).filter((key) => key !== "id" && key !== "type");
      const covered = new Set(fieldsFor(type).map((field) => field.key));
      const missing = editable.filter((key) => !covered.has(key));
      expect(missing, `${type} is missing inspector fields`).toEqual([]);
    }
  });

  it("never describes a field the schema does not have", () => {
    for (const variant of EEObjectSchema.options) {
      const shape = variant.shape as Record<string, unknown>;
      const type = (shape["type"] as { value: SpawnableClass }).value;
      for (const field of fieldsFor(type)) {
        expect(Object.keys(shape), `${type}.${field.key}`).toContain(field.key);
      }
    }
  });

  it("only cites EE methods that exist in the pinned catalog", () => {
    for (const [type, specs] of Object.entries(FIELD_SPECS)) {
      for (const spec of specs) {
        if (spec.ee === undefined) continue;
        expect(
          lookupMethod(catalog, spec.ee.class, spec.ee.method),
          `${type}.${spec.key} cites ${spec.ee.class}:${spec.ee.method}`,
        ).not.toBeNull();
      }
    }
  });

  it("pulls help text from EE's own documentation", () => {
    const radius = fieldsFor("Planet").find((f) => f.key === "radius");
    expect(radius).toBeDefined();
    const doc = fieldDoc(catalog, radius!);
    expect(doc).toContain("radius");
  });

  it("keeps an editor-authored hint when EE has nothing to add", () => {
    const owner = fieldsFor("ScanProbe").find((f) => f.key === "ownedByPlayer");
    const doc = fieldDoc(catalog, owner!) ?? "";
    expect(doc).toContain("faults on getOwner()");
  });
});

describe("markers", () => {
  const withMarker = (): EEProject => {
    const base = emptyEEProject("m", "M");
    return {
      ...base,
      map: {
        sectors: [],
        groups: [],
        markers: [{ id: "anchor", label: "Anchor", position: { x: 100, y: 200 }, notes: null }],
      },
      logic: {
        ...base.logic,
        rules: [
          {
            id: "r",
            label: "r",
            when: {
              kind: "player_near_point",
              position: { ref: "marker", markerId: "anchor" },
              distance: 1000,
            },
            conditions: [],
            once: true,
            actions: [
              {
                kind: "order_fly_towards",
                target: { ref: "player" },
                position: { ref: "marker", markerId: "anchor" },
              },
            ],
          },
        ],
      },
    };
  };

  it("carries every place along when a marker is renamed", () => {
    const renamed = renameMarker(withMarker(), "anchor", "rally");
    expect(renamed.map.markers[0]?.id).toBe("rally");
    // Both the trigger and the order follow, without either being named here.
    expect(JSON.stringify(renamed)).not.toContain("anchor");
    expect(JSON.stringify(renamed).split('"markerId":"rally"').length - 1).toBe(2);
  });

  it("leaves object ids alone — a marker and an object may share a name", () => {
    const project = withMarker();
    const withBoth: EEProject = {
      ...project,
      map: {
        ...project.map,
        groups: [
          {
            id: "g",
            label: "g",
            when: "on_start",
            objects: [createObject("CpuShip", "anchor", { x: 0, y: 0 })],
          },
        ],
      },
    };
    const renamed = renameMarker(withBoth, "anchor", "rally");
    expect(renamed.map.groups[0]?.objects[0]?.id).toBe("anchor");
    expect(renamed.map.markers[0]?.id).toBe("rally");
  });

  it("refuses an id another marker already holds", () => {
    const project = withMarker();
    const two: EEProject = {
      ...project,
      map: {
        ...project.map,
        markers: [
          ...project.map.markers,
          { id: "rally", label: "Rally", position: { x: 0, y: 0 }, notes: null },
        ],
      },
    };
    expect(checkMarkerId(two, "anchor", "rally")).toBe("taken");
    expect(renameMarker(two, "anchor", "rally")).toBe(two);
  });

  it("names every reference that a deleted marker would break", () => {
    const project = withMarker();
    expect(danglingMarkerIds(project)).toEqual([]);
    const without: EEProject = { ...project, map: { ...project.map, markers: [] } };
    expect(danglingMarkerIds(without)).toEqual(["anchor"]);
  });

  it("catches markers whose position the band swept", () => {
    const markers = [
      { id: "in", label: "In", position: { x: 50, y: 50 }, notes: null },
      { id: "out", label: "Out", position: { x: 5000, y: 50 }, notes: null },
    ];
    const caught = markersInRect(markers, rectBetween({ x: 0, y: 0 }, { x: 100, y: 100 }));
    expect(caught).toEqual(["in"]);
  });
});

describe("dialogue authoring", () => {
  const dialogue = (): EEDialogue => ({
    id: "council",
    label: "Council",
    entry: "greeting",
    nodes: [
      {
        id: "greeting",
        text: "Hello",
        replies: [
          { text: "Go on", target: { kind: "node", nodeId: "cleared" }, conditions: [], actions: [] },
          { text: "GM", target: { kind: "gm" }, conditions: [], actions: [] },
        ],
      },
      {
        id: "cleared",
        text: "Cleared",
        replies: [
          { text: "Back", target: { kind: "node", nodeId: "greeting" }, conditions: [], actions: [] },
        ],
      },
    ],
  });

  it("builds blanks the schema accepts", () => {
    expect(EEDialogueSchema.safeParse(emptyDialogue("d", "D")).success).toBe(true);
    expect(EEDialogueNodeSchema.safeParse(emptyNode("n")).success).toBe(true);
    expect(EEDialogueReplySchema.safeParse(emptyReply("n")).success).toBe(true);
  });

  it("opens a blank dialogue on a node it actually has", () => {
    // `entry` must name a node, so a dialogue with none could not satisfy
    // its own schema.
    const blank = emptyDialogue("d", "D");
    expect(blank.nodes.map((n) => n.id)).toContain(blank.entry);
  });

  it("carries every jump and the entry when a node is renamed", () => {
    const renamed = renameNode(dialogue(), "greeting", "hail");
    expect(renamed.entry).toBe("hail");
    expect(renamed.nodes.map((n) => n.id)).toEqual(["hail", "cleared"]);
    expect(renamed.nodes[1]?.replies[0]?.target).toEqual({ kind: "node", nodeId: "hail" });
  });

  it("refuses a node id the dialogue already holds", () => {
    expect(renameNode(dialogue(), "greeting", "cleared")).toEqual(dialogue());
  });

  it("names what would break before a node is deleted", () => {
    expect(referencesToNode(dialogue(), "greeting")).toEqual(["(the opening node)", "cleared#0"]);
    expect(referencesToNode(dialogue(), "cleared")).toEqual(["greeting#0"]);
  });

  // The reason `LogicOwner` grew a case: a reply's guards and actions are
  // edited by the same machinery a rule's are.
  it("edits a reply's conditions and actions through the shared helpers", () => {
    const logic: EELogic = {
      variables: [],
      beats: [],
      rules: [],
      gmButtons: [],
      dialogues: [dialogue()],
    };
    const owner = { kind: "dialogueReply", id: "council", nodeId: "greeting", index: 0 } as const;

    const guarded = addCondition(logic, owner, emptyPredicate("always"));
    expect(guarded.dialogues[0]?.nodes[0]?.replies[0]?.conditions).toEqual([{ kind: "always" }]);

    const acting = addAction(guarded, owner, emptyAction("banner"));
    expect(acting.dialogues[0]?.nodes[0]?.replies[0]?.actions).toHaveLength(1);

    // And the same path reads back, which is what the map-pick flow needs.
    const path = { owner, target: { slot: "condition", index: 0 } } as const;
    expect(readRecord(acting, path)).toEqual({ kind: "always" });
    expect(EELogicSchema.safeParse(acting).success).toBe(true);
  });
});

describe("spawn orders", () => {
  const kinds = EESpawnOrderSchema.options.map(
    (variant) => (variant.shape.kind as { value: string }).value,
  );

  // Both directions, like the rename test: an order added to the schema
  // with no option here would be unreachable from the inspector, and an
  // option here that the schema does not know would fail on save.
  it("offers exactly the orders the schema defines", () => {
    expect(SPAWN_ORDER_OPTIONS.map((option) => option.kind).sort()).toEqual([...kinds].sort());
  });

  it("only names CpuShip verbs that exist in the pinned catalog", () => {
    for (const option of SPAWN_ORDER_OPTIONS) {
      expect(
        lookupMethod(catalog, "CpuShip", option.method),
        `${option.kind} cites CpuShip:${option.method}`,
      ).not.toBeNull();
    }
  });

  it("builds a valid order for every kind", () => {
    for (const option of SPAWN_ORDER_OPTIONS) {
      const order = blankSpawnOrder(option.kind, { x: 700, y: -300 });
      expect(EESpawnOrderSchema.safeParse(order).success, option.kind).toBe(true);
    }
  });

  // (0, 0) is a real place on the map — a defend point defaulting there
  // would quietly march the ship to the origin the first time it ran.
  it("seeds a defend point with the ship's own position", () => {
    const order = blankSpawnOrder("defend_location", { x: 700, y: -300 });
    expect(order).toEqual({
      kind: "defend_location",
      position: { ref: "point", position: { x: 700, y: -300 } },
    });
  });

  it("gives a newly placed CpuShip something to do", () => {
    const ship = createObject("CpuShip", "raider", { x: 0, y: 0 });
    expect(ship.type === "CpuShip" && ship.order).toEqual({ kind: "roaming" });
  });
});

describe("ship template descriptors", () => {
  // Read from the field table the schema is built out of, not from the
  // schema: `EETemplateDefSchema` is wrapped in a `z.preprocess` for the
  // legacy dock-class merge, and a ZodEffects has no `.shape`. Same
  // guarantee either way — the schema is exactly these keys plus `id` and
  // `copyOf`, and the install library is exactly these keys plus its
  // provenance.
  const editable = [...Object.keys(EE_SHIP_TEMPLATE_FIELDS), "copyOf"];

  it("covers every editable key of the template schema", () => {
    const covered = new Set(TEMPLATE_FIELDS.map((field) => field.key));
    expect(editable.filter((key) => !covered.has(key))).toEqual([]);
  });

  it("never describes a field the template schema does not have", () => {
    for (const field of TEMPLATE_FIELDS) {
      expect(editable, field.key).toContain(field.key);
    }
  });

  it("only cites ShipTemplate methods that exist in the pinned catalog", () => {
    for (const field of TEMPLATE_FIELDS) {
      if (field.ee === undefined) continue;
      expect(
        lookupMethod(catalog, field.ee.class, field.ee.method),
        `${field.key} cites ${field.ee.class}:${field.ee.method}`,
      ).not.toBeNull();
    }
  });

  it("groups the form without losing or reordering a field", () => {
    const flattened = templateFieldGroups().flatMap(([, specs]) => specs.map((s) => s.key));
    expect(flattened).toEqual(TEMPLATE_FIELDS.map((s) => s.key));
    expect(templateFieldGroups().map(([group]) => group)).toEqual([
      "Identity",
      "Hull",
      "Movement",
      "Weapons",
      "Deck plan",
      "Sensors",
      "Docking",
      "Crew abilities",
    ]);
  });

  it("makes a blank template that the schema accepts", () => {
    expect(() => EETemplateDefSchema.parse(createTemplate("raider", "Raider"))).not.toThrow();
  });

  it("gives a new beam and a new tube the first free index", () => {
    const beams = [createBeam([])];
    beams.push(createBeam(beams));
    expect(beams.map((b) => b.index)).toEqual([0, 1]);

    const kept = [createTube([]), createTube([{ ...createTube([]), index: 2 }])];
    // Index 0 is taken by the first, so the second fills 0 only when free.
    expect(kept[0]?.index).toBe(0);
    expect(createTube(kept).index).toBe(1);
  });
});

describe("ship preview resolution", () => {
  const manifest: AssetManifest = {
    "CpuShip:Atlantis X23": { model: "ee-ships/atlantis.glb", scale: 1, rotationOffset: [0, 0, 0], material: null },
    "SpaceStation:Medium Station": { model: "ee-ships/station.glb", scale: 1, rotationOffset: [0, 0, 0], material: null },
  };

  it("maps each template kind to the EE class the manifest is keyed by", () => {
    expect(previewClassFor("ship")).toBe("CpuShip");
    expect(previewClassFor("playership")).toBe("PlayerSpaceship");
    expect(previewClassFor("station")).toBe("SpaceStation");
  });

  it("follows copyOf out to a stock hull the manifest knows", () => {
    // The variant has no entry of its own — it is being authored — but it
    // copies a stock template, and that is the mesh EE will draw.
    const variant = { ...createTemplate("raider", "Raider"), copyOf: "Atlantis X23" };
    const found = resolveShipModel(manifest, variant, [variant]);
    expect(found?.viaTemplateName).toBe("Atlantis X23");
    expect(found?.entry.model).toBe("ee-ships/atlantis.glb");
  });

  it("prefers the template's own entry over its base's", () => {
    const base = { ...createTemplate("base", "Atlantis X23") };
    const own = { ...createTemplate("own", "Medium Station"), kind: "station" as const };
    expect(resolveShipModel(manifest, own, [base, own])?.viaTemplateName).toBe("Medium Station");
  });

  it("answers null rather than showing a different ship", () => {
    const lonely = createTemplate("lonely", "Nothing Like It");
    expect(resolveShipModel(manifest, lonely, [lonely])).toBeNull();
  });

  it("does not loop on a copy cycle", () => {
    const a = { ...createTemplate("a", "A"), copyOf: "B" };
    const b = { ...createTemplate("b", "B"), copyOf: "A" };
    expect(resolveShipModel(manifest, a, [a, b])).toBeNull();
  });
});

describe("starting a scenario from scratch", () => {
  it("produces a document the schema accepts", () => {
    expect(() => EEProjectSchema.parse(starterProject("ghost_fleet", "Ghost Fleet"))).not.toThrow();
  });

  it("opens with somewhere to place things and exactly one player ship", () => {
    // An empty document is the schema's zero value, not a usable scenario:
    // with no group a placed object has nowhere to go, and `ref: "player"`
    // resolves statically, so zero or two player ships is a build error.
    const project = starterProject("ghost_fleet", "Ghost Fleet");
    expect(project.map.groups).toHaveLength(1);
    expect(project.map.groups[0]?.when).toBe("on_start");
    const players = project.map.groups
      .flatMap((g) => g.objects)
      .filter((o) => o.type === "PlayerSpaceship");
    expect(players).toHaveLength(1);
    expect(players[0]?.callsign).toMatch(CALLSIGN_PATTERN);
  });

  it("never leaves the description blank — EE shows it in the picker", () => {
    expect(starterProject("x", "X").description).not.toBe("");
  });

  it("derives an id from the name and steps around the ones taken", () => {
    expect(projectIdFor(new Set(), "Ghost Fleet")).toBe("ghost_fleet");
    expect(projectIdFor(new Set(["ghost_fleet"]), "Ghost Fleet")).toBe("ghost_fleet_2");
    expect(projectIdFor(new Set(), "")).toBe("scenario");
  });
});

describe("renaming an object id", () => {
  function projectWithReferences(): EEProject {
    const planet = createObject("Planet", "planet", { x: 0, y: 0 });
    const moon = createObject("Planet", "moon", { x: 5000, y: 0 });
    const raider = createObject("CpuShip", "raider", { x: 1000, y: 0 });
    return {
      ...emptyEEProject("p", "P"),
      map: {
        sectors: [],
        groups: [
          {
            id: "core",
            label: "Core",
            when: "on_start",
            objects: [
              { ...planet },
              { ...moon, orbit: { targetId: "planet", orbitTimeS: 1800 } },
              raider,
            ],
          },
        ],
        markers: [],
      },
      logic: {
        variables: [],
        beats: [
          {
            id: "b1",
            at: 0,
            label: "Attack",
            actions: [
              { kind: "order_attack", target: { ref: "object", objectId: "raider" }, objectId: "planet" },
              {
                kind: "order_fly_formation",
                target: { ref: "group", groupId: "core" },
                leaderId: "planet",
                offset: { x: 100, y: 0 },
              },
            ],
          },
        ],
        rules: [
          {
            id: "r1",
            label: "Seen",
            when: { kind: "object_destroyed", objectId: "planet" },
            conditions: [],
            actions: [{ kind: "destroy", target: { ref: "object", objectId: "planet" } }],
            once: true,
          },
        ],
        gmButtons: [],
      },
    };
  }

  it("carries every reference with it", () => {
    // An id is the only handle the rest of the document has: an orbit, a
    // trigger, an order's target and a formation leader all name it.
    const renamed = renameObject(projectWithReferences(), "planet", "gas_giant");
    const json = JSON.stringify(renamed);
    expect(json).not.toContain('"planet"');
    expect(renamed.map.groups[0]?.objects[0]?.id).toBe("gas_giant");

    const moon = renamed.map.groups[0]?.objects[1];
    expect(moon?.type === "Planet" ? moon.orbit?.targetId : null).toBe("gas_giant");
    expect(renamed.logic.rules[0]?.when).toEqual({
      kind: "object_destroyed",
      objectId: "gas_giant",
    });
  });

  it("leaves group ids alone — they are a different namespace", () => {
    const project = projectWithReferences();
    const renamed = renameObject(project, "raider", "core");
    const action = renamed.logic.beats[0]?.actions[1];
    expect(action?.kind === "order_fly_formation" ? action.target : null).toEqual({
      ref: "group",
      groupId: "core",
    });
  });

  it("still round-trips through the schema", () => {
    const renamed = renameObject(projectWithReferences(), "planet", "gas_giant");
    expect(() => EEProjectSchema.parse(renamed)).not.toThrow();
  });

  it("refuses an id that is empty, malformed or taken", () => {
    const project = projectWithReferences();
    expect(checkObjectId(project, "planet", "")).toBe("empty");
    expect(checkObjectId(project, "planet", "Gas Giant")).toBe("invalid");
    expect(checkObjectId(project, "planet", "moon")).toBe("taken");
    expect(checkObjectId(project, "planet", "planet")).toBeNull();
    expect(checkObjectId(project, "planet", "gas_giant")).toBeNull();
  });

  it("does nothing rather than half-applying a rejected rename", () => {
    const project = projectWithReferences();
    expect(renameObject(project, "planet", "moon")).toEqual(project);
  });

  it("knows every field in the schema that holds an id", () => {
    // The rewrite is keyed on field names, so a field added later under a
    // name this list does not know would silently stop being rewritten.
    // EEIdSchema is a single shared instance, so identity finds them all.
    const known = new Set<string>([...OBJECT_ID_KEYS, ...GROUP_ID_KEYS, ...SECTOR_ID_KEYS, ...MARKER_ID_KEYS, "id"]);
    const unions = [
      ...EEPredicateSchema.options,
      ...EEActionSchema.options,
      ...EETargetRefSchema.options,
      ...EEObjectSchema.options,
    ];
    for (const variant of unions) {
      for (const [key, type] of Object.entries(variant.shape as Record<string, unknown>)) {
        if (type === EEIdSchema) {
          expect(known, `${key} holds an id but the rename does not know it`).toContain(key);
        }
      }
    }
  });
});

describe("rubber-band selection", () => {
  const at = (id: string, x: number, y: number): EEObject =>
    createObject("Asteroid", id, { x, y });
  const groups = [
    { id: "core", label: "Core", when: "on_start" as const, objects: [at("a", 0, 0), at("b", 1000, 1000)] },
    { id: "wave", label: "Wave", when: "on_call" as const, objects: [at("c", 5000, 5000)] },
  ];

  it("normalises a band dragged in any direction", () => {
    const upLeft = rectBetween({ x: 100, y: 200 }, { x: -100, y: -200 });
    expect(upLeft).toEqual({ min: { x: -100, y: -200 }, max: { x: 100, y: 200 } });
  });

  it("catches objects by their centre, across every group", () => {
    // The canvas draws all groups, so the band takes what the author sees
    // rather than only what is in the group they happen to be editing.
    const caught = objectsInRect(groups, rectBetween({ x: -500, y: -500 }, { x: 6000, y: 6000 }));
    expect([...caught].sort()).toEqual(["a", "b", "c"]);
  });

  it("leaves out what the band did not reach", () => {
    const caught = objectsInRect(groups, rectBetween({ x: -100, y: -100 }, { x: 500, y: 500 }));
    expect(caught).toEqual(["a"]);
  });

  it("includes an object exactly on the edge", () => {
    expect(objectsInRect(groups, rectBetween({ x: 0, y: 0 }, { x: 1000, y: 1000 }))).toEqual([
      "a",
      "b",
    ]);
  });

  it("replaces the selection, or adds to it when Shift is held", () => {
    expect(applyMarquee(["z"], ["a", "b"], false)).toEqual(["a", "b"]);
    expect(applyMarquee(["z"], ["a", "b"], true)).toEqual(["z", "a", "b"]);
    // A band over something already selected must not duplicate it.
    expect(applyMarquee(["a"], ["a", "b"], true)).toEqual(["a", "b"]);
  });

  it("an empty band selects nothing, which is how a plain click clears", () => {
    const point = rectBetween({ x: 9999, y: 9999 }, { x: 9999, y: 9999 });
    expect(objectsInRect(groups, point)).toEqual([]);
  });
});

/**
 * Bringing a stock hull into a project.
 *
 * EmptyEpsilon has no way to reference an existing template from a
 * scenario, so "copy the Atlantis" is a full materialisation of what the
 * install's Lua declares (ADR-0041). These tests pin the two halves that
 * can go wrong quietly: what the copy carries, and what happens to the map
 * objects that were flying the original.
 */
describe("copying a stock ship into a project", () => {
  // Built from the project factory rather than typed out: a stock template
  // IS a project template minus the identity, plus provenance, and saying
  // that in the fixture is what keeps this test honest if the shape moves.
  const { id: _id, copyOf: _copyOf, ...blank } = createTemplate("ignored", "Atlantis");
  const stock: EETemplateRef = {
    ...blank,
    kind: "playership",
    hull: 250,
    shields: [200, 200],
    model: "battleship_destroyer_1_upgraded",
    className: "Corvette",
    subclassName: "Destroyer",
    rooms: [{ x: 1, y: 0, width: 2, height: 1, system: "maneuver" }],
    jumpDrive: { enabled: true, minRange: null, maxRange: null },
    sourceFile: "scripts/shiptemplates/corvette.lua",
    copiedFrom: "Atlantis X23",
  };

  it("carries every field, under the new identity", () => {
    const copy = templateFromStock(stock, "atlantis_exodus", "Atlantis (EXODUS)");
    expect(copy.id).toBe("atlantis_exodus");
    expect(copy.name).toBe("Atlantis (EXODUS)");
    expect(copy.hull).toBe(250);
    expect(copy.rooms).toHaveLength(1);
    expect(copy.jumpDrive).toEqual({ enabled: true, minRange: null, maxRange: null });
    // The document round-trips: a copy that would not parse is a copy the
    // editor could open and never save.
    expect(() => EETemplateDefSchema.parse(copy)).not.toThrow();
  });

  it("never claims to copy a stock base — EE has nothing to copy from", () => {
    // `copiedFrom` is provenance on the library side; `copyOf` is an
    // instruction to the emitter, and the emitter would refuse a base the
    // project does not define.
    expect(templateFromStock(stock, "a", "A").copyOf).toBeNull();
    expect(stock.copiedFrom).toBe("Atlantis X23");
  });

  it("drops the library's own bookkeeping", () => {
    const copy = templateFromStock(stock, "a", "A");
    expect(copy).not.toHaveProperty("sourceFile");
    expect(copy).not.toHaveProperty("copiedFrom");
  });

  it("recognises a name the install already defines", () => {
    const library = { templates: [stock] };
    expect(stockTemplateNamed(library, "Atlantis")?.hull).toBe(250);
    expect(stockTemplateNamed(library, "Atlantis (EXODUS)")).toBeNull();
    expect(stockTemplateNamed(null, "Atlantis")).toBeNull();
  });
});

describe("moving map objects to another template", () => {
  const project: EEProject = {
    ...starterProject("fleet", "Fleet"),
    map: {
      sectors: [],
      markers: [],
      groups: [
        {
          id: "core",
          label: "Core",
          when: "on_start",
          objects: [
            createObject("PlayerSpaceship", "hero", { x: 0, y: 0 }, { template: "Atlantis" }),
            createObject("CpuShip", "escort", { x: 100, y: 0 }, { template: "Atlantis" }),
            createObject("CpuShip", "raider", { x: 200, y: 0 }, { template: "Phobos T3" }),
            createObject("Asteroid", "rock", { x: 300, y: 0 }),
          ],
        },
      ],
    },
  };

  it("finds every object flying a template, and only those", () => {
    expect(objectsUsingTemplate(project, "Atlantis")).toEqual(["hero", "escort"]);
    expect(objectsUsingTemplate(project, "Phobos T3")).toEqual(["raider"]);
    expect(objectsUsingTemplate(project, "Nirvana R5")).toEqual([]);
  });

  it("repoints them without touching anything else", () => {
    const moved = retargetTemplate(project, "Atlantis", "Atlantis (EXODUS)");
    expect(objectsUsingTemplate(moved, "Atlantis")).toEqual([]);
    expect(objectsUsingTemplate(moved, "Atlantis (EXODUS)")).toEqual(["hero", "escort"]);
    expect(objectsUsingTemplate(moved, "Phobos T3")).toEqual(["raider"]);
    // An Asteroid has no template, and must survive the walk unchanged.
    const rock = moved.map.groups[0]?.objects.find((o) => o.id === "rock");
    expect(rock).toEqual(project.map.groups[0]?.objects.find((o) => o.id === "rock"));
    expect(() => EEProjectSchema.parse(moved)).not.toThrow();
  });

  it("returns the document itself when nothing referenced the old name", () => {
    expect(retargetTemplate(project, "Nirvana R5", "Whatever")).toBe(project);
    expect(retargetTemplate(project, "Atlantis", "Atlantis")).toBe(project);
  });
});

describe("a new scenario of the standalone product", () => {
  it("has a description that is shown in EmptyEpsilon's menu and does not name an optional product", () => {
    const description = starterProject("x", "X").description;
    expect(description.trim()).not.toBe("");
    expect(description).not.toMatch(/EXODUS/i);
  });
});

describe("the banner action", () => {
  it("tells the author where EmptyEpsilon shows it, because the crew's stations do not", async () => {
    const { ACTION_SPECS } = await import("../src/editor/logic-forms.js");
    const banner = ACTION_SPECS.find((spec) => spec.kind === "banner");
    expect(banner?.label).toMatch(/cinematic/i);
    expect(banner?.hint).toMatch(/not on the crew stations/i);
  });
});
