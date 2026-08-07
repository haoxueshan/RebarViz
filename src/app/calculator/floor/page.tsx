import type { Metadata } from "next";
import FloorRebarCalculator from "./FloorRebarCalculator";

export const metadata: Metadata = {
  title: "整层钢筋平铺计算 | RebarViz",
  description: "拼接整层房间平面并自动识别内墙、外墙和共享墙。",
};

export default function FloorCalculatorPage() {
  return <FloorRebarCalculator />;
}
