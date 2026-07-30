import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Calculator,
  Cuboid,
  Ruler,
} from 'lucide-react';

const calculatorRows = [
  ['板跨 X', '4200 mm'],
  ['板跨 Y', '3600 mm'],
  ['保护层', '15 mm'],
];

export function HomePortal() {
  return (
    <main className="relative min-h-[calc(100dvh-3.5rem)] overflow-hidden bg-[#070b12] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="pointer-events-none absolute -left-32 -top-40 h-[34rem] w-[34rem] rounded-full bg-blue-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-48 right-0 h-[32rem] w-[32rem] rounded-full bg-cyan-500/10 blur-[130px]" />

      <section className="relative mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-[1500px] flex-col justify-center px-5 py-12 sm:px-8 lg:px-12 lg:py-16">
        <div className="mb-9 max-w-3xl sm:mb-12">
          <p className="mb-4 text-sm font-semibold tracking-[0.24em] text-blue-300">
            REBARVIZ · 钢筋工程工具箱
          </p>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
            选择你要使用的功能
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
            快速完成楼板钢筋计算，或进入三维平法识图学习。两套工具相互独立，随时可以返回首页切换。
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2 lg:gap-7">
          <Link
            href="/calculator"
            className="group relative min-h-[390px] overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl transition duration-300 hover:-translate-y-1 hover:border-blue-300/35 hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 sm:p-8"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/15 via-transparent to-cyan-400/5 opacity-70 transition-opacity group-hover:opacity-100" />
            <div className="relative flex h-full flex-col">
              <div className="flex items-start justify-between gap-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500 text-white shadow-[0_14px_35px_rgba(59,130,246,0.35)]">
                  <Calculator className="h-7 w-7" />
                </div>
                <span className="flex items-center gap-2 text-sm font-semibold text-blue-200">
                  进入计算器
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>

              <div className="mt-8">
                <p className="text-sm font-medium text-blue-300">楼板钢筋离线工具</p>
                <h2 className="mt-2 text-4xl font-black tracking-tight">计算器</h2>
                <p className="mt-3 max-w-lg leading-7 text-slate-400">
                  输入板跨、保护层、钢筋直径和间距，自动计算根数、长度与重量。
                </p>
              </div>

              <div className="mt-7 grid gap-2.5 rounded-2xl border border-white/10 bg-slate-950/50 p-4 backdrop-blur">
                {calculatorRows.map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-xl bg-white/[0.055] px-4 py-2.5">
                    <span className="text-sm text-slate-400">{label}</span>
                    <span className="font-mono text-sm font-semibold text-slate-100">{value}</span>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between border-t border-white/10 px-4 pt-3">
                  <span className="text-sm text-slate-400">全部钢筋合计</span>
                  <span className="text-lg font-bold text-cyan-300">自动计算</span>
                </div>
              </div>
            </div>
          </Link>

          <Link
            href="/learning"
            className="group relative min-h-[390px] overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl transition duration-300 hover:-translate-y-1 hover:border-cyan-300/30 hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:p-8"
          >
            <Image
              src="/landing-rebar-hero.webp"
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover object-center opacity-35 transition duration-500 group-hover:scale-[1.03] group-hover:opacity-45"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-[#0b1220]/95 via-[#0b1220]/78 to-blue-950/55" />

            <div className="relative flex h-full flex-col">
              <div className="flex items-start justify-between gap-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 text-white shadow-[0_14px_35px_rgba(34,211,238,0.24)]">
                  <BookOpen className="h-7 w-7" />
                </div>
                <span className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
                  进入学习
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>

              <div className="mt-8">
                <p className="text-sm font-medium text-cyan-300">22G101 · 三维可视化</p>
                <h2 className="mt-2 text-4xl font-black tracking-tight">平法识图学习</h2>
                <p className="mt-3 max-w-lg leading-7 text-slate-300">
                  通过可旋转、可剖切的三维配筋模型，理解梁、柱、板、墙及基础构造。
                </p>
              </div>

              <div className="mt-auto grid grid-cols-3 gap-3 pt-8">
                {[
                  { icon: Cuboid, label: '3D 构件' },
                  { icon: Ruler, label: '构造标注' },
                  { icon: BrainCircuit, label: 'AI 助手' },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-4 text-center backdrop-blur">
                    <Icon className="mx-auto h-5 w-5 text-cyan-300" />
                    <p className="mt-2 text-xs font-medium text-slate-300 sm:text-sm">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </Link>
        </div>
      </section>
    </main>
  );
}
