'use client';

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { StairParams } from '@/lib/types';
import { calcStairBarShapes, type BarShape } from '@/lib/calc';

/* ═══════════════════════════════════════════════════════
   精细钢筋下料图 (BBS) – 施工级精度
   ═══════════════════════════════════════════════════════ */

const DPR = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
const MIN_CARD_W = 320;
const MAX_CARD_W = 420;
const CARD_H = 280;
const PAD = 24;
const BAR_LW = 2.5;

const DIM_COLOR = '#1D4ED8';
const DIM_LW = 0.6;
const DIM_FONT = '9.5px "Helvetica Neue", system-ui, sans-serif';
const DIM_FONT_BOLD = 'bold 9.5px "Helvetica Neue", system-ui, sans-serif';
const LABEL_FONT = 'bold 12px "Helvetica Neue", system-ui, sans-serif';
const SPEC_FONT = '10px "Helvetica Neue", system-ui, sans-serif';
const NUM_FONT = 'bold 10px "Helvetica Neue", system-ui, sans-serif';
const CARD_BG = '#FAFBFC';
const CARD_BORDER = '#E2E8F0';
const BEAM_FILL = '#E8ECF1';
const BEAM_DASH = '#94A3B8';
const BEND_R = 4;

/* ─── helper: rounded rect ─── */

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ─── helper: dimension line with slash-tick ends (standard engineering) ─── */

function dimLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  label: string, offset: number, side: 'above' | 'below' | 'left' | 'right'
) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 8) return;

  // Unit vectors: along line and perpendicular
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux; // perpendicular (left of direction)

  // Offset direction
  let ox: number, oy: number;
  if (side === 'above' || side === 'left') { ox = nx * offset; oy = ny * offset; }
  else { ox = -nx * offset; oy = -ny * offset; }

  // Dimension line endpoints (offset from the bar)
  const ax = x1 + ox, ay = y1 + oy;
  const bx = x2 + ox, by = y2 + oy;

  ctx.save();
  ctx.strokeStyle = DIM_COLOR;
  ctx.fillStyle = DIM_COLOR;
  ctx.lineWidth = DIM_LW;
  ctx.font = DIM_FONT;

  // Extension lines (from bar point to dimension line)
  ctx.beginPath();
  ctx.moveTo(x1 + ox * 0.15, y1 + oy * 0.15);
  ctx.lineTo(ax + ox * 0.15, ay + oy * 0.15);
  ctx.moveTo(x2 + ox * 0.15, y2 + oy * 0.15);
  ctx.lineTo(bx + ox * 0.15, by + oy * 0.15);
  ctx.stroke();

  // Dimension line itself
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  ctx.stroke();

  // Slash ticks at ends (45° slash marks, standard Chinese engineering drawing)
  const tk = 3.5;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  // tick at start: 45° slash
  ctx.moveTo(ax - tk * 0.7, ay - tk * 0.7);
  ctx.lineTo(ax + tk * 0.7, ay + tk * 0.7);
  // tick at end
  ctx.moveTo(bx - tk * 0.7, by - tk * 0.7);
  ctx.lineTo(bx + tk * 0.7, by + tk * 0.7);
  ctx.stroke();

  // Label at midpoint
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  // Determine text alignment based on line angle
  const angle = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(mx, my);
  // Rotate text to follow line if it's sloped
  let textAngle = angle;
  if (textAngle > Math.PI / 2) textAngle -= Math.PI;
  if (textAngle < -Math.PI / 2) textAngle += Math.PI;
  ctx.rotate(textAngle);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, 0, -3);
  ctx.restore();

  ctx.restore();
}

/* ─── helper: beam face indicator (hatched rectangle) ─── */

function beamFace(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number, width: number, side: 'left' | 'right') {
  const bx = side === 'left' ? x - width : x;
  ctx.save();
  // Fill
  ctx.fillStyle = BEAM_FILL;
  ctx.fillRect(bx, y1, width, y2 - y1);
  // Hatching
  ctx.strokeStyle = BEAM_DASH;
  ctx.lineWidth = 0.4;
  const step = 4;
  ctx.beginPath();
  for (let i = 0; i < (width + (y2 - y1)) / step; i++) {
    const s = i * step;
    const sx = bx + Math.min(s, width);
    const sy = y1 + Math.max(0, s - width);
    const ex = bx + Math.max(0, s - (y2 - y1));
    const ey = y1 + Math.min(s, y2 - y1);
    ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
  }
  ctx.stroke();
  // Edge line (dashed)
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = BEAM_DASH;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, y1); ctx.lineTo(x, y2);
  ctx.stroke();
  ctx.restore();
}

