'use client';

import type { PileCapParams } from '@/lib/types';
import { parseSlabRebar, parseRebar, gradeLabel } from '@/lib/rebar';
import {
  getPileEmbedDepth,
  determinePileCapRebarEnd,
  calcLaTable, calcLaETable,
  ANCHOR_LARGE_DIA_THRESHOLD,
} from '@/lib/anchor';
import { determineColFoundAnchor } from '@/lib/construction-rules';
import type { ConcreteGrade, SeismicGrade } from '@/lib/anchor';

/* ─── Small reusable card ─── */
function RuleCard({ title, badge, badgeOk, children }: {
  title: string; badge?: string; badgeOk?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-primary">{title}</span>
        {badge && (
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badgeOk ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <span className="text-muted shrink-0">{label}</span>
      <div className="text-right">
        <span className="font-medium text-primary">{value}</span>
        {note && <div className="text-muted text-[11px]">{note}</div>}
      </div>
    </div>
  );
}

export function PileCapAnchorPanel({ params }: { params: PileCapParams }) {
  const cover = params.cover || 50;
  const concreteGrade = params.concreteGrade as ConcreteGrade;
  const seismicGrade = (params.seismicGrade || '三级') as SeismicGrade;

  const barX = parseSlabRebar(params.bottomBarX);
  const barY = parseSlabRebar(params.bottomBarY);
  const colR = parseRebar(params.colMain);

  // Pile embedment
  const embedDepth = getPileEmbedDepth(params.pileDiameter);
  const embedOk = params.pileDiameter > 0;

  // Bottom bar end treatment — X direction (runs along Y, end at cap edge)
  const availLenX = params.by / 2 - cover;
  const rebarEndX = determinePileCapRebarEnd(barX.diameter, 'round', params.pileDiameter, availLenX);

  // Bottom bar end treatment — Y direction
  const availLenY = params.bx / 2 - cover;
  const rebarEndY = determinePileCapRebarEnd(barY.diameter, 'round', params.pileDiameter, availLenY);

  // Anchor lengths (table method)
  const laX = calcLaTable(barX.grade, barX.diameter, concreteGrade);
  const laY = calcLaTable(barY.grade, barY.diameter, concreteGrade);
  const largeDiaX = barX.diameter > ANCHOR_LARGE_DIA_THRESHOLD;
  const largeDiaY = barY.diameter > ANCHOR_LARGE_DIA_THRESHOLD;

  // Column insert anchor
  const laECol = calcLaETable(colR.grade, colR.diameter, concreteGrade, seismicGrade);
  const colAnchor = determineColFoundAnchor(params.h, cover, colR.diameter, laECol);

  const pileTypeLabel = `圆桩 Φ${params.pileDiameter}mm`;
  const embedThreshold = params.pileDiameter < 800 ? '< 800mm → 嵌入50mm' : '≥ 800mm → 嵌入100mm';

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-primary">承台锚固构造检查 — 22G101-3</h2>

      {/* Pile head embedment */}
      <RuleCard title="桩顶嵌入承台深度" badge={`h = ${embedDepth}mm`} badgeOk={embedOk}>
        <Row label="桩型" value={pileTypeLabel} />
        <Row label="判定依据" value={embedThreshold} note="22G101-3 §2-38/2-39" />
        <Row label="嵌入深度 h" value={`${embedDepth} mm`} />
      </RuleCard>

      {/* X-bar end */}
      <RuleCard
        title="X向底筋端部构造"
        badge={rebarEndX.meetsMin ? (rebarEndX.needBend ? '弯折 12d' : '直段可不弯') : '⚠ 不满足'}
        badgeOk={rebarEndX.meetsMin}
      >
        <Row label="钢筋规格" value={`${gradeLabel(barX.grade)} Φ${barX.diameter}`}
          note={largeDiaX ? `d=${barX.diameter}>${ANCHOR_LARGE_DIA_THRESHOLD}mm，la已×1.1修正` : undefined} />
        <Row label="承台可用直段长度" value={`${availLenX} mm`} note="= by/2 - c" />
        <Row label="最小直段 (25d+0.1D)" value={`${rebarEndX.minStraight} mm`} />
        <Row label="不弯折要求 (35d+0.1D)" value={`${rebarEndX.noBendStraight} mm`} />
        {rebarEndX.needBend && (
          <Row label="弯折长度 12d" value={`${rebarEndX.bendLen} mm`} />
        )}
        <Row label="查表法 la" value={`${laX} mm`} note="22G101-3 §2-3" />
        <div className={`text-[11px] mt-1 px-2 py-1 rounded ${rebarEndX.meetsMin ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {rebarEndX.description}
        </div>
      </RuleCard>

      {/* Y-bar end */}
      <RuleCard
        title="Y向底筋端部构造"
        badge={rebarEndY.meetsMin ? (rebarEndY.needBend ? '弯折 12d' : '直段可不弯') : '⚠ 不满足'}
        badgeOk={rebarEndY.meetsMin}
      >
        <Row label="钢筋规格" value={`${gradeLabel(barY.grade)} Φ${barY.diameter}`}
          note={largeDiaY ? `d=${barY.diameter}>${ANCHOR_LARGE_DIA_THRESHOLD}mm，la已×1.1修正` : undefined} />
        <Row label="承台可用直段长度" value={`${availLenY} mm`} note="= bx/2 - c" />
        <Row label="最小直段 (25d+0.1D)" value={`${rebarEndY.minStraight} mm`} />
        <Row label="不弯折要求 (35d+0.1D)" value={`${rebarEndY.noBendStraight} mm`} />
        {rebarEndY.needBend && (
          <Row label="弯折长度 12d" value={`${rebarEndY.bendLen} mm`} />
        )}
        <Row label="查表法 la" value={`${laY} mm`} note="22G101-3 §2-3" />
        <div className={`text-[11px] mt-1 px-2 py-1 rounded ${rebarEndY.meetsMin ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {rebarEndY.description}
        </div>
      </RuleCard>

      {/* Column insert anchor */}
      <RuleCard
        title="柱插筋在承台内锚固"
        badge={colAnchor.canStraight ? '直锚' : '弯锚'}
        badgeOk={colAnchor.canStraight}
      >
        <Row label="柱插筋规格" value={`${gradeLabel(colR.grade)} Φ${colR.diameter}`} />
        <Row label="抗震锚固长度 laE (查表)" value={`${laECol} mm`}
          note={`${concreteGrade} / ${seismicGrade}`} />
        <Row label="承台内可用高度" value={`${params.h - cover} mm`} note="= h承台 - c" />
        <Row label="锚固类型" value={colAnchor.canStraight ? '直锚' : '弯锚'} />
        {!colAnchor.canStraight && (
          <Row label="底部弯折长度" value={`${colAnchor.bendLength} mm`} />
        )}
        <div className="text-[11px] mt-1 px-2 py-1 rounded bg-blue-50 text-blue-700">
          {colAnchor.canStraight
            ? `直锚：laE=${laECol}mm ≤ h-c=${params.h - cover}mm，满足直锚条件 (22G101-3 §2-10)`
            : `弯锚：laE=${laECol}mm > h-c=${params.h - cover}mm，需底部弯折${colAnchor.bendLength}mm (22G101-3 §2-10)`}
        </div>
      </RuleCard>

      {/* Code reference note */}
      <div className="text-[11px] text-muted bg-gray-50 rounded-lg p-3 leading-relaxed border border-gray-100">
        <p className="font-semibold text-primary mb-1">构造说明 (22G101-3)</p>
        <p>· 桩顶嵌入承台高度 h：桩径/边长 {'<'} 800mm 取 50mm；≥ 800mm 取 100mm。</p>
        <p>· 受力筋端部：直段 ≥ 25d+0.1D（圆桩）时须弯折 12d；直段 ≥ 35d+0.1D 时可不弯折。</p>
        <p>· d {'>'} 25mm 带肋钢筋锚固长度需乘以 1.1 修正系数。</p>
        <p>· 柱插筋锚固：laE ≤ h承台 - c 时可直锚；否则底部须弯折（弯折长度按 §2-10 确定）。</p>
      </div>
    </div>
  );
}
