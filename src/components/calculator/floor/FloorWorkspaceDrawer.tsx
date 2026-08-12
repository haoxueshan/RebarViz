"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

export function FloorWorkspaceDrawer({
  open,
  title,
  side = "bottom",
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  side?: "left" | "bottom";
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={title} data-testid={`floor-workspace-${side}-drawer`}><button type="button" aria-label="关闭抽屉" onClick={onClose} className="absolute inset-0 bg-slate-950/40" /><section className={`absolute bg-white shadow-2xl ${side === "left" ? "inset-y-0 left-0 w-[min(85vw,360px)]" : "inset-x-0 bottom-0 max-h-[82dvh] rounded-t-3xl"}`}><div className="flex min-h-14 items-center justify-between border-b border-slate-200 px-4"><h2 className="font-bold text-slate-950">{title}</h2><button type="button" aria-label="关闭" onClick={onClose} className="flex size-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"><X size={20} /></button></div><div className={`${side === "left" ? "h-[calc(100dvh-3.5rem)]" : "max-h-[calc(82dvh-3.5rem)]"} overflow-y-auto pb-[max(16px,env(safe-area-inset-bottom))]`}>{children}</div></section></div>;
}