/* ─── helper: bar number circle ─── */

function barNum(ctx: CanvasRenderingContext2D, x: number, y: number, num: string, color: string) {
  const r = 8;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.font = NUM_FONT;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(num, x, y + 0.5);
  ctx.restore();
}

/* ─── helper: bend radius arc ─── */

function bendArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, startAngle: number, endAngle: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, BEND_R, startAngle, endAngle);
  ctx.stroke();
  ctx.restore();
}

/* ─── draw card header ─── */

function drawHeader(ctx: CanvasRenderingContext2D, shape: BarShape, ox: number, oy: number, cw: number, num: string) {
  // Card background
  ctx.save();
  rrect(ctx, ox + 2, oy + 2, cw - 4, CARD_H - 4, 10);
  ctx.fillStyle = CARD_BG; ctx.fill();
  ctx.strokeStyle = CARD_BORDER; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();

  // Number circle + name
  barNum(ctx, ox + PAD + 8, oy + 18, num, shape.color);
  ctx.save();
  ctx.font = LABEL_FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1E293B';
  ctx.fillText(shape.name, ox + PAD + 22, oy + 18);
  ctx.restore();

  // Spec line
  ctx.save();
  ctx.fillStyle = '#64748B'; ctx.font = SPEC_FONT;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const cnt = shape.count > 0 ? ` ×${shape.count}根` : '';
  ctx.fillText(`${shape.spec}${cnt}`, ox + PAD + 4, oy + 38);
  ctx.restore();

  // Total length (right aligned)
  ctx.save();
  ctx.font = DIM_FONT_BOLD; ctx.fillStyle = '#0F172A';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(`L = ${Math.round(shape.totalLen)} mm`, ox + cw - PAD, oy + 38);
  ctx.restore();
}

/* ─── draw: 下部纵筋 (straight, sloped) ─── */

function drawBotBar(ctx: CanvasRenderingContext2D, shape: BarShape, ox: number, oy: number, cw: number) {
  drawHeader(ctx, shape, ox, oy, cw, '1');

  const area = { x: ox + PAD + 8, y: oy + 56, w: cw - PAD * 2 - 16, h: CARD_H - 100 };
  const anc = shape.anchorLen || 0;
  const body = shape.bodyLen || 0;

  // Proportional allocation
  const total = anc + body + anc;
  const pAnc = Math.max(30, area.w * (anc / total));
  const pBody = area.w - pAnc * 2;

  // Slope: visual rise proportional to actual
  const slopeRise = Math.min(area.h * 0.4, 40);
  const yMid = area.y + area.h * 0.5;
  const yBot = yMid + slopeRise / 2;
  const yTop = yMid - slopeRise / 2;

  // Key X positions
  const x0 = area.x;                      // bar start (low anchor end)
  const x1 = area.x + pAnc;               // low beam inner face
  const x2 = area.x + pAnc + pBody;       // high beam inner face
  const x3 = area.x + area.w;             // bar end (high anchor end)

  // Y interpolation
  const yAt = (x: number) => yBot + (yTop - yBot) * ((x - x0) / (x3 - x0));

  // Beam face indicators
  beamFace(ctx, x1, yAt(x1) - 24, yAt(x1) + 24, 10, 'left');
  beamFace(ctx, x2, yAt(x2) - 24, yAt(x2) + 24, 10, 'right');

  // Bar line
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = BAR_LW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, yAt(x0));
  ctx.lineTo(x3, yAt(x3));
  ctx.stroke();

  // End dots
  ctx.beginPath();
  ctx.arc(x0, yAt(x0), 2.5, 0, Math.PI * 2);
  ctx.arc(x3, yAt(x3), 2.5, 0, Math.PI * 2);
  ctx.fillStyle = shape.color; ctx.fill();
  ctx.restore();

  // Dimension lines
  // Segment dimensions (above the bar, parallel to slope)
  dimLine(ctx, x0, yAt(x0), x1, yAt(x1), `${anc}`, 14, 'above');
  dimLine(ctx, x1, yAt(x1), x2, yAt(x2), `${body}`, 14, 'above');
  dimLine(ctx, x2, yAt(x2), x3, yAt(x3), `${anc}`, 14, 'above');

  // Total dimension (below)
  dimLine(ctx, x0, yAt(x0), x3, yAt(x3), `L = ${Math.round(shape.totalLen)}`, 22, 'below');

  // Annotation: anchor requirement
  ctx.save();
  ctx.font = '8.5px "Helvetica Neue", system-ui, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('≥5d 且过中线', (x0 + x1) / 2, yAt((x0 + x1) / 2) + 28);
  ctx.fillText('≥5d 且过中线', (x2 + x3) / 2, yAt((x2 + x3) / 2) + 28);
  ctx.restore();
}

