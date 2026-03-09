'use client';

import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { BeamParams } from '@/lib/types';
import { calcBarShapes, type BarShape } from '@/lib/calc';

/* ─── constants ─── */

const DPR = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
const MIN_CARD_W = 260;
const MAX_CARD_W = 360;
const CARD_H = 210;
const PAD = 20;
const MIN_SEG = 32;       // minimum pixels for any segment
const BAR_LW = 3;         // bar stroke width
const DIM_LW = 0.7;       // dimension line width

const DIM_COLOR = '#1D4ED8';
const DIM_FONT = '10px "Helvetica Neue", system-ui, sans-serif';
const LABEL_FONT = 'bold 11px "Helvetica Neue", system-ui, sans-serif';
const SPEC_FONT = '10px "Helvetica Neue", system-ui, sans-serif';
const CARD_BG = '#FAFBFC';
const CARD_BORDER = '#E2E8F0';
const COL_FACE_FILL = '#E8ECF1';
const COL_FACE_DASH = '#94A3B8';

/* ─── dimension line: horizontal ─── */

function dimH(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, label: string, below = false) {
  if (Math.abs(x2 - x1) < 6) return;
  const dir = below ? 1 : -1;
  const tk = 5;
  ctx.save();
  ctx.strokeStyle = DIM_COLOR; ctx.fillStyle = DIM_COLOR;
  ctx.lineWidth = DIM_LW; ctx.font = DIM_FONT;
  ctx.beginPath();
  ctx.moveTo(x1, y); ctx.lineTo(x2, y);
  ctx.moveTo(x1, y - tk * dir); ctx.lineTo(x1, y + tk * dir);
  ctx.moveTo(x2, y - tk * dir); ctx.lineTo(x2, y + tk * dir);
  const a = Math.min(5, Math.abs(x2 - x1) * 0.15);
  ctx.moveTo(x1 + a, y - a * 0.5); ctx.lineTo(x1, y); ctx.lineTo(x1 + a, y + a * 0.5);
  ctx.moveTo(x2 - a, y - a * 0.5); ctx.lineTo(x2, y); ctx.lineTo(x2 - a, y + a * 0.5);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = below ? 'top' : 'bottom';
  ctx.fillText(label, (x1 + x2) / 2, y + dir * 3);
  ctx.restore();
}

/* ─── dimension line: vertical ─── */

