'use client';

import type { FoundationParams } from '@/lib/types';
import { parseSlabRebar, parseRebar, gradeLabel } from '@/lib/rebar';
import {
  calcLaTable, calcLaETable,
  ANCHOR_LARGE_DIA_THRESHOLD,
} from '@/lib/anchor';
import { determineColFoundAnchor } from '@/lib/construction-rules';
import type { ConcreteGrade, SeismicGrade } from '@/lib/anchor';

/* ─── UI atoms ─── */
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

function ResultBanner({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className={`text-[11px] mt-1 px-2 py-1 rounded ${ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
      {text}
    </div>
  );
}

/* ─── Bottom bar end check for independent footing ─── */
interface BottomBarEndResult {
  extLen: number;        // extension from col face to edge
  la: number;
  meetsLa: boolean;     // extLen >= la → bar clears la requirement
  bendPart: number;     // 12d bend if doesn't meet (conservative)
  description: string;
}

function checkFoundationBottomBarEnd(
  extLen: number,
  la: number,
  d: number,
): BottomBarEndResult {
  const meetsLa = extLen >= la;
  const bendPart = meetsLa ? 0 : 12 * d;
  return {
    extLen,
    la,
    meetsLa,
    bendPart,
    description: meetsLa
      ? `底筋伸至基础边缘，外延${extLen}mm ≥ la${la}mm，端部满足锚固 (22G101-3 §2-2)`
      : `底筋外延${extLen}mm < la${la}mm，端部需弯折12d=${bendPart}mm (22G101-3 §2-2)`,
  };
}

/* ─── Main panel ─── */
export function FoundationAnchorPanel({ params }: { params: FoundationParams }) {
  const cover = params.cover || 40;
  const concreteGrade = params.concreteGrade as ConcreteGrade;
  const seismicGrade = (params.seismicGrade || '三级') as SeismicGrade;
  const isDual = (params.columnCount || 1) === 2;

  const barX = parseSlabRebar(params.bottomBarX);
  const barY = parseSlabRebar(params.bottomBarY);
  const colR = parseRebar(params.colMain);

  // Anchor lengths
  const laX = calcLaTable(barX.grade, barX.diameter, concreteGrade);
  const laY = calcLaTable(barY.grade, barY.diameter, concreteGrade);
  const largeDiaX = barX.diameter > ANCHOR_LARGE_DIA_THRESHOLD;
  const largeDiaY = barY.diameter > ANCHOR_LARGE_DIA_THRESHOLD;

  // Bottom bar extension from column face to foundation edge
  const extX = (params.bx - params.colBx) / 2;
  const extY = (params.by - params.colBy) / 2;
  const endX = checkFoundationBottomBarEnd(extX, laX, barX.diameter);
  const endY = checkFoundationBottomBarEnd(extY, laY, barY.diameter);

  // Large foundation alternating bar shortening rule (22G101-3 §2-2)
  // When bx (or by) >= 2500mm, alternate bars can be shortened to 0.9*L
  const largeX = params.bx >= 2500;
  const largeY = params.by >= 2500;
  const shortLenX = largeX ? Math.ceil(params.bx * 0.9) : null;
  const shortLenY = largeY ? Math.ceil(params.by * 0.9) : null;

  // Column insert anchor
  const laECol = calcLaETable(colR.grade, colR.diameter, concreteGrade, seismicGrade);
  const colAnchor = determineColFoundAnchor(params.h, cover, colR.diameter, laECol);

  // Foundation shape summary
  const topDim = params.stepDims.length > 0
    ? params.stepDims[params.stepDims.length - 1]
    : { bx: params.colBx + 200, by: params.colBy + 200, h: 0 };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-primary">
        独立基础锚固构造检查 — 22G101-3
        <span className="text-xs font-normal text-muted ml-2">
          ({params.shape === 'tapered' ? '锥形' : `${params.stepCount}阶阶形`}{isDual ? ' · 双柱' : ''})
        </span>
      </h2>

      {/* Anchor length summary */}
      <RuleCard title="底筋锚固长度 (查表法)">
        <Row label={`X向底筋 ${gradeLabel(barX.grade)} Φ${barX.diameter}`}
          value={`la = ${laX} mm`}
          note={largeDiaX ? `d=${barX.diameter}>${ANCHOR_LARGE_DIA_THRESHOLD}mm，已×1.1修正` : `${concreteGrade}`} />
        <Row label={`Y向底筋 ${gradeLabel(barY.grade)} Φ${barY.diameter}`}
          value={`la = ${laY} mm`}
          note={largeDiaY ? `d=${barY.diameter}>${ANCHOR_LARGE_DIA_THRESHOLD}mm，已×1.1修正` : undefined} />
        <Row label="参考依据" value="22G101-3 §2-2/2-3" />
      </RuleCard>

      {/* X-direction bottom bar end */}
      <RuleCard
        title="X向底筋端部构造"
        badge={endX.meetsLa ? '满足直锚' : '需端弯折'}
        badgeOk={endX.meetsLa}
      >
        <Row label="基础底面 bx" value={`${params.bx} mm`} />
        <Row label="柱截面 colBx" value={`${params.colBx} mm`} />
        <Row label="柱边至基础边缘" value={`${extX} mm`} note="= (bx - colBx) / 2" />
        <Row label="锚固长度 la" value={`${laX} mm`} />
        {!endX.meetsLa && <Row label="端部弯折 12d" value={`${endX.bendPart} mm`} />}
        <ResultBanner ok={endX.meetsLa} text={endX.description} />
      </RuleCard>

      {/* Y-direction bottom bar end */}
      <RuleCard
        title="Y向底筋端部构造"
        badge={endY.meetsLa ? '满足直锚' : '需端弯折'}
        badgeOk={endY.meetsLa}
      >
        <Row label="基础底面 by" value={`${params.by} mm`} />
        <Row label="柱截面 colBy" value={`${params.colBy} mm`} />
        <Row label="柱边至基础边缘" value={`${extY} mm`} note="= (by - colBy) / 2" />
        <Row label="锚固长度 la" value={`${laY} mm`} />
        {!endY.meetsLa && <Row label="端部弯折 12d" value={`${endY.bendPart} mm`} />}
        <ResultBanner ok={endY.meetsLa} text={endY.description} />
      </RuleCard>

      {/* Large foundation bar shortening */}
      {(largeX || largeY) && (
        <RuleCard title="大尺寸基础底筋减短构造 (22G101-3 §2-2)">
          {largeX && shortLenX && (
            <Row label="X向 bx ≥ 2500mm" value={`隔一布一缩短为 ${shortLenX} mm`}
              note={`= 0.9 × ${params.bx} = ${shortLenX}mm，居中对齐`} />
          )}
          {largeY && shortLenY && (
            <Row label="Y向 by ≥ 2500mm" value={`隔一布一缩短为 ${shortLenY} mm`}
              note={`= 0.9 × ${params.by} = ${shortLenY}mm，居中对齐`} />
          )}
          <div className="text-[11px] mt-1 px-2 py-1 rounded bg-blue-50 text-blue-700">
            基础宽度 ≥ 2500mm 时，底筋可隔根缩短（缩短筋长 = 0.9L，居中布置），两端各留出半个间距，22G101-3 §2-2
          </div>
          {(params.shortenBottomBarX || params.shortenBottomBarY) && (
            <div className="text-[11px] mt-1 px-2 py-1 rounded bg-emerald-50 text-emerald-700">
              当前 3D 模型已显示：{[
                params.shortenBottomBarX ? 'X向底筋减短' : null,
                params.shortenBottomBarY ? 'Y向底筋减短' : null,
              ].filter(Boolean).join('，')}
            </div>
          )}
        </RuleCard>
      )}

      {/* Column insert anchor */}
      <RuleCard
        title="柱插筋在基础内锚固"
        badge={colAnchor.canStraight ? '直锚' : '弯锚'}
        badgeOk={colAnchor.canStraight}
      >
        <Row label="柱插筋" value={`${gradeLabel(colR.grade)} Φ${colR.diameter}`} />
        <Row label="抗震锚固长度 laE (查表)" value={`${laECol} mm`}
          note={`${concreteGrade} / ${seismicGrade}`} />
        <Row label="基础内可用高度 h-c" value={`${params.h - cover} mm`} />
        {!colAnchor.canStraight && (
          <Row label="底部弯折长度" value={`${colAnchor.bendLength} mm`} />
        )}
        <ResultBanner ok={colAnchor.canStraight} text={
          colAnchor.canStraight
            ? `直锚：laE=${laECol}mm ≤ h-c=${params.h - cover}mm (22G101-3 §2-10)`
            : `弯锚：laE=${laECol}mm > h-c=${params.h - cover}mm，底弯${colAnchor.bendLength}mm (22G101-3 §2-10)`
        } />
      </RuleCard>

      {/* Dual column top bar */}
      {isDual && params.topBarX && params.topBarY && (
        <RuleCard title="双柱基础顶部配筋 (22G101-3 §2-12)">
          <Row label="柱距" value={`${params.colSpacing ?? '—'} mm`} />
          <Row label="顶部纵向受力筋" value={params.topBarX} />
          {params.topBarXCount && <Row label="顶部纵向筋总根数" value={`${params.topBarXCount} 根`} />}
          <Row label="顶部分布筋" value={params.topBarY} />
          {params.topBandWidth && <Row label="顶部钢筋带宽" value={`${params.topBandWidth} mm`} />}
          <div className="text-[11px] mt-1 px-2 py-1 rounded bg-blue-50 text-blue-700">
            双柱联合基础顶部配筋在两柱之间受拉区布置，需满足 §2-12 连接与锚固要求
          </div>
        </RuleCard>
      )}

      {isDual && params.hasFoundationBeam && (
        <RuleCard title="双柱基础梁 JL (22G101-3 §2-13)">
          <Row label="梁截面" value={`${params.foundationBeamB || '—'} × ${params.foundationBeamH || '—'} mm`} />
          <Row label="底部纵筋" value={params.foundationBeamBottom || '未设置'} />
          <Row label="顶部纵筋" value={params.foundationBeamTop || '未设置'} />
          <Row
            label="端部外伸"
            value={
              params.foundationBeamEndType === 'bothSides'
                ? `双端外伸 ${params.foundationBeamOverhang || 0} mm`
                : params.foundationBeamEndType === 'oneSide'
                  ? `${params.foundationBeamOverhangSide === 'left' ? '左端' : '右端'}外伸 ${params.foundationBeamOverhang || 0} mm`
                  : '无外伸'
            }
          />
          <div className="text-[11px] mt-1 px-2 py-1 rounded bg-amber-50 text-amber-700">
            当前 3D 模型已显示基础梁与梁筋，用于辅助观察双柱基础与基础梁组合构造。
          </div>
        </RuleCard>
      )}

      {/* Foundation geometry summary */}
      <RuleCard title="基础几何参数">
        <Row label="底面尺寸" value={`${params.bx} × ${params.by} mm`} />
        <Row label="基础总高" value={`${params.h} mm`} />
        <Row label="台阶数 / 形状" value={params.shape === 'tapered' ? '锥形' : `${params.stepCount} 阶`} />
        {params.shape === 'stepped' && params.stepDims.length > 0 && (
          <Row label="顶阶尺寸" value={`${topDim.bx} × ${topDim.by} × ${topDim.h} mm`} />
        )}
        <Row label="保护层" value={`${cover} mm`} />
      </RuleCard>

      {/* Code note */}
      <div className="text-[11px] text-muted bg-gray-50 rounded-lg p-3 leading-relaxed border border-gray-100">
        <p className="font-semibold text-primary mb-1">图集依据 (22G101-3)</p>
        <p>· 底筋端部：柱边至基础边缘 ≥ la 时可直锚；否则需端部弯折 12d (§2-2)。</p>
        <p>· bx/by ≥ 2500mm 时：底筋可隔根缩短为 0.9L 居中布置 (§2-2)。</p>
        <p>· 柱插筋：laE ≤ h-c 时可直锚；否则底部弯折，弯折长度不小于 6d 且不小于 150mm (§2-10)。</p>
        <p>· d {'>'} 25mm 带肋钢筋锚固长度乘以 1.1 修正系数 (GB50010 §8.3.1)。</p>
      </div>
    </div>
  );
}
