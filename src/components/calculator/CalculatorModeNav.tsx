"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator, LayoutDashboard } from "lucide-react";

const modes = [
  {
    href: "/calculator",
    label: "快速计算",
    description: "单板 / 简单直线多房间",
    icon: Calculator,
  },
  {
    href: "/calculator/floor",
    label: "整层平铺计算",
    description: "整层拼图与完整料单（分阶段建设）",
    icon: LayoutDashboard,
  },
] as const;

export function CalculatorModeNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="楼板钢筋计算模式" className="mb-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2">
      {modes.map(({ href, label, description, icon: Icon }) => {
        const active = href === "/calculator"
          ? pathname === href || pathname === "/calculator/results"
          : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 transition ${active ? "border-blue-600 bg-blue-50 text-blue-950" : "border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-slate-50"}`}
          >
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}><Icon size={20} /></span>
            <span className="min-w-0"><strong className="block text-sm">{label}</strong><span className="mt-0.5 block text-xs text-slate-500">{description}</span></span>
          </Link>
        );
      })}
    </nav>
  );
}
