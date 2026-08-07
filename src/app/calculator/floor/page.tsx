import type { Metadata } from "next";
import FloorRebarCalculator from "./FloorRebarCalculator";

export const metadata: Metadata = {
  title: "整层楼板几何拓扑 | RebarViz",
  description: "建立整层有板区域、洞口、原子边界与支承关系。",
};

export default function FloorCalculatorPage() {
  return <FloorRebarCalculator />;
}
