export type FloorPrintAnnotationKind =
  | "slab-label"
  | "bar-mark"
  | "joint-callout"
  | "through-callout";

export type FloorPrintAnnotationBox = {
  id: string;
  kind: FloorPrintAnnotationKind;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
  variant: string;
  external?: boolean;
  leaderTo?: { x: number; y: number };
};

export type FloorPrintAnnotationBounds = Pick<FloorPrintAnnotationBox, "x" | "y" | "width" | "height">;

export type FloorPrintAnnotationCandidate = {
  x: number;
  y: number;
  external?: boolean;
  leaderTo?: { x: number; y: number };
};

export type FloorPrintAnnotationVariant = {
  id: string;
  width: number;
  height: number;
  candidates: readonly FloorPrintAnnotationCandidate[];
};

export type FloorPrintAnnotationRequest = {
  id: string;
  kind: FloorPrintAnnotationKind;
  priority: number;
  variants: readonly FloorPrintAnnotationVariant[];
};

export type FloorPrintAnnotationLayout = {
  boxes: FloorPrintAnnotationBox[];
  slabLabels: FloorPrintAnnotationBox[];
  markLabels: FloorPrintAnnotationBox[];
  jointCallouts: FloorPrintAnnotationBox[];
  throughCallouts: FloorPrintAnnotationBox[];
};

const MARK_OFFSETS = [0, -12, 12, -24, 24, -36, 36] as const;

export function boxesOverlapWithPadding(
  left: FloorPrintAnnotationBounds,
  right: FloorPrintAnnotationBounds,
  padding = 5,
): boolean {
  return left.x < right.x + right.width + padding &&
    left.x + left.width + padding > right.x &&
    left.y < right.y + right.height + padding &&
    left.y + left.height + padding > right.y;
}

export function estimatePrintTextWidth(text: string, fontSize = 13): number {
  let units = 0;
  for (const character of text) {
    units += /[\u2e80-\u9fff\uff00-\uffef]/u.test(character) ? 1 : 0.62;
  }
  return Math.ceil(units * fontSize);
}

export function buildContainedSlabCandidates(
  bounds: FloorPrintAnnotationBounds,
  width: number,
  height: number,
  margin = 5,
): FloorPrintAnnotationCandidate[] {
  if (width + margin * 2 > bounds.width || height + margin * 2 > bounds.height) return [];
  const center = {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
  };
  return [
    center,
    { x: bounds.x + margin, y: bounds.y + margin },
    { x: bounds.x + bounds.width - width - margin, y: bounds.y + margin },
    { x: bounds.x + margin, y: bounds.y + bounds.height - height - margin },
    { x: bounds.x + bounds.width - width - margin, y: bounds.y + bounds.height - height - margin },
  ];
}

/** Only used when even a tiny S identifier cannot fit inside a slab. */
export function buildExternalSlabCandidates(
  bounds: FloorPrintAnnotationBounds,
  width: number,
  height: number,
  gap = 7,
): FloorPrintAnnotationCandidate[] {
  const leaderTo = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  return [
    { x: bounds.x + bounds.width + gap, y: leaderTo.y - height / 2, external: true, leaderTo },
    { x: bounds.x - width - gap, y: leaderTo.y - height / 2, external: true, leaderTo },
    { x: leaderTo.x - width / 2, y: bounds.y - height - gap, external: true, leaderTo },
    { x: leaderTo.x - width / 2, y: bounds.y + bounds.height + gap, external: true, leaderTo },
  ];
}

export function buildMarkCandidates(
  center: { x: number; y: number },
  direction: "x" | "y",
  width: number,
  height: number,
): FloorPrintAnnotationCandidate[] {
  return MARK_OFFSETS.map((offset) => ({
    x: center.x - width / 2 + (direction === "x" ? offset : 0),
    y: center.y - height / 2 + (direction === "y" ? offset : 0),
  }));
}

export function buildAreaCalloutCandidates(
  bounds: FloorPrintAnnotationBounds,
  width: number,
  height: number,
  inset = 6,
): FloorPrintAnnotationCandidate[] {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return [
    { x: centerX - width / 2, y: centerY - height / 2 },
    { x: centerX - width / 2, y: bounds.y + inset },
    { x: centerX - width / 2, y: bounds.y + bounds.height - height - inset },
    { x: bounds.x + inset, y: centerY - height / 2 },
    { x: bounds.x + bounds.width - width - inset, y: centerY - height / 2 },
  ];
}

function fitsWithin(candidate: FloorPrintAnnotationCandidate, variant: FloorPrintAnnotationVariant, canvas: FloorPrintAnnotationBounds): boolean {
  return candidate.x >= canvas.x && candidate.y >= canvas.y &&
    candidate.x + variant.width <= canvas.x + canvas.width &&
    candidate.y + variant.height <= canvas.y + canvas.height;
}

function candidateBox(
  request: FloorPrintAnnotationRequest,
  variant: FloorPrintAnnotationVariant,
  candidate: FloorPrintAnnotationCandidate,
): FloorPrintAnnotationBox {
  return {
    id: request.id,
    kind: request.kind,
    priority: request.priority,
    variant: variant.id,
    x: candidate.x,
    y: candidate.y,
    width: variant.width,
    height: variant.height,
    external: candidate.external,
    leaderTo: candidate.leaderTo,
  };
}

function overlapScore(box: FloorPrintAnnotationBox, occupied: readonly FloorPrintAnnotationBox[], padding: number): number {
  return occupied.reduce((score, item) => score + (boxesOverlapWithPadding(box, item, padding) ? 1 : 0), 0);
}

/**
 * A deterministic O(n^2) layout for the small number of print annotations.
 * Requests are deliberately ordered by caller priority; ties preserve input order.
 */
export function buildFloorPrintAnnotationLayout(
  requests: readonly FloorPrintAnnotationRequest[],
  canvas: FloorPrintAnnotationBounds,
  padding = 5,
): FloorPrintAnnotationLayout {
  const boxes: FloorPrintAnnotationBox[] = [];
  const ordered = requests
    .map((request, index) => ({ request, index }))
    .sort((left, right) => left.request.priority - right.request.priority || left.index - right.index);

  ordered.forEach(({ request }) => {
    let fallback: FloorPrintAnnotationBox | null = null;
    let fallbackScore = Number.POSITIVE_INFINITY;
    for (const variant of request.variants) {
      for (const candidate of variant.candidates) {
        if (!fitsWithin(candidate, variant, canvas)) continue;
        const box = candidateBox(request, variant, candidate);
        const score = overlapScore(box, boxes, padding);
        if (score === 0) {
          boxes.push(box);
          return;
        }
        if (score < fallbackScore) {
          fallback = box;
          fallbackScore = score;
        }
      }
    }
    // Invalid/overlapping source geometry should not make an S/D/M/T identifier disappear.
    if (fallback) boxes.push(fallback);
  });

  const byKind = (kind: FloorPrintAnnotationKind) => boxes.filter((box) => box.kind === kind);
  return {
    boxes,
    slabLabels: byKind("slab-label"),
    markLabels: byKind("bar-mark"),
    jointCallouts: byKind("joint-callout"),
    throughCallouts: byKind("through-callout"),
  };
}
