import type { FloorPlanState } from "./floor-plan";
import {
  buildFloorRebarPathContextV3,
  type FloorRebarPathContextV3,
} from "./floor-rebar-path";
import {
  solveFloorTopology,
  type FloorTopologySolution,
} from "./floor-topology-solver";

export type FloorRebarCalculationContextV3 = {
  plan: FloorPlanState;
  solution: FloorTopologySolution;
  pathContext: FloorRebarPathContextV3;
};

/** Bind every V3 calculator view to the same plan and single topology solve. */
export function buildFloorRebarCalculationContextV3(
  plan: FloorPlanState,
): FloorRebarCalculationContextV3 {
  const solution = solveFloorTopology(plan);
  return {
    plan,
    solution,
    pathContext: buildFloorRebarPathContextV3(plan, solution),
  };
}
