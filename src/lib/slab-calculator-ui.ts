import {
  shouldApplyTopExtra,
  type BarDirection,
  type SlabCalculatorState,
} from "./slab-calculator";
import {
  DEFAULT_SLAB_PRINT_SECTIONS,
  SITE_SLAB_PRINT_SECTIONS,
  type SlabPrintOptions,
  type SlabPrintSections,
} from "./slab-calculator-storage";

export type PaginationItem = number | "start-ellipsis" | "end-ellipsis";
export type SlabPrintPreset = "site" | "full" | "custom";

export function getTopDirectionStatusLabel(
  direction: BarDirection,
  state: SlabCalculatorState,
): string {
  if (!state.through.enabled || state.through.direction === "none") {
    return direction === "x" ? "X向（西→东）" : "Y向（南→北）";
  }
  const base = direction === "x" ? "X向" : "Y向";
  return `${base} · ${state.through.direction === direction ? "通墙规格" : "按房间"}`;
}

export function getCalculationModeSummary(state: SlabCalculatorState) {
  const arrangement =
    state.slab.arrangement === "single"
      ? "单房间"
      : `${state.slab.rooms.length}间 · ${state.slab.arrangement === "x" ? "东西向" : "南北向"}排列`;
  const throughDirection =
    state.through.enabled && state.through.direction !== "none"
      ? state.through.direction
      : null;
  return {
    arrangement,
    bottomX: "按房间",
    bottomY: "按房间",
    topX: throughDirection === "x" ? "通墙" : "按房间",
    topY: throughDirection === "y" ? "通墙" : "按房间",
  };
}

export function getThroughExtraStatusText(state: SlabCalculatorState): string {
  if (!state.through.enabled || state.through.direction === "none") return "";
  const direction = state.through.direction;
  const startLabel = direction === "x" ? "最西端" : "最南端";
  const endLabel = direction === "x" ? "最东端" : "最北端";
  const endpoints = [
    {
      label: startLabel,
      rule: state.through.startAnchor,
      selected: shouldApplyTopExtra(state.through.extraMode, "start"),
    },
    {
      label: endLabel,
      rule: state.through.endAnchor,
      selected: shouldApplyTopExtra(state.through.extraMode, "end"),
    },
  ];
  const applied = endpoints.filter(
    (endpoint) => endpoint.selected && endpoint.rule.source === "inner-wall",
  );
  const manual = endpoints.filter((endpoint) => endpoint.rule.source === "manual");
  if (applied.length === 2) return "当前通墙两端均满足内墙增加条件。";
  if (applied.length === 1) return `当前仅${applied[0].label}满足内墙增加条件。`;
  if (manual.length === 2) return "当前通墙两端均为手动锚固；手动值为最终值，不叠加增加值。";
  if (manual.length === 1) {
    return `${manual[0].label}为手动锚固，手动值为最终值；其余端点当前也不会实际增加。`;
  }
  if (endpoints.every((endpoint) => endpoint.rule.source === "outer-wall")) {
    return "当前通墙两端均为外墙，内墙面筋增加值不会实际生效。";
  }
  return "当前所选增加位置没有内墙锚固端，面筋增加值不会实际生效。";
}

export function getPaginationItems(
  currentPage: number,
  pageCount: number,
): PaginationItem[] {
  if (pageCount <= 7) {
    return Array.from({ length: Math.max(pageCount, 0) }, (_, index) => index + 1);
  }
  const current = Math.min(Math.max(Math.trunc(currentPage) || 1, 1), pageCount);
  const pages = new Set([1, pageCount, current - 2, current - 1, current, current + 1, current + 2]);
  const sorted = [...pages]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);
  const items: PaginationItem[] = [];
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous && page - previous > 1) {
      items.push(previous === 1 ? "start-ellipsis" : "end-ellipsis");
    }
    items.push(page);
  });
  return items;
}

function sameSections(left: SlabPrintSections, right: SlabPrintSections): boolean {
  return (Object.keys(left) as Array<keyof SlabPrintSections>).every(
    (key) => left[key] === right[key],
  );
}

export function detectPrintPreset(options: SlabPrintOptions): SlabPrintPreset {
  if (
    options.detailMode === "compact" &&
    sameSections(options.sections, SITE_SLAB_PRINT_SECTIONS)
  ) {
    return "site";
  }
  if (
    options.detailMode === "full" &&
    sameSections(options.sections, DEFAULT_SLAB_PRINT_SECTIONS)
  ) {
    return "full";
  }
  return "custom";
}

export function applyPrintPreset(
  options: SlabPrintOptions,
  preset: Exclude<SlabPrintPreset, "custom">,
): SlabPrintOptions {
  return {
    ...options,
    detailMode: preset === "site" ? "compact" : "full",
    sections: {
      ...(preset === "site"
        ? SITE_SLAB_PRINT_SECTIONS
        : DEFAULT_SLAB_PRINT_SECTIONS),
    },
  };
}
