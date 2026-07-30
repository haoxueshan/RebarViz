import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '计算器 | RebarViz',
  description: '楼板钢筋根数、长度与重量离线计算器。',
};

export default function CalculatorPage() {
  return (
    <main className="h-[calc(100dvh-3.5rem)] min-h-[560px] bg-slate-100">
      <iframe
        src="/rebar-offline-calculator.html"
        title="楼板钢筋离线计算器"
        className="h-full w-full border-0"
      />
    </main>
  );
}
