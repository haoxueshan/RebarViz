'use client';

import { useRef, useEffect, useState, useCallback, type RefObject } from 'react';
import { Download } from 'lucide-react';
import type { BeamParams, ColumnParams, SlabParams, ShearWallParams, StairParams } from '@/lib/types';
import { parseRebar, parseStirrup, parseSlabRebar, parseSideBar } from '@/lib/rebar';
import {
  setupHiDPI, drawConcreteSection, drawRebarDot, drawRebarCross,
  drawStirrup, drawInnerTies, drawDimLine, drawCoverDim, drawLabel,
} from '@/lib/cs-draw';

// ─── 响应式 canvas 容器 hook ─────────────────────────────────────
function useContainerWidth(containerRef: RefObject<HTMLDivElement | null>, fallback: number) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width;
        if (w > 0) setWidth(Math.floor(w));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);
  return width;
}

// ─── 导出按钮 ────────────────────────────────────────────────────
function ExportButton({ canvasRef, filename = 'cross-section.png' }: { canvasRef: RefObject<HTMLCanvasElement | null>; filename?: string }) {
  const handleExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }, [canvasRef, filename]);

  return (
    <button
      onClick={handleExport}
      className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/80 hover:bg-white border border-gray-200 shadow-sm transition-colors cursor-pointer z-10"
      title="下载截面图"
    >
      <Download className="w-3.5 h-3.5 text-gray-500" />
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BEAM
// ═══════════════════════════════════════════════════════════════════
export function BeamCrossSection({ params, cutPosition }: { params: BeamParams; cutPosition?: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerW = useContainerWidth(containerRef, 420);
  const LW = Math.min(Math.max(containerW, 320), 560);
  const LH = Math.round(LW * 0.7);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPI(canvas, LW, LH);
    if (!ctx) return;

    const cx = LW * 0.42, cy = LH / 2;
    const maxDim = Math.max(params.b, params.h);
    const scale = (LH * 0.58) / maxDim;
    const dw = params.b * scale, dh = params.h * scale;
    const coverMm = params.cover || 25;
    const cover = coverMm * scale;

    // Zone detection
    const cutX = cutPosition ?? 0;
    const beamLenM = (params.spanLength || 4000) / 1000;
    const halfLen = beamLenM / 2;
    const distFromLeft = cutX + halfLen;
    const distFromRight = beamLenM - distFromLeft;
    const supportRebarZone = beamLenM / 3;
    const inLeftSupport = distFromLeft <= supportRebarZone;
    const inRightSupport = distFromRight <= supportRebarZone;
    const denseZoneM = Math.max(2 * params.h, 500) / 1000;
    const inDenseZone = distFromLeft <= denseZoneM || distFromRight <= denseZoneM;
    const hasCut = cutPosition !== null && cutPosition !== undefined;

    // Parse
    const topR = parseRebar(params.top);
    const botR = parseRebar(params.bottom);
    const stir = parseStirrup(params.stirrup);
    const leftR = params.leftSupport ? parseRebar(params.leftSupport) : null;
    const rightR = params.rightSupport ? parseRebar(params.rightSupport) : null;
    const leftR2 = params.leftSupport2 ? parseRebar(params.leftSupport2) : null;
    const rightR2 = params.rightSupport2 ? parseRebar(params.rightSupport2) : null;
    const sideInfo = params.sideBar ? parseSideBar(params.sideBar) : null;

    const innerW = dw - 2 * cover;
    const sectionLeft = cx - dw / 2;
    const sectionTop = cy - dh / 2;
    const sectionRight = cx + dw / 2;
    const sectionBottom = cy + dh / 2;

    // ── Concrete ──
    drawConcreteSection(ctx, cx, cy, dw, dh);

    // ── Stirrup with hooks ──
    const stirX = sectionLeft + cover / 2;
    const stirY = sectionTop + cover / 2;
    const stirW = dw - cover;
    const stirH = dh - cover;
    drawStirrup(ctx, stirX, stirY, stirW, stirH, '#27AE60', 8);

    // ── Top rebars (through bars) ──
    const topY = sectionTop + cover;
    const topSpacing = innerW / Math.max(topR.count - 1, 1);
    for (let i = 0; i < topR.count; i++) {
      const x = sectionLeft + cover + i * topSpacing;
      drawRebarDot(ctx, x, topY, Math.max(topR.diameter * scale / 2, 4), '#C0392B');
    }

    // ── Support rebars (1st row) ──
    const showLeftSupport = hasCut ? inLeftSupport : !!leftR;
    const showRightSupport = hasCut ? inRightSupport : !!rightR;
    const supportR = showLeftSupport ? leftR : showRightSupport ? rightR : null;

    if (supportR && (showLeftSupport || showRightSupport)) {
      const supportY = topY + topR.diameter * scale * 1.2;
      const supportSpacing = innerW / Math.max(supportR.count - 1, 1);
      for (let i = 0; i < supportR.count; i++) {
        const x = sectionLeft + cover + i * supportSpacing;
        drawRebarDot(ctx, x, supportY, Math.max(supportR.diameter * scale / 2, 4), '#8E44AD');
      }

      // Label
      const supportLabel = showLeftSupport ? `左支座: ${params.leftSupport}` : `右支座: ${params.rightSupport}`;
      drawLabel(ctx, supportLabel, sectionRight + 8, supportY + 4, '#8E44AD', LW);
    }

    // ── Support rebars (2nd row) ──
    const support2R = showLeftSupport ? leftR2 : showRightSupport ? rightR2 : null;
    if (support2R && supportR) {
      const row2Y = topY + topR.diameter * scale * 1.2 + supportR.diameter * scale * 1.2;
      const row2Spacing = innerW / Math.max(support2R.count - 1, 1);
      for (let i = 0; i < support2R.count; i++) {
        const x = sectionLeft + cover + i * row2Spacing;
        drawRebarDot(ctx, x, row2Y, Math.max(support2R.diameter * scale / 2, 3.5), '#A569BD');
      }
      const row2Label = showLeftSupport ? `左支座②: ${params.leftSupport2}` : `右支座②: ${params.rightSupport2}`;
      drawLabel(ctx, row2Label, sectionRight + 8, row2Y + 4, '#A569BD', LW);
    }

    // ── Bottom rebars ──
    const botY = sectionBottom - cover;
    const botSpacing = innerW / Math.max(botR.count - 1, 1);
    for (let i = 0; i < botR.count; i++) {
      const x = sectionLeft + cover + i * botSpacing;
      drawRebarDot(ctx, x, botY, Math.max(botR.diameter * scale / 2, 4), '#C0392B');
    }

    // ── Side bars (腰筋/抗扭筋) ──
    if (sideInfo) {
      const perSide = Math.ceil(sideInfo.count / 2);
      const sideR = Math.max(sideInfo.diameter * scale / 2, 3);
      const sideYTop = topY + topR.diameter * scale * 0.8 + sideR;
      const sideYBot = botY - botR.diameter * scale * 0.8 - sideR;
      for (let i = 0; i < perSide; i++) {
        const y = sideYTop + (sideYBot - sideYTop) * (i + 1) / (perSide + 1);
        drawRebarDot(ctx, sectionLeft + cover, y, sideR, '#2980B9');
        drawRebarDot(ctx, sectionRight - cover, y, sideR, '#2980B9');
      }

      // Tie bars (拉筋)
      ctx.strokeStyle = '#1ABC9C';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      for (let i = 0; i < perSide; i++) {
        const y = sideYTop + (sideYBot - sideYTop) * (i + 1) / (perSide + 1);
        ctx.beginPath();
        ctx.moveTo(sectionLeft + cover, y);
        ctx.lineTo(sectionRight - cover, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ── Cover dimension ──
    drawCoverDim(ctx, sectionLeft, sectionBottom, cover, coverMm);

    // ── Dimension lines ──
    drawDimLine(ctx, sectionLeft, sectionBottom, sectionRight, sectionBottom, `${params.b}`, 'bottom', 16);
    drawDimLine(ctx, sectionLeft, sectionTop, sectionLeft, sectionBottom, `${params.h}`, 'left', 18);

    // ── Labels ──
    const labelX = sectionRight + 8;
    drawLabel(ctx, `上: ${params.top}`, labelX, topY + 4, '#C0392B', LW);
    drawLabel(ctx, `下: ${params.bottom}`, labelX, botY + 4, '#C0392B', LW);

    const stirLabel = hasCut
      ? `箍: Φ${stir.diameter}@${inDenseZone ? stir.spacingDense : stir.spacingNormal} (${inDenseZone ? '加密区' : '非加密区'})`
      : `箍: ${params.stirrup}`;
    drawLabel(ctx, stirLabel, labelX, cy + 4, '#27AE60', LW);

    if (sideInfo) {
      const prefixLabel = sideInfo.prefix === 'G' ? '腰' : '抗扭';
      drawLabel(ctx, `${prefixLabel}: ${params.sideBar}`, labelX, cy + 18, '#2980B9', LW);
      drawLabel(ctx, `拉: ${params.tieBar || 'A6(自动)'}`, labelX, cy + 32, '#1ABC9C', LW);
    }

    // ── Cut position ──
    if (hasCut) {
      ctx.fillStyle = '#3B82F6';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`剖切位置: ${distFromLeft.toFixed(1)}m`, cx, sectionTop - 14);
    }
  }, [params, cutPosition, LW, LH]);

  return (
    <div ref={containerRef} className="relative w-full">
      <ExportButton canvasRef={canvasRef} filename="beam-section.png" />
      <canvas ref={canvasRef} className="max-w-full" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// COLUMN
// ═══════════════════════════════════════════════════════════════════
export function ColumnCrossSection({ params, cutPosition }: { params: ColumnParams; cutPosition?: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerW = useContainerWidth(containerRef, 420);
  const LW = Math.min(Math.max(containerW, 320), 560);
  const LH = Math.round(LW * 0.7);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPI(canvas, LW, LH);
    if (!ctx) return;

    const cx = LW * 0.42, cy = LH / 2;
    const maxDim = Math.max(params.b, params.h);
    const scale = (LH * 0.58) / maxDim;
    const dw = params.b * scale, dh = params.h * scale;
    const coverMm = params.cover || 25;
    const cover = coverMm * scale;

    const cutY = cutPosition ?? 1.5;
    const hasCut = cutPosition !== null && cutPosition !== undefined;
    const colH = (params.height || 3000) * 0.001;
    const inDenseZone = cutY <= 0.5 || cutY >= (colH - 0.5);

    const mainR = parseRebar(params.main);
    const stir = parseStirrup(params.stirrup);
    const innerW = dw - 2 * cover;
    const innerH = dh - 2 * cover;
    const perSide = Math.max(Math.round(mainR.count / 4), 2);

    const sectionLeft = cx - dw / 2;
    const sectionTop = cy - dh / 2;
    const sectionRight = cx + dw / 2;
    const sectionBottom = cy + dh / 2;

    // ── Concrete ──
    drawConcreteSection(ctx, cx, cy, dw, dh);

    // ── Stirrup with hooks ──
    const stirX = sectionLeft + cover / 2;
    const stirY = sectionTop + cover / 2;
    const stirW = dw - cover;
    const stirH = dh - cover;
    drawStirrup(ctx, stirX, stirY, stirW, stirH, '#27AE60', 8);

    // ── Inner ties (composite stirrup) ──
    drawInnerTies(ctx, stir.legs, stirX, stirY, stirW, stirH, '#27AE60', 6);

    // ── Main rebars ──
    const pts: { x: number; y: number; isCorner: boolean }[] = [];
    // Top side
    for (let i = 0; i < perSide; i++) pts.push({
      x: -innerW / 2 + (innerW * i) / (perSide - 1),
      y: -innerH / 2,
      isCorner: i === 0 || i === perSide - 1,
    });
    // Right side
    for (let i = 1; i < perSide; i++) pts.push({
      x: innerW / 2,
      y: -innerH / 2 + (innerH * i) / (perSide - 1),
      isCorner: i === perSide - 1,
    });
    // Bottom side
    for (let i = 1; i < perSide; i++) pts.push({
      x: innerW / 2 - (innerW * i) / (perSide - 1),
      y: innerH / 2,
      isCorner: i === perSide - 1,
    });
    // Left side
    for (let i = 1; i < perSide - 1; i++) pts.push({
      x: -innerW / 2,
      y: innerH / 2 - (innerH * i) / (perSide - 1),
      isCorner: false,
    });

    const baseR = Math.max(mainR.diameter * scale / 2, 4);
    pts.slice(0, mainR.count).forEach(p => {
      const r = p.isCorner ? baseR * 1.15 : baseR;
      drawRebarDot(ctx, cx + p.x, cy + p.y, r, '#C0392B');
    });

    // ── Cover dimension ──
    drawCoverDim(ctx, sectionLeft, sectionBottom, cover, coverMm);

    // ── Dimension lines ──
    drawDimLine(ctx, sectionLeft, sectionBottom, sectionRight, sectionBottom, `${params.b}`, 'bottom', 16);
    drawDimLine(ctx, sectionLeft, sectionTop, sectionLeft, sectionBottom, `${params.h}`, 'left', 18);

    // ── Labels ──
    const labelX = sectionRight + 8;
    drawLabel(ctx, `纵筋: ${params.main}`, labelX, cy - 6, '#C0392B', LW);

    const stirLabel = hasCut
      ? `箍: Φ${stir.diameter}@${inDenseZone ? stir.spacingDense : stir.spacingNormal} (${inDenseZone ? '加密区' : '非加密区'})`
      : `箍筋: ${params.stirrup}`;
    drawLabel(ctx, stirLabel, labelX, cy + 12, '#27AE60', LW);

    if (stir.legs > 2) {
      drawLabel(ctx, `${stir.legs}肢箍`, labelX, cy + 28, '#27AE60', LW);
    }

    if (hasCut) {
      ctx.fillStyle = '#3B82F6';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`剖切高度: ${(cutY * 1000).toFixed(0)}mm`, cx, sectionTop - 14);
    }
  }, [params, cutPosition, LW, LH]);

  return (
    <div ref={containerRef} className="relative w-full">
      <ExportButton canvasRef={canvasRef} filename="column-section.png" />
      <canvas ref={canvasRef} className="max-w-full" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SLAB
// ═══════════════════════════════════════════════════════════════════
export function SlabCrossSection({ params }: { params: SlabParams }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerW = useContainerWidth(containerRef, 440);
  const LW = Math.min(Math.max(containerW, 320), 580);
  const LH = Math.round(LW * 0.52);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPI(canvas, LW, LH);
    if (!ctx) return;

    const cx = LW * 0.42, cy = LH / 2;
    const stripW = 600;
    const scale = (LW * 0.5) / stripW;
    const dw = stripW * scale;
    const dh = params.thickness * scale;
    const coverMm = params.cover || 15;
    const cover = coverMm * scale;

    const sectionLeft = cx - dw / 2;
    const sectionTop = cy - dh / 2;
    const sectionRight = cx + dw / 2;
    const sectionBottom = cy + dh / 2;

    // ── Concrete ──
    drawConcreteSection(ctx, cx, cy, dw, dh);

    // ── Parse ──
    const bx = parseSlabRebar(params.bottomX);
    const by = parseSlabRebar(params.bottomY);
    const tx = params.topX ? parseSlabRebar(params.topX) : null;
    const ty = params.topY ? parseSlabRebar(params.topY) : null;
    const dist = params.distribution ? parseSlabRebar(params.distribution) : null;

    // ── Bottom X bars (dots) ──
    const bxSpacing = bx.spacing * scale;
    const bxY = sectionBottom - cover;
    for (let x = sectionLeft + cover; x <= sectionRight - cover; x += bxSpacing) {
      drawRebarDot(ctx, x, bxY, Math.max(bx.diameter * scale / 2, 3), '#C0392B');
    }

    // ── Bottom Y bars (crosses — perpendicular direction) ──
    const bySpacing = by.spacing * scale;
    const byY = bxY - bx.diameter * scale;
    for (let x = sectionLeft + cover; x <= sectionRight - cover; x += bySpacing) {
      drawRebarCross(ctx, x, byY, Math.max(by.diameter * scale / 2, 3), '#E67E22');
    }

    // ── Top X bars ──
    if (tx) {
      const txSpacing = tx.spacing * scale;
      const txY = sectionTop + cover;
      for (let x = sectionLeft + cover; x <= sectionRight - cover; x += txSpacing) {
        drawRebarDot(ctx, x, txY, Math.max(tx.diameter * scale / 2, 3), '#8E44AD');
      }
    }

    // ── Top Y bars ──
    if (ty) {
      const tySpacing = ty.spacing * scale;
      const tyY = sectionTop + cover + (tx ? tx.diameter * scale : 0);
      for (let x = sectionLeft + cover; x <= sectionRight - cover; x += tySpacing) {
        drawRebarCross(ctx, x, tyY, Math.max(ty.diameter * scale / 2, 3), '#7D3C98');
      }
    }

    // ── Distribution bars ──
    if (dist) {
      const distSpacing = dist.spacing * scale;
      const distY = tx ? sectionTop + cover + (tx.diameter || 10) * scale * 1.5 : byY - by.diameter * scale;
      ctx.strokeStyle = '#7F8C8D';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 3]);
      for (let x = sectionLeft + cover; x <= sectionRight - cover; x += distSpacing) {
        const r = Math.max(dist.diameter * scale / 2, 2);
        ctx.beginPath();
        ctx.arc(x, distY, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ── Cover dimension ──
    drawCoverDim(ctx, sectionLeft, sectionBottom, cover, coverMm);

    // ── Dimension: thickness ──
    drawDimLine(ctx, sectionRight, sectionTop, sectionRight, sectionBottom, `${params.thickness}`, 'right', 14);

    // ── Direction arrows ──
    ctx.fillStyle = '#94A3B8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const arrowY = sectionBottom + 30;
    ctx.beginPath();
    ctx.moveTo(cx - 30, arrowY); ctx.lineTo(cx + 30, arrowY);
    ctx.moveTo(cx + 30, arrowY); ctx.lineTo(cx + 24, arrowY - 3);
    ctx.moveTo(cx + 30, arrowY); ctx.lineTo(cx + 24, arrowY + 3);
    ctx.strokeStyle = '#94A3B8'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillText('X', cx + 36, arrowY + 3);

    // ── Labels ──
    const labelX = sectionRight + 28;
    drawLabel(ctx, `X底: ${params.bottomX}`, labelX, bxY + 3, '#C0392B', LW);
    drawLabel(ctx, `Y底: ${params.bottomY}`, labelX, byY + 3, '#E67E22', LW);
    if (tx) drawLabel(ctx, `X面: ${params.topX}`, labelX, sectionTop + cover + 3, '#8E44AD', LW);
    if (ty) drawLabel(ctx, `Y面: ${params.topY}`, labelX, sectionTop + cover + (tx ? tx.diameter * scale : 0) + 3, '#7D3C98', LW);
    if (dist) drawLabel(ctx, `分布: ${params.distribution}`, labelX, cy + 3, '#7F8C8D', LW);
  }, [params, LW, LH]);

  return (
    <div ref={containerRef} className="relative w-full">
      <ExportButton canvasRef={canvasRef} filename="slab-section.png" />
      <canvas ref={canvasRef} className="max-w-full" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SHEAR WALL
// ═══════════════════════════════════════════════════════════════════
export function ShearWallCrossSection({ params }: { params: ShearWallParams }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerW = useContainerWidth(containerRef, 520);
  const LW = Math.min(Math.max(containerW, 360), 620);
  const LH = Math.round(LW * 0.44);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPI(canvas, LW, LH);
    if (!ctx) return;

    const cx = LW * 0.42, cy = LH / 2;
    const scaleX = (LW * 0.65) / params.lw;
    const scaleY = (LH * 0.6) / params.bw;
    const scale = Math.min(scaleX, scaleY);
    const dw = params.lw * scale;
    const dh = params.bw * scale;
    const coverMm = params.cover;
    const cover = coverMm * scale;
    const BL = Math.max(params.bw, 400) * scale;

    const sectionLeft = cx - dw / 2;
    const sectionTop = cy - dh / 2;
    const sectionRight = cx + dw / 2;
    const sectionBottom = cy + dh / 2;
    const frontZ = sectionTop + cover;
    const backZ = sectionBottom - cover;

    // ── Concrete ──
    drawConcreteSection(ctx, cx, cy, dw, dh);

    // ── Boundary element zones ──
    ctx.strokeStyle = '#8E44AD';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(sectionLeft, sectionTop, BL, dh);
    ctx.strokeRect(sectionRight - BL, sectionTop, BL, dh);
    ctx.setLineDash([]);

    // ── Parse ──
    const vert = parseSlabRebar(params.vertBar);
    const boundaryR = parseRebar(params.boundaryMain);

    // ── Vertical distributed bars ──
    const innerStart = sectionLeft + BL;
    const innerEnd = sectionRight - BL;
    const vertSpacing = vert.spacing * scale;
    for (let x = innerStart + vertSpacing / 2; x < innerEnd; x += vertSpacing) {
      const r = Math.max(vert.diameter * scale / 2, 2.5);
      drawRebarDot(ctx, x, frontZ, r, '#C0392B');
      drawRebarDot(ctx, x, backZ, r, '#C0392B');
    }

    // ── Tie bars connecting front/back distributed bars ──
    ctx.strokeStyle = '#1ABC9C';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 4]);
    for (let x = innerStart + vertSpacing; x < innerEnd; x += vertSpacing * 2) {
      ctx.beginPath();
      ctx.moveTo(x, frontZ);
      ctx.lineTo(x, backZ);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // ── Boundary element main bars ──
    const perSide = Math.max(Math.round(boundaryR.count / 2), 2);
    const bInnerW = BL - 2 * cover;
    // Left boundary
    for (let i = 0; i < perSide; i++) {
      const x = sectionLeft + cover + (bInnerW * i) / Math.max(perSide - 1, 1);
      const r = Math.max(boundaryR.diameter * scale / 2, 3);
      drawRebarDot(ctx, x, frontZ, r, '#8E44AD');
      drawRebarDot(ctx, x, backZ, r, '#8E44AD');
    }
    // Right boundary
    for (let i = 0; i < perSide; i++) {
      const x = sectionRight - cover - (bInnerW * i) / Math.max(perSide - 1, 1);
      const r = Math.max(boundaryR.diameter * scale / 2, 3);
      drawRebarDot(ctx, x, frontZ, r, '#8E44AD');
      drawRebarDot(ctx, x, backZ, r, '#8E44AD');
    }

    // ── Boundary stirrup with hooks ──
    const bStirX = sectionLeft + cover / 2;
    const bStirY = sectionTop + cover / 2;
    const bStirW = BL - cover;
    const bStirH = dh - cover;
    drawStirrup(ctx, bStirX, bStirY, bStirW, bStirH, '#27AE60', 6);
    drawStirrup(ctx, sectionRight - BL + cover / 2, bStirY, bStirW, bStirH, '#27AE60', 6);

    // ── Cover dimension ──
    drawCoverDim(ctx, sectionLeft, sectionBottom, cover, coverMm);

    // ── Dimension lines ──
    drawDimLine(ctx, sectionLeft, sectionBottom, sectionRight, sectionBottom, `${params.lw}`, 'bottom', 16);
    drawDimLine(ctx, sectionLeft, sectionTop, sectionLeft, sectionBottom, `${params.bw}`, 'left', 18);

    // ── Labels ──
    const labelX = sectionRight + 8;
    drawLabel(ctx, `竖向: ${params.vertBar}`, labelX, cy - 10, '#C0392B', LW);
    drawLabel(ctx, `边缘: ${params.boundaryMain}`, labelX, cy + 6, '#8E44AD', LW);
    drawLabel(ctx, `箍筋: ${params.boundaryStirrup}`, labelX, cy + 22, '#27AE60', LW);
  }, [params, LW, LH]);

  return (
    <div ref={containerRef} className="relative w-full">
      <ExportButton canvasRef={canvasRef} filename="shearwall-section.png" />
      <canvas ref={canvasRef} className="max-w-full" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STAIR (梯板横截面 — 垂直于行走方向)
// ═══════════════════════════════════════════════════════════════════
export function StairCrossSection({ params }: { params: StairParams }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerW = useContainerWidth(containerRef, 420);
  const LW = Math.min(Math.max(containerW, 320), 560);
  const LH = Math.round(LW * 0.55);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPI(canvas, LW, LH);
    if (!ctx) return;
    ctx.clearRect(0, 0, LW, LH);

    const botR = parseSlabRebar(params.bottomBar);
    const topR = parseSlabRebar(params.topBar);
    const distR = parseSlabRebar(params.distBar);
    const cover = params.cover || 15;

    // 截面尺寸 (梯段宽 × 梯板厚)
    const W = params.flightWidth;
    const H = params.slabThickness;
    const maxDim = Math.max(W, H);
    const scale = Math.min((LW - 100) / W, (LH - 80) / H, (LW - 80) / maxDim);
    const dw = W * scale;
    const dh = H * scale;
    const cx = LW / 2;
    const cy = LH / 2;

    // 截面矩形
    drawConcreteSection(ctx, cx, cy, dw, dh);

    const sectionLeft = cx - dw / 2;
    const sectionRight = cx + dw / 2;
    const sectionTop = cy - dh / 2;
    const sectionBottom = cy + dh / 2;
    const coverS = cover * scale;

    // 下部纵筋
    const botY = sectionBottom - coverS - botR.diameter * scale / 2;
    const botSpacing = botR.spacing * scale;
    const startX = sectionLeft + coverS + botR.diameter * scale / 2;
    const endX = sectionRight - coverS - botR.diameter * scale / 2;
    for (let x = startX; x <= endX + 0.5; x += botSpacing) {
      drawRebarDot(ctx, x, botY, Math.max(botR.diameter * scale * 0.5, 4), '#C0392B');
    }

    // 上部纵筋
    const topY = sectionTop + coverS + topR.diameter * scale / 2;
    const topSpacing = topR.spacing * scale;
    const tStartX = sectionLeft + coverS + topR.diameter * scale / 2;
    const tEndX = sectionRight - coverS - topR.diameter * scale / 2;
    for (let x = tStartX; x <= tEndX + 0.5; x += topSpacing) {
      drawRebarDot(ctx, x, topY, Math.max(topR.diameter * scale * 0.5, 4), '#8E44AD');
    }

    // 分布筋 (截面方向是圆点标记 — 垂直于纵筋)
    const distBotY = sectionBottom - coverS - botR.diameter * scale - distR.diameter * scale / 2;
    const distTopY = sectionTop + coverS + topR.diameter * scale + distR.diameter * scale / 2;
    const distX = cx;
    drawRebarCross(ctx, distX - 30, distBotY, Math.max(distR.diameter * scale * 0.4, 3), '#27AE60');
    drawRebarCross(ctx, distX, distBotY, Math.max(distR.diameter * scale * 0.4, 3), '#27AE60');
    drawRebarCross(ctx, distX + 30, distBotY, Math.max(distR.diameter * scale * 0.4, 3), '#27AE60');
    drawRebarCross(ctx, distX - 30, distTopY, Math.max(distR.diameter * scale * 0.4, 3), '#27AE60');
    drawRebarCross(ctx, distX, distTopY, Math.max(distR.diameter * scale * 0.4, 3), '#27AE60');
    drawRebarCross(ctx, distX + 30, distTopY, Math.max(distR.diameter * scale * 0.4, 3), '#27AE60');

    // 保护层标注
    drawCoverDim(ctx, sectionLeft, sectionBottom, coverS, cover);

    // 尺寸标注
    drawDimLine(ctx, sectionLeft, sectionBottom, sectionRight, sectionBottom, `${W}`, 'bottom', 16);
    drawDimLine(ctx, sectionLeft, sectionTop, sectionLeft, sectionBottom, `${H}`, 'left', 18);

    // 钢筋标注
    const labelX = sectionRight + 8;
    drawLabel(ctx, `底筋: ${params.bottomBar}`, labelX, cy - 14, '#C0392B', LW);
    drawLabel(ctx, `面筋: ${params.topBar}`, labelX, cy + 2, '#8E44AD', LW);
    drawLabel(ctx, `分布: ${params.distBar}`, labelX, cy + 18, '#27AE60', LW);
  }, [params, LW, LH]);

  return (
    <div ref={containerRef} className="relative w-full">
      <ExportButton canvasRef={canvasRef} filename="stair-section.png" />
      <canvas ref={canvasRef} className="max-w-full" />
    </div>
  );
}
