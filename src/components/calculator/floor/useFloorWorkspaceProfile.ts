"use client";

import { useEffect, useState } from "react";

/**
 * Floor Workspace UI V3 响应式策略（PRD 6-8）：
 * 输入模式（Touch/Desktop）由 pointer/hover 能力决定，不再由 CSS 宽度决定。
 * 宽度仍参与 viewport 分档，但 input === "touch" 优先覆盖纯 width 的桌面行为。
 */
export type FloorWorkspaceInputProfile = "touch" | "desktop";
export type FloorWorkspaceViewportProfile = "phone" | "tablet" | "desktop" | "wide";

export type FloorWorkspaceProfile = {
  input: FloorWorkspaceInputProfile;
  viewport: FloorWorkspaceViewportProfile;
};

const FALLBACK_PROFILE: FloorWorkspaceProfile = { input: "desktop", viewport: "desktop" };

function viewportForWidth(width: number): FloorWorkspaceViewportProfile {
  if (width < 768) return "phone";
  if (width < 1280) return "tablet";
  if (width < 1600) return "desktop";
  return "wide";
}

export function useFloorWorkspaceProfile(): FloorWorkspaceProfile {
  const [profile, setProfile] = useState<FloorWorkspaceProfile>(FALLBACK_PROFILE);

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const noHover = window.matchMedia("(hover: none)");
    const apply = () => {
      const input: FloorWorkspaceInputProfile = coarse.matches || noHover.matches ? "touch" : "desktop";
      setProfile({ input, viewport: viewportForWidth(window.innerWidth) });
    };
    apply();
    coarse.addEventListener?.("change", apply);
    noHover.addEventListener?.("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      coarse.removeEventListener?.("change", apply);
      noHover.removeEventListener?.("change", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  return profile;
}
