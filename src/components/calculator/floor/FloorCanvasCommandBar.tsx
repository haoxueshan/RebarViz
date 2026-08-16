"use client";

export function FloorCanvasCommandBar({ tone, testId, children }: { tone: "dock" | "multi"; testId: string; children: React.ReactNode }) {
  return (
    <section className={`pointer-events-auto w-[min(94%,720px)] rounded-xl border p-3 shadow-lg backdrop-blur ${tone === "dock" ? "border-orange-300 bg-orange-50/95" : "border-violet-300 bg-violet-50/95"}`} data-testid={testId} aria-label={tone === "dock" ? "当前拼接命令" : "当前多选对齐命令"}>
      {children}
    </section>
  );
}
