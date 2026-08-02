import type { Metadata } from "next";
import { CalculatorResultsClient } from "./CalculatorResultsClient";

export const metadata: Metadata = {
  title: "楼板钢筋计算结果 | RebarViz",
  description: "查看楼板钢筋计算快照、重量、公式和分组明细。",
};

export default function CalculatorResultsPage() {
  return <CalculatorResultsClient />;
}