function dimV(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number, label: string, right = true) {
  if (Math.abs(y2 - y1) < 6) return;
  const dir = right ? 1 : -1;
  const tk = 5;
  ctx.save();
  ctx.strokeStyle = DIM_COLOR; ctx.fillStyle = DIM_COLOR;
  ctx.lineWidth = DIM_LW; ctx.font = DIM_FONT;
  ctx.beginPath();
  ctx.moveTo(x, y1); ctx.lineTo(x, y2);
  ctx.moveTo(x - tk * dir, y1); ctx.lineTo(x + tk * dir, y1);
  ctx.moveTo(x - tk * dir, y2); ctx.lineTo(x + tk * dir, y2);
  const a = Math.min(5, Math.abs(y2 - y1) * 0.15);
  ctx.moveTo(x - a * 0.5, y1 + a); ctx.lineTo(x, y1); ctx.lineTo(x + a * 0.5, y1 + a);
  ctx.moveTo(x - a * 0.5, y2 - a); ctx.lineTo(x, y2); ctx.lineTo(x + a * 0.5, y2 - a);
  ctx.stroke();
  ctx.translate(x + dir * 9, (y1 + y2) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = right ? 'bottom' : 'top';
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

/* ─── column face indicator: gray strip + dashed line ─── */

function colFace(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number, side: 'left' | 'right' = 'left') {
  const sw = 5;
  ctx.save();
  ctx.fillStyle = COL_FACE_FILL;
  ctx.fillRect(side === 'left' ? x - sw : x, y1, sw, y2 - y1);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = COL_FACE_DASH;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, y1); ctx.lineTo(x, y2);
  ctx.stroke();
  ctx.restore();
}

/* ─── rounded rect helper ─── */

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ─── ensure minimum segment px widths ─── */

function allocSegs(segs: number[], totalPx: number): number[] {
  const total = segs.reduce((s, v) => s + v, 0);
  if (total <= 0) return segs.map(() => totalPx / segs.length);
  // first pass: proportional
  let px = segs.map(s => (s / total) * totalPx);
  // second pass: enforce minimum, redistribute
  let deficit = 0;
  let flexTotal = 0;
  px = px.map((p, i) => {
    if (p < MIN_SEG && segs[i] > 0) { deficit += MIN_SEG - p; return MIN_SEG; }
    flexTotal += p;
    return p;
  });
  if (deficit > 0 && flexTotal > 0) {
    const scale = (flexTotal - deficit) / flexTotal;
    px = px.map((p, i) => (p > MIN_SEG || segs[i] === 0) ? p * Math.max(scale, 0.3) : p);
  }
  return px;
}

/* ================================================================= */
/*                        SHAPE DRAWING                              */
/* ================================================================= */

function drawShape(ctx: CanvasRenderingContext2D, shape: BarShape, ox: number, oy: number, cw: number) {
  const area = { x: ox + PAD, y: oy + 48, w: cw - PAD * 2, h: CARD_H - 66 };

  // ── Card ──
  ctx.save();
  rrect(ctx, ox + 3, oy + 3, cw - 6, CARD_H - 6, 8);
  ctx.fillStyle = CARD_BG; ctx.fill();
  ctx.strokeStyle = CARD_BORDER; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();

  // ── Header ──
  ctx.save();
  ctx.beginPath(); ctx.arc(ox + PAD + 4, oy + 16, 4, 0, Math.PI * 2);
  ctx.fillStyle = shape.color; ctx.fill();
  ctx.font = LABEL_FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1E293B';
  ctx.fillText(shape.name, ox + PAD + 14, oy + 16);
  ctx.fillStyle = '#64748B'; ctx.font = SPEC_FONT;
  const cnt = shape.count > 0 ? ` ×${shape.count}` : '';
  ctx.fillText(`${shape.spec}${cnt}   L=${Math.round(shape.totalLen)}mm`, ox + PAD + 4, oy + 34);
  ctx.restore();

  // ── Bar style ──
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = BAR_LW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (shape.shapeType) {

    /* ──────── 直锚通长筋 ──────── */
    case 'straight': {
      const anc = shape.anchorLen || 0;
      const body = shape.bodyLen || 0;
      const [pxA, pxB, pxA2] = allocSegs([anc, body, anc], area.w);
      const cy = area.y + area.h * 0.42;
      const x0 = area.x;
      const x1 = x0 + pxA;          // left column face
      const x2 = x1 + pxB;          // right column face
      const x3 = x2 + pxA2;         // right end

      // Column face indicators
      if (anc > 0) {
        colFace(ctx, x1, cy - 18, cy + 18, 'right');
        colFace(ctx, x2, cy - 18, cy + 18, 'left');
      }

      // Bar
      ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x3, cy); ctx.stroke();

      // Dims
      if (anc > 0) dimH(ctx, x0, x1, cy - 20, `la=${anc}`);
      dimH(ctx, x0, x3, cy + 26, `${Math.round(shape.totalLen)}`, true);
      break;
    }

    /* ──────── 弯锚通长筋 ──────── */
    case 'bentAnchor': {
      const anc = shape.anchorLen || 0;
      const body = shape.bodyLen || shape.totalLen;
      const bend = shape.bendLen || 0;
      const down = shape.bendDir !== 'up';

      const [pxA, pxB, pxA2] = allocSegs([anc, body, anc], area.w - 12);
      const bendPx = Math.min(Math.max(bend * 0.4, 22), area.h * 0.32);

      // vertical position: leave room for bend
      const cy = down ? area.y + area.h * 0.26 : area.y + area.h * 0.66;
      const bs = down ? 1 : -1;
      const x0 = area.x + 6;
      const x1 = x0 + pxA;
      const x2 = x1 + pxB;
      const x3 = x2 + pxA2;

      // Column faces
      colFace(ctx, x1, Math.min(cy, cy + bs * bendPx) - 8, Math.max(cy, cy + bs * bendPx) + 8, 'right');
      colFace(ctx, x2, Math.min(cy, cy + bs * bendPx) - 8, Math.max(cy, cy + bs * bendPx) + 8, 'left');

      // Bar: bend → horizontal → bend (continuous path)
      ctx.beginPath();
      ctx.moveTo(x0, cy + bs * bendPx);
      ctx.lineTo(x0, cy);
      ctx.lineTo(x3, cy);
      ctx.lineTo(x3, cy + bs * bendPx);
      ctx.stroke();

      // Dims
      dimH(ctx, x0, x3, down ? cy - 20 : cy + 22, `${Math.round(shape.totalLen)}`, !down);
      if (anc > 0) {
        const ay = down ? cy + bs * bendPx + 14 : cy + bs * bendPx - 14;
        dimH(ctx, x0, x1, ay, `la=${anc}`, down);
      }
      if (bend > 0) {
        dimV(ctx, x3 + 10,
          down ? cy : cy + bs * bendPx,
          down ? cy + bs * bendPx : cy,
          `15d=${bend}`);
      }
      break;
    }

    /* ──────── 支座负筋 ──────── */
    case 'support': {
      const anc = shape.anchorLen || 0;
      const body = shape.bodyLen || shape.totalLen;
      const bend = shape.bendLen || 0;
      const row = shape.supportRow || 1;
      const ratio = row === 2 ? 4 : 3;

      const segs = bend > 0 ? [bend * 0.3, anc, body] : [anc, body];
      const pxArr = allocSegs(segs, area.w - 10);

      const cy = area.y + area.h * 0.40;
      const x0 = area.x + 5;
      const cursor = x0;
      let xBendEnd = x0, xAncEnd = x0, xEnd = x0;

      if (bend > 0) {
        xBendEnd = cursor + pxArr[0];
        xAncEnd = xBendEnd + pxArr[1];
        xEnd = xAncEnd + pxArr[2];
      } else {
        xAncEnd = cursor + pxArr[0];
        xEnd = xAncEnd + pxArr[1];
      }
      const bendPx = bend > 0 ? Math.min(Math.max(bend * 0.3, 20), area.h * 0.30) : 0;

      // Column face at anchor/body boundary
      colFace(ctx, xAncEnd, cy - 18, cy + Math.max(18, bendPx + 8), 'left');

      // Bar path
      ctx.beginPath();
      if (bend > 0) {
        ctx.moveTo(x0, cy + bendPx);  // bend bottom
        ctx.lineTo(x0, cy);            // bend top → bar level
      } else {
        ctx.moveTo(x0, cy);
      }
      ctx.lineTo(xEnd, cy);
      ctx.stroke();

      // Dims
      if (bend > 0) {
        dimV(ctx, x0 - 8, cy, cy + bendPx, `15d`, false);
        dimH(ctx, x0, xAncEnd, cy - 20, `la=${anc}`);
      } else {
        dimH(ctx, x0, xAncEnd, cy - 20, `la=${anc}`);
      }
      dimH(ctx, xAncEnd, xEnd, cy + 26, `ln/${ratio}=${Math.round(body)}`, true);
      break;
    }

    /* ──────── 箍筋 ──────── */
    case 'stirrup': {
      const w = shape.width || 100;
      const h = shape.height || 200;
      const hook = shape.hookLen || 75;
      const maxD = Math.max(w, h);
      const sc = Math.min((area.w - 30) * 0.50 / maxD, (area.h - 24) * 0.60 / maxD);
      const sw = w * sc, sh = h * sc;
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2 - 4;
      const hkS = Math.min(hook * sc * 0.45, sh * 0.30);

      // Rectangle
      ctx.beginPath();
      ctx.rect(cx - sw / 2, cy - sh / 2, sw, sh);
      ctx.stroke();

      // Hook overlap point: top-left corner
      const hx = cx - sw / 2;
      const hy = cy - sh / 2;
      const sq = Math.SQRT1_2;

      // Hook end #1: comes along top edge → corner → 135° tail into interior
      ctx.beginPath();
      ctx.moveTo(hx + hkS, hy);      // start point on top edge (overlap region)
      ctx.lineTo(hx, hy);             // to corner
      ctx.lineTo(hx + sq * hkS, hy + sq * hkS); // 135° tail
      ctx.stroke();

      // Hook end #2: comes along left edge → corner → 135° tail into interior
      ctx.beginPath();
      ctx.moveTo(hx, hy + hkS);      // start point on left edge (overlap region)
      ctx.lineTo(hx, hy);             // to corner
      ctx.lineTo(hx + sq * hkS, hy + sq * hkS); // 135° tail
      ctx.stroke();

      // Dot at junction
      ctx.beginPath(); ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = shape.color; ctx.fill();

      // Dims
      dimH(ctx, cx - sw / 2, cx + sw / 2, cy + sh / 2 + 16, `${w}`, true);
      dimV(ctx, cx + sw / 2 + 12, cy - sh / 2, cy + sh / 2, `${h}`);
      break;
    }

    /* ──────── 拉筋 ──────── */
    case 'tie': {
      const body = shape.bodyLen || 100;
      const hook = shape.hookLen || 75;
      if (body <= 0) break;

      // 拉筋形状: 水平主体, 两端90°向下弯折, 末端135°弯钩向内
      //   ┌══════════════┐   ← 水平主体(body)
      //   │              │   ← 90°弯折段(leg)
      //   ╱              ╲   ← 135°弯钩(tail, 向内45°)
      const bodyPx = area.w * 0.65;
      const cx = area.x + area.w / 2;
      const topY = area.y + area.h * 0.18;
      const xL = cx - bodyPx / 2;
      const xR = cx + bodyPx / 2;

      // 90° leg and 135° tail proportions
      const legH = Math.min(area.h * 0.35, 38);
      const tailL = Math.min(legH * 0.6, 22);
      const sq = Math.SQRT1_2;

      // Draw complete bar path: left-tail → left-leg → body → right-leg → right-tail
      ctx.beginPath();
      // left 135° hook tail (tip, going inward = right)
      ctx.moveTo(xL + sq * tailL, topY + legH + sq * tailL);
      // left leg bottom
      ctx.lineTo(xL, topY + legH);
      // left leg top = body left
      ctx.lineTo(xL, topY);
      // body right
      ctx.lineTo(xR, topY);
      // right leg bottom
      ctx.lineTo(xR, topY + legH);
      // right 135° hook tail (tip, going inward = left)
      ctx.lineTo(xR - sq * tailL, topY + legH + sq * tailL);
      ctx.stroke();

      // Dots at bend points
      ctx.fillStyle = shape.color;
      [xL, xR].forEach(bx => {
        ctx.beginPath(); ctx.arc(bx, topY, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(bx, topY + legH, 2, 0, Math.PI * 2); ctx.fill();
      });

      // Dims
      dimH(ctx, xL, xR, topY - 16, `${Math.round(body)}`);
      const totalPx = Math.max(xR + sq * tailL + 4, xR + 8);
      const totalPxL = Math.min(xL - sq * tailL - 4, xL - 8);
      dimH(ctx, totalPxL, totalPx, topY + legH + sq * tailL + 18,
        `L=${Math.round(shape.totalLen)}`, true);
      dimV(ctx, xR + 14, topY, topY + legH, `${Math.round(hook)}弯钩`);
      break;
    }
  }
  ctx.restore();
}

/* ================================================================= */
/*                        COMPONENT                                  */
/* ================================================================= */

export function BarBendingSchedule({ params }: { params: BeamParams }) {
  const shapes = useMemo(() => calcBarShapes(params), [params]);
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
      drawShape(ctx, shape, (i % cols) * cardW, Math.floor(i / cols) * CARD_H, cardW);
    });
  }, [shapes, totalW, totalH, cols, cardW]);

  useEffect(draw, [draw]);

  if (shapes.length === 0) return null;

  return (
    <div ref={wrapRef}>
      <h2 className="text-sm font-semibold text-primary mb-3">钢筋弯折详图 (BBS)</h2>
      <div className="overflow-x-auto">
        <canvas ref={canvasRef} className="mx-auto" />
      </div>
    </div>
  );
}
