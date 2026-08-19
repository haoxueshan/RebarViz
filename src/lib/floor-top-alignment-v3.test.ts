import { describe, expect, it } from "vitest";
import {
  findSharedRebarPhase,
  type SharedRebarPhaseNode,
} from "./floor-top-alignment-v3";
import { countInheritedPositions } from "./floor-top-alignment";
import { countBars, type CountMode } from "./slab-calculator";

describe("Floor Rebar V1.4C.5 shared phase feasibility solver", () => {
  it("finds a non-centered phase for the critical B/C proof", () => {
    const nodes: SharedRebarPhaseNode[] = [
      { minMm: 13130, maxMm: 16400, spacingMm: 200, targetCount: 17, centeredPhase: 165 },
      { minMm: 11078, maxMm: 16758, spacingMm: 200, targetCount: 29, centeredPhase: 118 },
    ];
    expect(countInheritedPositions(13130, 16400, 200, 118).count).not.toBe(17);
    expect(countInheritedPositions(11078, 16758, 200, 165).count).not.toBe(29);
    const first = findSharedRebarPhase(nodes, 118);
    const second = findSharedRebarPhase(nodes, 118);
    expect(first).toEqual(second);
    expect(first).not.toBeNull();
    expect(nodes.map((node) => countInheritedPositions(
      node.minMm,
      node.maxMm,
      node.spacingMm,
      first!.phaseMm,
    ).count)).toEqual([17, 29]);
    expect(first!.phaseMm).not.toBe(118);
    expect(first!.phaseMm).not.toBe(165);
  });

  it.each(["project", "round", "floor"] as const)(
    "preserves the target count produced by %s mode",
    (mode: CountMode) => {
      const spacingMm = 200;
      const spans = [3270, 5680];
      const nodes = spans.map((span, index): SharedRebarPhaseNode => {
        const targetCount = countBars(span, spacingMm, mode);
        const offset = Math.max(0, (span - (targetCount - 1) * spacingMm) / 2);
        return {
          minMm: index === 0 ? 13130 : 11078,
          maxMm: (index === 0 ? 13130 : 11078) + span,
          spacingMm,
          targetCount,
          centeredPhase: ((index === 0 ? 13130 : 11078) + offset) % spacingMm,
        };
      });
      const solved = findSharedRebarPhase(nodes);
      expect(solved).not.toBeNull();
      expect(nodes.every((node) => countInheritedPositions(
        node.minMm,
        node.maxMm,
        spacingMm,
        solved!.phaseMm,
      ).count === node.targetCount)).toBe(true);
    },
  );
});