/* ─── draw: 上部纵筋 (bent anchor with hook) ─── */

function drawTopBar(ctx: CanvasRenderingContext2D, shape: BarShape, ox: number, oy: number, cw: number) {
  drawHeader(ctx, shape, ox, oy, cw, '2');

  const area = { x: ox + PAD + 14, y: oy + 56, w: cw - PAD * 2 - 28, h: CARD_H - 100 };
  const anc = shape.anchorLen || 0;
  const body = shape.bodyLen || 0;
  const hook = shape.hookLen || 0;

  // Layout allocation: hook takes vertical space, anc + body share horizontal
  const total = anc + body;
  const ancFrac = total > 0 ? anc / total : 0.3;
  const pAnc = Math.max(30, area.w * ancFrac);
  const pBody = area.w - pAnc;

  // Slope rise
  const slopeRise = Math.min(area.h * 0.35, 36);
  const hookV = Math.min(area.h * 0.35, 40);

  // Reference Y: bend point (where hook meets diagonal)
  const yBend = area.y + hookV + 6;
  const xStart = area.x;

  // Key points
  const pHookEnd = { x: xStart, y: yBend + hookV };         // hook bottom
  const pBendPt  = { x: xStart, y: yBend };                  // bend point
  const pBeamFace = { x: xStart + pAnc, y: yBend - slopeRise * ancFrac }; // beam inner face
  const pEnd = { x: xStart + area.w, y: yBend - slopeRise };  // bar end (ln/4)

  // Beam face indicator
  beamFace(ctx, pBeamFace.x, pBeamFace.y - 24, pBeamFace.y + 24, 10, 'right');

  // Bar line
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = BAR_LW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw: hook → bend → beam face → end
  ctx.beginPath();
  ctx.moveTo(pHookEnd.x, pHookEnd.y);
  ctx.lineTo(pBendPt.x, pBendPt.y);
  ctx.lineTo(pBeamFace.x, pBeamFace.y);
  ctx.lineTo(pEnd.x, pEnd.y);
  ctx.stroke();

  // End dots
  ctx.beginPath();
  ctx.arc(pHookEnd.x, pHookEnd.y, 2.5, 0, Math.PI * 2);
  ctx.arc(pEnd.x, pEnd.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = shape.color; ctx.fill();

  // Bend radius indicator
  bendArc(ctx, pBendPt.x + BEND_R, pBendPt.y + BEND_R, Math.PI, Math.PI * 1.5, shape.color);
  ctx.restore();

  // Dimensions
  // Hook length (vertical, left side)
  dimLine(ctx, pHookEnd.x, pHookEnd.y, pBendPt.x, pBendPt.y, `15d=${hook}`, 16, 'left');

  // Anchor segment (slope, above)
  dimLine(ctx, pBendPt.x, pBendPt.y, pBeamFace.x, pBeamFace.y, `${anc}`, 14, 'above');

  // Body segment (slope, above)
  dimLine(ctx, pBeamFace.x, pBeamFace.y, pEnd.x, pEnd.y, `ln/4=${body}`, 14, 'above');

  // Total horizontal dimension (below everything)
  const dimY = Math.max(pHookEnd.y, pBendPt.y, pEnd.y) + 16;
  ctx.save();
  ctx.strokeStyle = DIM_COLOR; ctx.fillStyle = DIM_COLOR;
  ctx.lineWidth = DIM_LW; ctx.font = DIM_FONT_BOLD;
  // horizontal extent line
  const xMin = Math.min(pHookEnd.x, pEnd.x);
  const xMax = Math.max(pHookEnd.x, pEnd.x);
  ctx.beginPath();
  ctx.moveTo(xMin, dimY); ctx.lineTo(xMax, dimY);
  // extension lines
  ctx.moveTo(pHookEnd.x, pHookEnd.y + 2); ctx.lineTo(pHookEnd.x, dimY + 4);
  ctx.moveTo(pEnd.x, pEnd.y + 2); ctx.lineTo(pEnd.x, dimY + 4);
  ctx.stroke();
  // ticks
  const tk = 3.5;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(xMin - tk * 0.7, dimY - tk * 0.7); ctx.lineTo(xMin + tk * 0.7, dimY + tk * 0.7);
  ctx.moveTo(xMax - tk * 0.7, dimY - tk * 0.7); ctx.lineTo(xMax + tk * 0.7, dimY + tk * 0.7);
  ctx.stroke();
  // label
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`L = ${Math.round(shape.totalLen)}`, (xMin + xMax) / 2, dimY + 3);
  ctx.restore();

  // Annotation
  ctx.save();
  ctx.font = '8.5px "Helvetica Neue", system-ui, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('伸至梁边', pBendPt.x + 4, pBendPt.y + 10);
  ctx.restore();
}

