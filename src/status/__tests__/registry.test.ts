import { expect, test } from "bun:test";
import { BEHAVIORS, STATUS_CATALOG, requireStatus, resolveStatus, statusAssetManifest, statusIds, type StatusBehavior } from "@status";
import { STATUS_BEHAVIOR_KINDS, StatusRefSchema, StatusSpecSchema } from "@status/schema";
import { BUFF_TEMPLATES } from "../catalog/buffs";
import { DEBUFF_TEMPLATES } from "../catalog/debuffs";

test("every behavior kind has one registry entry and one schema", () => {
  expect(Object.keys(BEHAVIORS).sort()).toEqual([...STATUS_BEHAVIOR_KINDS].sort());
});

test("every behavior kind is exercised by at least one catalog template", () => {
  const used = new Set(Object.values(STATUS_CATALOG).map(template => template.behavior.kind));
  expect(STATUS_BEHAVIOR_KINDS.filter(kind => !used.has(kind))).toEqual([]);
});

test("buff and debuff inputs are disjoint, correctly classified, and fully combined", () => {
  const buffIds = Object.keys(BUFF_TEMPLATES);
  const debuffIds = Object.keys(DEBUFF_TEMPLATES);
  expect(buffIds.filter(id => debuffIds.includes(id))).toEqual([]);
  expect(buffIds.every(id => BUFF_TEMPLATES[id]!.kind === "buff")).toBe(true);
  expect(debuffIds.every(id => DEBUFF_TEMPLATES[id]!.kind === "debuff")).toBe(true);
  expect(Object.keys(STATUS_CATALOG).sort()).toEqual([...buffIds, ...debuffIds].sort());
  expect(statusIds("buff").sort()).toEqual(buffIds.sort());
  expect(statusIds("debuff").sort()).toEqual(debuffIds.sort());
});

test("every catalog template validates as a complete specification", () => {
  const invalid = Object.keys(STATUS_CATALOG).flatMap(ref => {
    const parsed = StatusSpecSchema.safeParse(requireStatus(ref));
    return parsed.success ? [] : [`${ref}: ${parsed.error.message}`];
  });
  expect(invalid).toEqual([]);
});

test("linked references point at catalog templates", () => {
  const links = Object.entries(STATUS_CATALOG).flatMap(([id, template]) => linkedRefs(template.behavior).map(ref => ({ id, ref })));
  expect(links.length).toBeGreaterThan(0);
  expect(links.filter(({ ref }) => !(ref in STATUS_CATALOG))).toEqual([]);
});

test("catalog defaults are frozen and resolution never mutates them", () => {
  const before = JSON.stringify(STATUS_CATALOG);
  const spec = requireStatus("magic_vulnerability", { duration: 99, behavior: { multiplier: 3 } });
  expect(spec.behavior).toEqual({ kind: "vuln", damageType: "magical", multiplier: 3 });
  expect(JSON.stringify(STATUS_CATALOG)).toBe(before);
  expect(Object.isFrozen(STATUS_CATALOG.magic_vulnerability)).toBe(true);
  expect(Object.isFrozen(STATUS_CATALOG.magic_vulnerability!.behavior)).toBe(true);
  expect(() => { (STATUS_CATALOG.magic_vulnerability as { duration: number }).duration = 1; }).toThrow();
});

test("permitted overrides cover timing, presentation, grouping and same-behavior parameters", () => {
  const spec = requireStatus("first_in_line", {
    name: "Renamed",
    duration: 3,
    visibility: "invisible",
    priority: true,
    group: "line",
    icon: "other.png",
    marker: "1",
    behavior: { expiryDamage: 5 },
  });
  expect(spec).toMatchObject({ ref: "first_in_line", kind: "debuff", name: "Renamed", duration: 3, group: "line" });
  expect(spec.behavior).toEqual({ kind: "expiryDamage", expiryDamage: 5, expiryDamageType: "true" });
});

test("identity changes are rejected", () => {
  expect(resolveStatus({ ref: "tank_limit_break", kind: "debuff" })).toMatchObject({ ok: false });
  expect(resolveStatus({ ref: "magic_vulnerability", behavior: { kind: "mitigation" } })).toMatchObject({ ok: false });
  expect(resolveStatus({ ref: "not_registered" })).toMatchObject({ ok: false });
  expect(resolveStatus({ ref: "magic_vulnerability", kind: "debuff", behavior: { kind: "vuln" } })).toMatchObject({ ok: true });
  expect(resolveStatus({ ref: "sprint", behavior: { multiplier: -1 } })).toMatchObject({ ok: false });
});

test("status asset manifest includes catalog presentation, behavior fallbacks, and generated markers", () => {
  const assets = new Set(statusAssetManifest());
  expect(assets.has("acceleration_bomb.png")).toBe(true);
  expect(assets.has("teleportent_left.png")).toBe(true);
  expect(assets.has("limit8_head.png")).toBe(true);
});

test("authored statuses must be registered references", () => {
  expect(StatusRefSchema.safeParse({ name: "Inline", kind: "buff", duration: 1, behavior: { kind: "none" } }).success).toBe(false);
  expect(StatusRefSchema.safeParse({ ref: "sprint", behavior: { kind: "knockbackImmunity" } }).success).toBe(false);
  expect(StatusRefSchema.safeParse({ ref: "sprint", behavior: { multiplier: -1 } }).success).toBe(false);
  expect(StatusRefSchema.parse({ ref: "regen" })).toMatchObject({ ref: "regen", kind: "buff", name: "Regen" });
});

test("Kefka Says markers keep the shared definition but carry no behavior", () => {
  const marked = [
    "compressed_water", "fake_compressed_water", "forked_lightning", "fake_forked_lightning",
    "cursed_shriek", "fake_cursed_shriek", "entropy", "fake_entropy",
    "dynamic_fluid", "fake_dynamic_fluid", "allagan_field", "beyond_death",
  ];
  for (const id of marked) {
    expect(STATUS_CATALOG[`${id}_marker`]).toEqual({ ...STATUS_CATALOG[id]!, behavior: { kind: "none" } });
  }
});

function linkedRefs(behavior: StatusBehavior): string[] {
  if (behavior.kind === "escalating") return behavior.escalateTo === undefined ? [] : [behavior.escalateTo];
  if (behavior.kind === "alternating") return behavior.repeatApply === undefined ? [] : [behavior.repeatApply];
  if (behavior.kind === "elementCleanse") return Object.values(behavior.elements);
  return [];
}

test("every icon a status can show exists in the package icon folder", async () => {
  const folder = `${import.meta.dir}/../icons`;
  const icons = statusAssetManifest();
  const missing: string[] = [];
  for (const icon of icons) if (!(await Bun.file(`${folder}/${icon}`).exists())) missing.push(icon);
  expect(missing).toEqual([]);
});
