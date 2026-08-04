import type {
  AnchorSource,
  BarDirection,
  RoomArrangement,
  SlabRoom,
} from "./slab-calculator";

export type AutomaticWallSource = Extract<
  AnchorSource,
  "inner-wall" | "outer-wall"
>;

export type RoomBoundaryZone = {
  perpendicularStartMm: number;
  perpendicularEndMm: number;
  startSource: AutomaticWallSource;
  endSource: AutomaticWallSource;
};

type TopologyRoom = Pick<SlabRoom, "id" | "spanX" | "spanY">;

function perpendicularSpan(room: TopologyRoom, direction: BarDirection): number {
  return direction === "x" ? room.spanY : room.spanX;
}

function mergeBoundaryZones(zones: RoomBoundaryZone[]): RoomBoundaryZone[] {
  return zones.reduce<RoomBoundaryZone[]>((merged, zone) => {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.perpendicularEndMm === zone.perpendicularStartMm &&
      previous.startSource === zone.startSource &&
      previous.endSource === zone.endSource
    ) {
      previous.perpendicularEndMm = zone.perpendicularEndMm;
      return merged;
    }
    merged.push({ ...zone });
    return merged;
  }, []);
}

/**
 * Returns the automatic wall source along a room edge. X-arranged rooms share
 * y=0 (south alignment); Y-arranged rooms share x=0 (west alignment).
 */
export function buildRoomBoundaryZones(
  rooms: readonly TopologyRoom[],
  arrangement: RoomArrangement,
  roomIndex: number,
  direction: BarDirection,
): RoomBoundaryZone[] {
  const room = rooms[roomIndex];
  if (!room) return [];
  const span = perpendicularSpan(room, direction);
  if (!Number.isFinite(span) || span <= 0) return [];
  if (arrangement !== direction || rooms.length <= 1) {
    return [
      {
        perpendicularStartMm: 0,
        perpendicularEndMm: span,
        startSource: "outer-wall",
        endSource: "outer-wall",
      },
    ];
  }

  const previous = rooms[roomIndex - 1];
  const next = rooms[roomIndex + 1];
  const previousSpan = previous
    ? Math.min(Math.max(perpendicularSpan(previous, direction), 0), span)
    : 0;
  const nextSpan = next
    ? Math.min(Math.max(perpendicularSpan(next, direction), 0), span)
    : 0;
  const breakpoints = [...new Set([0, previousSpan, nextSpan, span])]
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= span)
    .sort((left, right) => left - right);
  const zones: RoomBoundaryZone[] = [];
  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const start = breakpoints[index];
    const end = breakpoints[index + 1];
    if (end <= start) continue;
    const midpoint = start + (end - start) / 2;
    zones.push({
      perpendicularStartMm: start,
      perpendicularEndMm: end,
      startSource:
        previous && midpoint < perpendicularSpan(previous, direction)
          ? "inner-wall"
          : "outer-wall",
      endSource:
        next && midpoint < perpendicularSpan(next, direction)
          ? "inner-wall"
          : "outer-wall",
    });
  }
  return mergeBoundaryZones(zones);
}

/** Deterministically allocates an integer total while preserving the total. */
export function allocateLargestRemainder(
  total: number,
  weights: readonly number[],
): number[] {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const safeWeights = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  );
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (safeWeights.length === 0) return [];
  if (safeTotal === 0) return safeWeights.map(() => 0);
  if (weightTotal <= 0) {
    return safeWeights.map((_, index) => (index === 0 ? safeTotal : 0));
  }

  const quotas = safeWeights.map((weight) => (safeTotal * weight) / weightTotal);
  const allocated = quotas.map((quota) => Math.floor(quota));
  let remaining = safeTotal - allocated.reduce((sum, count) => sum + count, 0);
  const priority = quotas
    .map((quota, index) => ({ index, remainder: quota - Math.floor(quota) }))
    .sort(
      (left, right) =>
        right.remainder - left.remainder || left.index - right.index,
    );
  for (let index = 0; index < priority.length && remaining > 0; index += 1) {
    allocated[priority[index].index] += 1;
    remaining -= 1;
  }
  return allocated;
}