/* ─── draw: 分布筋 (simple straight) ─── */

function drawDistBar(ctx: CanvasRenderingContext2D, shape: BarShape, ox: number, oy: number, cw: number) {
  drawHeader(ctx, shape, ox, oy, cw, '3');

  const area = { x: ox + PAD + 8, y: oy + 56, w: cw - PAD * 2 - 16, h: CARD_H - 100 };
  const cy = area.y + area.h * 0.4;

  // Bar line
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = BAR_LW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(area.x, cy);
  ctx.lineTo(area.x + area.w, cy);
  ctx.stroke();

  // End dots
  ctx.beginPath();
  ctx.arc(area.x, cy, 2.5, 0, Math.PI * 2);
  ctx.arc(area.x + area.w, cy, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = shape.color; ctx.fill();
  ctx.restore();

  // Dimension
  dimLine(ctx, area.x, cy, area.x + area.w, cy, `L = ${Math.round(shape.totalLen)}`, 18, 'below');

  // Annotation
  ctx.save();
  ctx.font = '8.5px "Helvetica Neue", system-ui, sans-serif';
  ctx.fillStyle = '#94A3B8';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('垂直于纵筋方向', area.x + area.w / 2, cy + 30);
  ctx.restore();
}

/* ─── draw dispatcher ─── */

function drawShape(ctx: CanvasRenderingContext2D, shape: BarShape, ox: number, oy: number, cw: number, idx: number) {
  if (shape.shapeType === 'bentAnchor') {
    drawTopBar(ctx, shape, ox, oy, cw);
  } else if (shape.anchorLen && shape.anchorLen > 0) {
    drawBotBar(ctx, shape, ox, oy, cw);
  } else {
    drawDistBar(ctx, shape, ox, oy, cw);
  }
}

/* ═══════════ Component ═══════════ */

export function StairBarBendingSchedule({ params }: { params: StairParams }) {
  const shapes = useMemo(() => calcStairBarShapes(params), [params]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerW(Math.floor(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { cols, cardW, totalW, totalH } = useMemo(() => {
    if (containerW === 0 || shapes.length === 0)
      return { cols: 1, cardW: MIN_CARD_W, totalW: 0, totalH: 0 };
    const maxCols = Math.max(1, Math.floor(containerW / MIN_CARD_W));
    const c = Math.min(shapes.length, maxCols);
    const w = Math.min(MAX_CARD_W, Math.floor(containerW / c));
    const r = Math.ceil(shapes.length / c);
    return { cols: c, cardW: w, totalW: c * w, totalH: r * CARD_H };
  }, [containerW, shapes.length]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || totalW === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = totalW * DPR;
    canvas.height = totalH * DPR;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(DPR, DPR);
    ctx.clearRect(0, 0, totalW, totalH);
    shapes.forEach((shape, i) => {
      drawShape(ctx, shape, (i % cols) * cardW, Math.floor(i / cols) * CARD_H, cardW, i);
    });
  }, [shapes, totalW, totalH, cols, cardW]);

  useEffect(draw, [draw]);

  if (shapes.length === 0) return null;

  return (
    <div ref={wrapRef}>
      <h2 className="text-sm font-semibold text-primary mb-3">
        钢筋下料图 (BBS)
        <span className="text-[10px] font-normal text-gray-400 ml-1">22G101-2 AT型</span>
      </h2>
      <div className="overflow-x-auto">
        <canvas ref={canvasRef} className="mx-auto" />
      </div>
    </div>
  );
}
