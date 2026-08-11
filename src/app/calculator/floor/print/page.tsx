import type { Metadata } from "next";
import { Suspense } from "react";
import FloorPrintClient from "./FloorPrintClient";

export const metadata: Metadata = {
  title: "整层楼板钢筋打印预览 | RebarViz",
  description: "读取冻结的整层地筋、普通面筋与通墙面筋结果快照，生成现场下料图表。",
};

export default function FloorPrintPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-4 py-12 text-sm text-slate-500">正在读取整层打印快照…</main>}>
      <FloorPrintClient />
    </Suspense>
  );
}
