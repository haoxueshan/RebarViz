import type { FloorPlanState } from "../floor-plan";

/**
 * Floor Topology V1.4A Golden Fixture：真实工程“孟”。
 *
 * 核心业务等式（禁止修改用户净尺寸）：
 *   B.width(3500) + innerWallThickness(240) + D.width(3530) = 7270 = K.width
 *
 * 关键拓扑关系：
 * - D.east=5354、C.west=5594：Gap=240 是真实墙带（不是错误、不是 Geometry Error）。
 * - 禁止把 K.width 改成 7030；禁止把 D-C 压成 0mm 共边。
 */
export const GOLDEN_MENG = {
  projectName: "孟",
  innerWallThickness: 240,
  outerWallThickness: 240,
  snapDistanceMm: 1500,
  overlapToleranceMm: 10,
  /** B 净宽 + 内墙 + D 净宽 = K 净宽。 */
  equation: {
    bWidth: 3500,
    dWidth: 3530,
    wall: 240,
    kWidth: 7270,
  },
  /** Golden Physical X（Solver 必须输出）。 */
  physicalX: {
    a: -5696,
    b: -1436,
    d: 2304,
    k: -1436,
    dEast: 5834,
    kEast: 5834,
    c: 6074,
    l: 6074,
  },
  /** Golden Physical Y（以 K 为 Y 轴 Anchor）。 */
  physicalY: {
    k: 6800,
    b: 13130,
    d: 13130,
    a: 13130,
    e: 10730,
    f: 6810,
    l: 7158,
    c: 11078,
  },
} as const;

export function goldenMengLegacyV2Plan(): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs: [
      { id: "meng-a", name: "板区A", type: "room", x: -5696, y: 12890, width: 4020, height: 3270 },
      { id: "meng-b", name: "板区B", type: "room", x: -1676, y: 12890, width: 3500, height: 3270 },
      { id: "meng-c", name: "板区C", type: "room", x: 5594, y: 10838, width: 4020, height: 5680 },
      { id: "meng-d", name: "板区D", type: "room", x: 1824, y: 12890, width: 3530, height: 3270 },
      { id: "meng-e", name: "板区E", type: "room", x: -5696, y: 10730, width: 4020, height: 2160 },
      { id: "meng-f", name: "板区F", type: "room", x: -5696, y: 7050, width: 4020, height: 3680 },
      { id: "meng-k", name: "板区K", type: "room", x: -1676, y: 6800, width: 7270, height: 6090 },
      { id: "meng-l", name: "板区L", type: "room", x: 5594, y: 7158, width: 4020, height: 3680 },
    ],
    openings: [],
    supportRules: [],
    innerWallThickness: GOLDEN_MENG.innerWallThickness,
    outerWallThickness: GOLDEN_MENG.outerWallThickness,
    snapDistanceMm: GOLDEN_MENG.snapDistanceMm,
    overlapToleranceMm: GOLDEN_MENG.overlapToleranceMm,
  };
}

/** Golden 需要识别的 12 组逻辑连接（Slab Pair Adjacency）。 */
export const GOLDEN_MENG_EXPECTED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["meng-a", "meng-b"],
  ["meng-b", "meng-d"],
  ["meng-a", "meng-e"],
  ["meng-e", "meng-f"],
  ["meng-e", "meng-k"],
  ["meng-f", "meng-k"],
  ["meng-b", "meng-k"],
  ["meng-d", "meng-k"],
  ["meng-k", "meng-c"],
  ["meng-k", "meng-l"],
  ["meng-c", "meng-l"],
  ["meng-d", "meng-c"],
];
