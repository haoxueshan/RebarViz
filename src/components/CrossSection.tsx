'use client';

import { useRef, useEffect, useState, useCallback, type RefObject } from 'react';
import { Download } from 'lucide-react';
import type { BeamParams, ColumnParams, SlabParams, ShearWallParams, StairParams, FoundationParams, PileCapParams, RaftFoundationParams } from '@/lib/types';
import { parseRebar, parseRebarBottom, parseStirrup, parseSlabRebar, parseSideBar, resolveColumnBars } from '@/lib/rebar';
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
    const botR = parseRebarBottom(params.bottom);
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

    // ── Top rebars (through bars, multi-row support, mixed diameter) ──
    const topY = sectionTop + cover;
    const topRowCount = topR.rows || (topR.perRow ? topR.perRow.length : 1);
    const topPerRow: number[] = topR.perRow && topR.perRow.length >= 2
      ? topR.perRow
      : topRowCount >= 2
        ? (() => { const pr: number[] = []; let rem = topR.count; for (let r = 0; r < topRowCount; r++) { const n = Math.ceil(rem / (topRowCount - r)); pr.push(n); rem -= n; } return pr; })()
        : [topR.count];
    const topDiaFn = (row: number) => topR.segments?.[row]?.diameter ?? topR.diameter;
    let topCurY = topY;
    for (let row = 0; row < topPerRow.length; row++) {
      const rowDia = topDiaFn(row);
      if (row > 0) {
        const prevDia = topDiaFn(row - 1);
        const clearV = Math.max(Math.max(prevDia, rowDia) * scale, 25 * scale);
        topCurY += prevDia * scale / 2 + clearV + rowDia * scale / 2;
      }
      const rowCount = topPerRow[row];
      const rowSpacing = innerW / Math.max(rowCount - 1, 1);
      for (let i = 0; i < rowCount; i++) {
        const x = sectionLeft + cover + i * rowSpacing;
        drawRebarDot(ctx, x, topCurY, Math.max(rowDia * scale / 2, 4), '#C0392B');
      }
    }
    const topLastRowY = topCurY;

    // ── Support rebars (1st row) ──
    const showLeftSupport = hasCut ? inLeftSupport : !!leftR;
    const showRightSupport = hasCut ? inRightSupport : !!rightR;
    const supportR = showLeftSupport ? leftR : showRightSupport ? rightR : null;

    if (supportR && (showLeftSupport || showRightSupport)) {
      const supportY = topLastRowY + topR.diameter * scale * 1.2;
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
      const row2Y = topLastRowY + topR.diameter * scale * 1.2 + supportR.diameter * scale * 1.2;
      const row2Spacing = innerW / Math.max(support2R.count - 1, 1);
      for (let i = 0; i < support2R.count; i++) {
        const x = sectionLeft + cover + i * row2Spacing;
        drawRebarDot(ctx, x, row2Y, Math.max(support2R.diameter * scale / 2, 3.5), '#A569BD');
      }
      const row2Label = showLeftSupport ? `左支座②: ${params.leftSupport2}` : `右支座②: ${params.rightSupport2}`;
      drawLabel(ctx, row2Label, sectionRight + 8, row2Y + 4, '#A569BD', LW);
    }

    // ── Bottom rebars (multi-row support, mixed diameter) ──
    const botY = sectionBottom - cover;
    const botRowCount = botR.rows || (botR.perRow ? botR.perRow.length : 1);
    const botPerRow: number[] = botR.perRow && botR.perRow.length >= 2
      ? botR.perRow
      : botRowCount >= 2
        ? (() => { const pr: number[] = []; let rem = botR.count; for (let r = 0; r < botRowCount; r++) { const n = Math.ceil(rem / (botRowCount - r)); pr.push(n); rem -= n; } return pr; })()
        : [botR.count];
    const botDiaFn = (row: number) => botR.segments?.[row]?.diameter ?? botR.diameter;
    let botCurY = botY;
    for (let row = 0; row < botPerRow.length; row++) {
      const rowDia = botDiaFn(row);
      if (row > 0) {
        const prevDia = botDiaFn(row - 1);
        const clearV = Math.max(Math.max(prevDia, rowDia) * scale, 25 * scale);
        botCurY -= prevDia * scale / 2 + clearV + rowDia * scale / 2;
      }
      const rowCount = botPerRow[row];
      const rowSpacing = innerW / Math.max(rowCount - 1, 1);
      for (let i = 0; i < rowCount; i++) {
        const x = sectionLeft + cover + i * rowSpacing;
        drawRebarDot(ctx, x, botCurY, Math.max(rowDia * scale / 2, 4), '#C0392B');
      }
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

    const stir = parseStirrup(params.stirrup);
    const innerW = dw - 2 * cover;
    const innerH = dh - 2 * cover;

    const resolved = resolveColumnBars(params.main, params.cornerMain, params.bMiddleMain, params.hMiddleMain, innerW, innerH);

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

    // ── Main rebars (using resolveColumnBars) ──
    const roleColor: Record<string, string> = { corner: '#C0392B', bMiddle: '#E67E22', hMiddle: '#8E44AD' };
    resolved.bars.forEach(bar => {
      const r = Math.max(bar.diameter * scale / 2, 4) * (bar.role === 'corner' ? 1.15 : 1);
      const color = resolved.isDetailed ? (roleColor[bar.role] || '#C0392B') : '#C0392B';
      drawRebarDot(ctx, cx + bar.x, cy + bar.z, r, color);
    });

    // ── Cover dimension ──
    drawCoverDim(ctx, sectionLeft, sectionBottom, cover, coverMm);

    // ── Dimension lines ──
    drawDimLine(ctx, sectionLeft, sectionBottom, sectionRight, sectionBottom, `${params.b}`, 'bottom', 16);
    drawDimLine(ctx, sectionLeft, sectionTop, sectionLeft, sectionBottom, `${params.h}`, 'left', 18);

    // ── Labels ──
    const labelX = sectionRight + 8;
    let labelY = cy - 18;
    if (resolved.isDetailed) {
      drawLabel(ctx, `角筋: ${params.cornerMain}`, labelX, labelY, '#C0392B', LW); labelY += 16;
      if (params.bMiddleMain) { drawLabel(ctx, `b中: ${params.bMiddleMain}`, labelX, labelY, '#E67E22', LW); labelY += 16; }
      if (params.hMiddleMain) { drawLabel(ctx, `h中: ${params.hMiddleMain}`, labelX, labelY, '#8E44AD', LW); labelY += 16; }
    } else {
      drawLabel(ctx, `纵筋: ${params.main}`, labelX, labelY, '#C0392B', LW); labelY += 16;
    }

    const typeInfo = stir.typeCode ? ` [${stir.typeCode}型]` : '';
    const stirLabel = hasCut
      ? `箍: Φ${stir.diameter}@${inDenseZone ? stir.spacingDense : stir.spacingNormal} (${inDenseZone ? '加密区' : '非加密区'})${typeInfo}`
      : `箍筋: ${params.stirrup}${typeInfo}`;
    drawLabel(ctx, stirLabel, labelX, labelY, '#27AE60', LW); labelY += 16;

    if (stir.legs > 2) {
      drawLabel(ctx, `${stir.legs}肢箍（含拉筋）`, labelX, labelY, '#27AE60', LW); labelY += 16;
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

// ═══════════════════════════════════════════════════════════════════
// FOUNDATION (独立基础 俯视截面)
// ═══════════════════════════════════════════════════════════════════
export function FoundationCrossSection({ params }: { params: FoundationParams }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerW = useContainerWidth(containerRef, 420);
  const LW = Math.min(Math.max(containerW, 320), 560);
  const LH = LW * 0.75;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPI(canvas, LW, LH);
    if (!ctx) return;

    const bx = params.bx;
    const by = params.by;
    const cover = params.cover || 40;
    const barX = parseSlabRebar(params.bottomBarX);
    const barY = parseSlabRebar(params.bottomBarY);

    const margin = 40;
    const drawW = LW - margin * 2;
    const drawH = LH - margin * 2;
    const scale = Math.min(drawW / bx, drawH / by);
    const cx = LW / 2;
    const cy = LH / 2;
    const secW = bx * scale;
    const secH = by * scale;
    const secL = cx - secW / 2;
    const secR = cx + secW / 2;
    const secT = cy - secH / 2;
    const secB = cy + secH / 2;
    const coverS = cover * scale;

    // 基础底面轮廓
    drawConcreteSection(ctx, secL, secT, secW, secH);

    // 柱截面轮廓 (虚线)
    const isDual = (params.columnCount || 1) === 2;
    const colW = params.colBx * scale;
    const colH = params.colBy * scale;
    const colCenters: number[] = isDual && params.colSpacing
      ? [cx - params.colSpacing * scale / 2, cx + params.colSpacing * scale / 2]
      : [cx];

    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1.5;
    for (const colCx of colCenters) {
      ctx.strokeRect(colCx - colW / 2, cy - colH / 2, colW, colH);
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#64748B';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    for (const colCx of colCenters) {
      ctx.fillText('柱', colCx, cy + 4);
    }

    // X 向底筋 (水平方向圆点)
    const xBarY = secB - coverS - barX.diameter * scale / 2;
    const xCount = Math.floor((bx - 2 * cover) / barX.spacing) + 1;
    const xStart = secL + coverS + barX.diameter * scale / 2;
    const xEnd = secR - coverS - barX.diameter * scale / 2;
    const xStep = xCount > 1 ? (xEnd - xStart) / (xCount - 1) : 0;
    for (let i = 0; i < xCount; i++) {
      drawRebarDot(ctx, xStart + i * xStep, xBarY, Math.max(barX.diameter * scale * 0.5, 3.5), '#C0392B');
    }

    // Y 向底筋 (垂直方向圆点)
    const yBarX = secL + coverS + barY.diameter * scale / 2;
    const yCount = Math.floor((by - 2 * cover) / barY.spacing) + 1;
    const yStart = secT + coverS + barY.diameter * scale / 2;
    const yEnd = secB - coverS - barY.diameter * scale / 2;
    const yStep = yCount > 1 ? (yEnd - yStart) / (yCount - 1) : 0;
    for (let i = 0; i < yCount; i++) {
      drawRebarDot(ctx, yBarX, yStart + i * yStep, Math.max(barY.diameter * scale * 0.5, 3.5), '#2980B9');
    }

    // 双柱: 顶部柱间配筋区域标示
    if (isDual && params.colSpacing && colCenters.length === 2) {
      const regionL = colCenters[0] + colW / 2;
      const regionR = colCenters[1] - colW / 2;
      const regionT = secT + coverS;
      const regionB = secB - coverS;
      ctx.fillStyle = 'rgba(230,126,34,0.08)';
      ctx.fillRect(regionL, regionT, regionR - regionL, regionB - regionT);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#E67E22';
      ctx.lineWidth = 1;
      ctx.strokeRect(regionL, regionT, regionR - regionL, regionB - regionT);
      ctx.setLineDash([]);
    }

    // 保护层标注
    drawCoverDim(ctx, secL, secB, coverS, cover);

    // 尺寸标注
    drawDimLine(ctx, secL, secB, secR, secB, `${bx}`, 'bottom', 16);
    drawDimLine(ctx, secL, secT, secL, secB, `${by}`, 'left', 18);
    if (isDual && params.colSpacing) {
      drawDimLine(ctx, colCenters[0], secT, colCenters[1], secT, `s=${params.colSpacing}`, 'top', 14);
    }

    // 钢筋标注
    const labelX = secR + 8;
    let labelY = cy - 16;
    drawLabel(ctx, `X向底: ${params.bottomBarX}`, labelX, labelY, '#C0392B', LW);
    labelY += 14;
    drawLabel(ctx, `Y向底: ${params.bottomBarY}`, labelX, labelY, '#2980B9', LW);
    if (isDual && params.topBarX) {
      labelY += 14;
      drawLabel(ctx, `顶纵: ${params.topBarX}`, labelX, labelY, '#E67E22', LW);
    }
    if (isDual && params.topBarY) {
      labelY += 14;
      drawLabel(ctx, `顶分: ${params.topBarY}`, labelX, labelY, '#27AE60', LW);
    }
  }, [params, LW, LH]);

  return (
    <div ref={containerRef} className="relative w-full">
      <ExportButton canvasRef={canvasRef} filename="foundation-section.png" />
      <canvas ref={canvasRef} className="max-w-full" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PILE CAP (承台 俯视截面)
// ═══════════════════════════════════════════════════════════════════
export function PileCapCrossSection({ params }: { params: PileCapParams }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerW = useContainerWidth(containerRef, 420);
  const LW = Math.min(Math.max(containerW, 320), 560);
  const LH = LW * 0.75;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPI(canvas, LW, LH);
    if (!ctx) return;

    const bx = params.bx;
    const by = params.by;
    const cover = params.cover || 50;

    const margin = 40;
    const drawW = LW - margin * 2;
    const drawH = LH - margin * 2;
    const scale = Math.min(drawW / bx, drawH / by);
    const cx = LW / 2;
    const cy = LH / 2;
    const secW = bx * scale;
    const secH = by * scale;
    const secL = cx - secW / 2;
    const secR = cx + secW / 2;
    const secT = cy - secH / 2;
    const secB = cy + secH / 2;
    const coverS = cover * scale;

    // 承台轮廓
    drawConcreteSection(ctx, secL, secT, secW, secH);

    // 柱截面轮廓 (虚线)
    const colW = params.colBx * scale;
    const colH = params.colBy * scale;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - colW / 2, cy - colH / 2, colW, colH);
    ctx.setLineDash([]);
    ctx.fillStyle = '#64748B';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('柱', cx, cy + 4);

    // 桩位 (圆圈)
    const pileR = params.pileDiameter * scale / 2;
    const { pileCount, pileSpacingX, pileSpacingY } = params;
    const pilePositions: { px: number; py: number }[] = [];
    if (pileCount === 1) {
      pilePositions.push({ px: cx, py: cy });
    } else if (pileCount === 2) {
      pilePositions.push({ px: cx - pileSpacingX * scale / 2, py: cy });
      pilePositions.push({ px: cx + pileSpacingX * scale / 2, py: cy });
    } else if (pileCount === 3) {
      pilePositions.push({ px: cx - pileSpacingX * scale / 2, py: cy + pileSpacingY * scale / 3 });
      pilePositions.push({ px: cx + pileSpacingX * scale / 2, py: cy + pileSpacingY * scale / 3 });
      pilePositions.push({ px: cx, py: cy - pileSpacingY * scale * 2 / 3 });
    } else {
      const cols = pileSpacingY > 0 ? Math.ceil(Math.sqrt(pileCount * (pileSpacingX / Math.max(pileSpacingY, 1)))) : pileCount;
      const rows = Math.ceil(pileCount / cols);
      const totalW = (cols - 1) * pileSpacingX * scale;
      const totalH2 = (rows - 1) * (pileSpacingY || pileSpacingX) * scale;
      let idx = 0;
      for (let r = 0; r < rows && idx < pileCount; r++) {
        for (let c = 0; c < cols && idx < pileCount; c++) {
          pilePositions.push({
            px: cx - totalW / 2 + c * pileSpacingX * scale,
            py: cy - totalH2 / 2 + r * (pileSpacingY || pileSpacingX) * scale,
          });
          idx++;
        }
      }
    }
    for (const p of pilePositions) {
      ctx.beginPath();
      ctx.arc(p.px, p.py, pileR, 0, Math.PI * 2);
      ctx.strokeStyle = '#7F8C8D';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(127,140,141,0.15)';
      ctx.fill();
    }

    // 保护层标注
    drawCoverDim(ctx, secL, secB, coverS, cover);

    // 尺寸标注
    drawDimLine(ctx, secL, secB, secR, secB, `${bx}`, 'bottom', 16);
    drawDimLine(ctx, secL, secT, secL, secB, `${by}`, 'left', 18);

    // 桩标注
    const labelX = secR + 8;
    drawLabel(ctx, `桩: Φ${params.pileDiameter} × ${pileCount}根`, labelX, cy - 16, '#7F8C8D', LW);
    drawLabel(ctx, `X向: ${params.bottomBarX}`, labelX, cy, '#C0392B', LW);
    drawLabel(ctx, `Y向: ${params.bottomBarY}`, labelX, cy + 16, '#2980B9', LW);
  }, [params, LW, LH]);

  return (
    <div ref={containerRef} className="relative w-full">
      <ExportButton canvasRef={canvasRef} filename="pilecap-section.png" />
      <canvas ref={canvasRef} className="max-w-full" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RAFT FOUNDATION (筏板基础 俯视截面)
// ═══════════════════════════════════════════════════════════════════
export function RaftCrossSection({ params }: { params: RaftFoundationParams }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerW = useContainerWidth(containerRef, 420);
  const LW = Math.min(Math.max(containerW, 320), 560);
  const LH = LW * 0.75;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupHiDPI(canvas, LW, LH);
    if (!ctx) return;

    const lx = params.lx;
    const ly = params.ly;
    const cover = params.cover || 40;
    const botX = parseSlabRebar(params.bottomBarX);
    const botY = parseSlabRebar(params.bottomBarY);

    const margin = 40;
    const drawW = LW - margin * 2;
    const drawH = LH - margin * 2;
    const scale = Math.min(drawW / lx, drawH / ly);
    const cx = LW / 2;
    const cy = LH / 2;
    const secW = lx * scale;
    const secH = ly * scale;
    const secL = cx - secW / 2;
    const secR = cx + secW / 2;
    const secT = cy - secH / 2;
    const secB = cy + secH / 2;
    const coverS = cover * scale;

    // 筏板轮廓
    drawConcreteSection(ctx, secL, secT, secW, secH);

    // 柱网 (虚线矩形)
    const colW = params.colBx * scale;
    const colH = params.colBy * scale;
    const halfGridX = ((params.colCountX - 1) * params.colSpacingX * scale) / 2;
    const halfGridY = ((params.colCountY - 1) * params.colSpacingY * scale) / 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1.5;
    for (let ix = 0; ix < params.colCountX; ix++) {
      for (let iy = 0; iy < params.colCountY; iy++) {
        const colCx = cx - halfGridX + ix * params.colSpacingX * scale;
        const colCy = cy - halfGridY + iy * params.colSpacingY * scale;
        ctx.strokeRect(colCx - colW / 2, colCy - colH / 2, colW, colH);
      }
    }
    ctx.setLineDash([]);

    // X 向底筋 (水平方向圆点)
    const xCount = Math.min(Math.floor((lx - 2 * cover) / botX.spacing) + 1, 30);
    const xStart = secL + coverS;
    const xEnd = secR - coverS;
    const xStep = xCount > 1 ? (xEnd - xStart) / (xCount - 1) : 0;
    const xBarY = secB - coverS;
    for (let i = 0; i < xCount; i++) {
      drawRebarDot(ctx, xStart + i * xStep, xBarY, Math.max(botX.diameter * scale * 0.5, 2.5), '#C0392B');
    }

    // Y 向底筋 (垂直方向圆点)
    const yCount = Math.min(Math.floor((ly - 2 * cover) / botY.spacing) + 1, 30);
    const yStart = secT + coverS;
    const yEnd = secB - coverS;
    const yStep = yCount > 1 ? (yEnd - yStart) / (yCount - 1) : 0;
    const yBarX = secL + coverS;
    for (let i = 0; i < yCount; i++) {
      drawRebarDot(ctx, yBarX, yStart + i * yStep, Math.max(botY.diameter * scale * 0.5, 2.5), '#2980B9');
    }

    // 保护层标注
    drawCoverDim(ctx, secL, secB, coverS, cover);

    // 尺寸标注
    drawDimLine(ctx, secL, secB, secR, secB, `${lx}`, 'bottom', 16);
    drawDimLine(ctx, secL, secT, secL, secB, `${ly}`, 'left', 18);

    // 钢筋标注
    const labelX = secR + 8;
    let labelYPos = cy - 24;
    drawLabel(ctx, `X底: ${params.bottomBarX}`, labelX, labelYPos, '#C0392B', LW);
    labelYPos += 14;
    drawLabel(ctx, `Y底: ${params.bottomBarY}`, labelX, labelYPos, '#2980B9', LW);
    if (params.topBarX) {
      labelYPos += 14;
      drawLabel(ctx, `X面: ${params.topBarX}`, labelX, labelYPos, '#E67E22', LW);
    }
    if (params.topBarY) {
      labelYPos += 14;
      drawLabel(ctx, `Y面: ${params.topBarY}`, labelX, labelYPos, '#27AE60', LW);
    }
    labelYPos += 14;
    drawLabel(ctx, `柱网: ${params.colCountX}×${params.colCountY}`, labelX, labelYPos, '#64748B', LW);
  }, [params, LW, LH]);

  return (
    <div ref={containerRef} className="relative w-full">
      <ExportButton canvasRef={canvasRef} filename="raft-section.png" />
      <canvas ref={canvasRef} className="max-w-full" />
    </div>
  );
}
