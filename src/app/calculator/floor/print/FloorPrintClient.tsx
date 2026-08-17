"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FloorPrintReport } from "@/components/calculator/floor/FloorPrintReport";
import type { FloorPrintSnapshot } from "@/lib/floor-print";
import { loadFloorPrintSnapshotAnywhere } from "@/lib/floor-print-snapshot-db";

export default function FloorPrintClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const snapshotId = searchParams.get("id") ?? "";
  const [snapshot, setSnapshot] = useState<FloorPrintSnapshot | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadFloorPrintSnapshotAnywhere(snapshotId)
      .then((loaded) => { if (!cancelled) setSnapshot(loaded); })
      .catch(() => { if (!cancelled) setSnapshot(null); });
    return () => { cancelled = true; };
  }, [snapshotId]);

  if (snapshot === undefined) {
    return <main className="mx-auto max-w-5xl px-4 py-12 text-sm text-slate-500">正在读取整层打印快照…</main>;
  }

  if (!snapshot) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <section className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">打印快照不存在或已损坏</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">打印页不会从当前楼层草稿重新计算。请返回整层计算器，在“料单”阶段重新生成冻结快照。</p>
          <button type="button" onClick={() => router.push("/calculator/floor")} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white"><ArrowLeft size={17} />返回整层计算器</button>
        </section>
      </main>
    );
  }

  // 打印预览已完整渲染后，用户点击直接调用 window.print()（iPad/Safari 不再依赖双 RAF 延迟）。
  const print = () => {
    window.print();
  };

  return (
    <main className="min-h-screen bg-slate-100 pb-10 print:bg-white print:pb-0" data-testid="floor-print-preview">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3">
          <button type="button" onClick={() => router.push("/calculator/floor")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"><ArrowLeft size={17} />返回料单</button>
          <div className="hidden text-center sm:block"><strong className="block text-sm text-slate-900">整层楼板钢筋打印预览</strong><span className="text-xs text-slate-500">快照 {snapshot.id}</span></div>
          <button type="button" onClick={print} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white" data-testid="floor-print-button"><Printer size={17} />打印</button>
        </div>
      </div>
      <div className="mx-auto mt-5 max-w-[1500px] bg-white shadow-xl print:mt-0 print:max-w-none print:shadow-none">
        <FloorPrintReport snapshot={snapshot} />
      </div>
    </main>
  );
}
