import { describe, expect, it } from "vitest";
import {
  boxesOverlapWithPadding,
  buildAreaCalloutCandidates,
  buildContainedSlabCandidates,
  buildExternalSlabCandidates,
  buildFloorPrintAnnotationLayout,
  buildMarkCandidates,
  type FloorPrintAnnotationRequest,
} from "./floor-print-annotation-layout";

const canvas = { x: 0, y: 0, width: 1200, height: 720 };

function slabRequest(index: number): FloorPrintAnnotationRequest {
  const column = index % 4;
  const row = Math.floor(index / 4);
  const bounds = {
    x: 60 + column * 280,
    y: 60 + row * 190,
    width: 230 - (index % 3) * 18,
    height: 150 - (index % 2) * 28,
  };
  const width = 108;
  const height = 54;
  return {
    id: `slab:S${String(index + 1).padStart(2, "0")}`,
    kind: "slab-label",
    priority: 1,
    variants: [{ id: "full", width, height, candidates: buildContainedSlabCandidates(bounds, width, height) }],
  };
}

describe("Floor Print annotation layout", () => {
  it("is deterministic and keeps twelve slab identifiers inside their own slabs without overlap", () => {
    const requests = Array.from({ length: 12 }, (_, index) => slabRequest(index));
    const first = buildFloorPrintAnnotationLayout(requests, canvas);
    const second = buildFloorPrintAnnotationLayout(requests, canvas);
    expect(second).toEqual(first);
    expect(first.slabLabels).toHaveLength(12);
    first.slabLabels.forEach((label, index) => {
      const source = slabRequest(index).variants[0].candidates;
      expect(source.some((candidate) => candidate.x === label.x && candidate.y === label.y)).toBe(true);
    });
    for (let index = 0; index < first.slabLabels.length; index += 1) {
      for (let other = index + 1; other < first.slabLabels.length; other += 1) {
        expect(boxesOverlapWithPadding(first.slabLabels[index], first.slabLabels[other], 0)).toBe(false);
      }
    }
  });

  it("gives slab labels priority and limits mark shifts to 36 SVG pixels", () => {
    const labelBounds = { x: 200, y: 180, width: 220, height: 150 };
    const markCenter = { x: 310, y: 255 };
    const requests: FloorPrintAnnotationRequest[] = [
      {
        id: "slab:S01",
        kind: "slab-label",
        priority: 1,
        variants: [{ id: "compact", width: 82, height: 30, candidates: buildContainedSlabCandidates(labelBounds, 82, 30) }],
      },
      {
        id: "mark:D01",
        kind: "bar-mark",
        priority: 2,
        variants: [{ id: "standard", width: 58, height: 25, candidates: buildMarkCandidates(markCenter, "x", 58, 25) }],
      },
    ];
    const layout = buildFloorPrintAnnotationLayout(requests, canvas);
    const mark = layout.markLabels[0];
    expect(Math.abs(mark.x + mark.width / 2 - markCenter.x)).toBeLessThanOrEqual(36);
    expect(mark.y + mark.height / 2).toBe(markCenter.y);
  });

  it("uses compact candidates for joint and Through callouts, and only externalizes an S label when tiny cannot fit", () => {
    const jointBounds = { x: 480, y: 220, width: 260, height: 160 };
    const tinyBounds = { x: 40, y: 430, width: 24, height: 20 };
    const requests: FloorPrintAnnotationRequest[] = [
      {
        id: "slab:S12",
        kind: "slab-label",
        priority: 1,
        variants: [{
          id: "tiny",
          width: 44,
          height: 26,
          candidates: buildExternalSlabCandidates(tinyBounds, 44, 26),
        }],
      },
      {
        id: "joint:S03|S04",
        kind: "joint-callout",
        priority: 3,
        variants: [
          { id: "full", width: 1400, height: 72, candidates: buildAreaCalloutCandidates(jointBounds, 1400, 72) },
          { id: "compact", width: 116, height: 38, candidates: buildAreaCalloutCandidates(jointBounds, 116, 38) },
        ],
      },
      {
        id: "through:T01",
        kind: "through-callout",
        priority: 4,
        variants: [{ id: "compact", width: 116, height: 38, candidates: buildAreaCalloutCandidates(jointBounds, 116, 38) }],
      },
    ];
    const layout = buildFloorPrintAnnotationLayout(requests, canvas);
    expect(layout.slabLabels[0]).toMatchObject({ id: "slab:S12", external: true });
    expect(layout.jointCallouts[0].variant).toBe("compact");
    expect(layout.throughCallouts).toHaveLength(1);
  });
});
