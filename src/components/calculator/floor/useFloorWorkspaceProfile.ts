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
  /** 横屏：宽度 > 高度（Landscape，如 1366×768 Touch）。 */
  landscape: boolean;
  /** 高度不足（<820px）：需要压缩 Canvas 高度策略，不能用 600px 最小高度。 */
  shortViewport: boolean;
};

const FALLBACK_PROFILE: FloorWorkspaceProfile = {
  input: "desktop",
  viewport: "desktop",
  landscape: true,
  shortViewport: false,
};

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
      setProfile({
        input,
        viewport: viewportForWidth(window.innerWidth),
        landscape: window.innerWidth > window.innerHeight,
        shortViewport: window.innerHeight < 820,
      });
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
