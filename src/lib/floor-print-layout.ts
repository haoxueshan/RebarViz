import type { FloorPrintBomRow, FloorPrintGeometry } from "./floor-print";

export type FloorPrintSlabRef = {
  slabId: string;
  printId: string;
  name: string;
  sortIndex: number;
};

export type FloorPrintAreaGroup = {
  areaKey: string;
  slabIds: string[];
  slabRefs: FloorPrintSlabRef[];
  displayName: string;
  mainRows: FloorPrintBomRow[];
  secondaryRows: FloorPrintBomRow[];
  sortIndex: number;
};

export type FloorPrintSlabRebarSummary = {
  slabRef: FloorPrintSlabRef;
  mainRows: FloorPrintBomRow[];
  secondaryRows: FloorPrintBomRow[];
};

type PrintSlabGeometry = FloorPrintGeometry["slabs"][number];

const POSITION_EPSILON = 1e-4;
const STANDARD_SLAB_NAME = /^板区\s*(\d+)$/;

function standardSlabNumber(name: string): number | null {
  const match = name.trim().match(STANDARD_SLAB_NAME);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function physicalSlabGeometry(geometry: FloorPrintGeometry, slab: PrintSlabGeometry) {
  const physical = geometry.physical?.slabs.find((item) => item.slabId === slab.id);
  return physical
    ? { x: physical.x, y: physical.y, width: physical.width, height: physical.height }
    : { x: slab.x, y: slab.y, width: slab.width, height: slab.height };
}

function comparePhysicalSlabs(geometry: FloorPrintGeometry, left: PrintSlabGeometry, right: PrintSlabGeometry): number {
  const leftBox = physicalSlabGeometry(geometry, left);
  const rightBox = physicalSlabGeometry(geometry, right);
  // SVG reverses the world Y axis, so the larger physical top edge reads first on paper.
  const topDifference = (rightBox.y + rightBox.height) - (leftBox.y + leftBox.height);
  if (Math.abs(topDifference) > POSITION_EPSILON) return topDifference;
  const leftDifference = leftBox.x - rightBox.x;
  if (Math.abs(leftDifference) > POSITION_EPSILON) return leftDifference;
  const nameOrder = left.name.localeCompare(right.name, "zh-CN");
  return nameOrder || left.id.localeCompare(right.id);
}

function nextAvailableNumber(used: ReadonlySet<number>): number {
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

/**
 * Deterministic, print-only S identifiers. No FloorPlanState or snapshot field is mutated.
 * Standard Chinese numeric room names keep their semantic number; all other rooms follow
 * physical reading order (top-to-bottom, then left-to-right).
 */
export function buildFloorPrintSlabRefs(geometry: FloorPrintGeometry): FloorPrintSlabRef[] {
  const physicalOrder = [...geometry.slabs].sort((left, right) => comparePhysicalSlabs(geometry, left, right));
  const physicalIndex = new Map(physicalOrder.map((slab, index) => [slab.id, index]));
  const pending = physicalOrder.map((slab) => ({ slab, standardNumber: standardSlabNumber(slab.name) }));
  const used = new Set<number>();
  const assigned = new Map<string, number>();

  [...pending]
    .filter((item) => item.standardNumber !== null)
    .sort((left, right) =>
      left.standardNumber! - right.standardNumber! ||
      (physicalIndex.get(left.slab.id)! - physicalIndex.get(right.slab.id)!) ||
      left.slab.id.localeCompare(right.slab.id))
    .forEach((item) => {
      const requested = item.standardNumber!;
      const number = used.has(requested) ? nextAvailableNumber(used) : requested;
      used.add(number);
      assigned.set(item.slab.id, number);
    });

  pending
    .filter((item) => !assigned.has(item.slab.id))
    .forEach((item) => {
      const number = nextAvailableNumber(used);
      used.add(number);
      assigned.set(item.slab.id, number);
    });

  return [...geometry.slabs]
    .map((slab) => {
      const number = assigned.get(slab.id)!;
      return {
        slabId: slab.id,
        printId: `S${String(number).padStart(2, "0")}`,
        name: slab.name,
        sortIndex: number,
      };
    })
    .sort((left, right) => left.sortIndex - right.sortIndex || left.slabId.localeCompare(right.slabId));
}

export function floorPrintSlabRefMap(refs: readonly FloorPrintSlabRef[]): ReadonlyMap<string, FloorPrintSlabRef> {
  return new Map(refs.map((ref) => [ref.slabId, ref]));
}

export function floorPrintAreaKey(slabIds: readonly string[]): string {
  return [...new Set(slabIds)].sort().join("|");
}

function displayNameForArea(slabRefs: readonly FloorPrintSlabRef[]): string {
  if (slabRefs.length === 1) return `${slabRefs[0].printId} · ${slabRefs[0].name}`;
  if (slabRefs.length > 1) return `${slabRefs.map((ref) => ref.printId).join(" + ")} · 联合区域`;
  return "未关联板区";
}

/** Each formal print BOM row belongs to exactly one area key. */
export function buildFloorPrintAreaGroups(
  rows: readonly FloorPrintBomRow[],
  refs: readonly FloorPrintSlabRef[],
): FloorPrintAreaGroup[] {
  const refsById = floorPrintSlabRefMap(refs);
  const groups = new Map<string, FloorPrintAreaGroup>();
  rows.forEach((row) => {
    const slabIds = [...new Set(row.slabIds)].sort();
    const areaKey = floorPrintAreaKey(slabIds);
    let group = groups.get(areaKey);
    if (!group) {
      const slabRefs = slabIds
        .flatMap((slabId) => {
          const ref = refsById.get(slabId);
          return ref ? [ref] : [];
        })
        .sort((left, right) => left.sortIndex - right.sortIndex || left.slabId.localeCompare(right.slabId));
      group = {
        areaKey,
        slabIds,
        slabRefs,
        displayName: displayNameForArea(slabRefs),
        mainRows: [],
        secondaryRows: [],
        sortIndex: slabRefs[0]?.sortIndex ?? Number.MAX_SAFE_INTEGER,
      };
      groups.set(areaKey, group);
    }
    if (row.role === "main") group.mainRows.push(row);
    else group.secondaryRows.push(row);
  });
  return [...groups.values()].sort((left, right) =>
    left.sortIndex - right.sortIndex || left.areaKey.localeCompare(right.areaKey));
}

export function buildFloorPrintSlabRebarSummaries(
  rows: readonly FloorPrintBomRow[],
  refs: readonly FloorPrintSlabRef[],
): FloorPrintSlabRebarSummary[] {
  const summaries = new Map(refs.map((ref) => [ref.slabId, {
    slabRef: ref,
    mainRows: [] as FloorPrintBomRow[],
    secondaryRows: [] as FloorPrintBomRow[],
  }]));
  rows.forEach((row) => {
    if (row.slabIds.length !== 1) return;
    const summary = summaries.get(row.slabIds[0]);
    if (!summary) return;
    if (row.role === "main") summary.mainRows.push(row);
    else summary.secondaryRows.push(row);
  });
  return [...summaries.values()].sort((left, right) =>
    left.slabRef.sortIndex - right.slabRef.sortIndex || left.slabRef.slabId.localeCompare(right.slabRef.slabId));
}

export function floorPrintMarks(rows: readonly FloorPrintBomRow[]): string {
  return rows.map((row) => row.mark).join("/");
}
