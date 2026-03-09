'use client';

import { useState } from 'react';
import type { BeamParams, ColumnParams, SlabParams, ShearWallParams, StairParams } from '@/lib/types';
import { parseRebar, parseStirrup, parseSlabRebar, parseSideBar, gradeLabel } from '@/lib/rebar';
import { calcAnchorAll, calcSupportRebarLength, calcSlabBottomAnchor, calcColumnLapZone, calcLaE, calcLlE, calcBendLength, calcBeamEndAnchor, calcBottomBarLapAtMiddleJoint } from '@/lib/anchor';

function ExplainSection({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-gray-100 pt-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-1 cursor-pointer"
        type="button"
      >
        <span className="text-xs font-medium text-gray-500">{title}</span>
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="space-y-2 pt-1 pb-1">{children}</div>}
    </div>
  );
}

export function BeamExplain({ params }: { params: BeamParams }) {
  const topR = parseRebar(params.top);
  const botR = parseRebar(params.bottom);
  const stir = parseStirrup(params.stirrup);
  const leftR = params.leftSupport ? parseRebar(params.leftSupport) : null;
  const rightR = params.rightSupport ? parseRebar(params.rightSupport) : null;
  const anchorTop = calcAnchorAll(topR.grade, topR.diameter, params.concreteGrade, params.seismicGrade);
  const anchorBot = calcAnchorAll(botR.grade, botR.diameter, params.concreteGrade, params.seismicGrade);
  const supportLen = calcSupportRebarLength(params.spanLength || 4000);
  const supportLen2 = calcSupportRebarLength(params.spanLength || 4000, 2);

  const hc = params.hc || 500;
  const cover = params.cover || 25;
  const topEndAnchor = calcBeamEndAnchor(topR.grade, topR.diameter, params.concreteGrade, params.seismicGrade, hc, cover);
  const botEndAnchor = calcBeamEndAnchor(botR.grade, botR.diameter, params.concreteGrade, params.seismicGrade, hc, cover);
  const denseZone = Math.max(2 * params.h, 500);
  const midJointLap = calcBottomBarLapAtMiddleJoint(botR.grade, botR.diameter, params.concreteGrade, params.seismicGrade, params.h, cover);

  return (
    <div className="space-y-2 text-sm">
      <div className="p-3 bg-blue-50 rounded-lg">
        <p className="font-semibold text-primary">{params.id}</p>
        <p className="text-xs text-muted mt-1">框架梁，括号内数字表示跨数</p>
      </div>
      <div className="p-3 bg-gray-50 rounded-lg">
        <p className="font-medium">截面: {params.b}×{params.h}mm</p>
        <p className="text-xs text-muted mt-1">宽 {params.b}mm，高 {params.h}mm，柱宽 hc={hc}mm</p>
      </div>

      <ExplainSection title="集中标注" defaultOpen>
        <div className="p-3 bg-red-50 rounded-lg">
          <p className="font-medium text-red-800">上部通长筋: {params.top}</p>
          <p className="text-xs text-red-600 mt-1">{topR.count} 根 {gradeLabel(topR.grade)} Φ{topR.diameter}</p>
        </div>
        <div className="p-3 bg-red-50 rounded-lg">
          <p className="font-medium text-red-800">下部通长筋: {params.bottom}</p>
          <p className="text-xs text-red-600 mt-1">{botR.count} 根 {gradeLabel(botR.grade)} Φ{botR.diameter}</p>
        </div>
        <div className="p-3 bg-green-50 rounded-lg">
          <p className="font-medium text-green-800">箍筋: {params.stirrup}</p>
          <p className="text-xs text-green-600 mt-1">
            {gradeLabel(stir.grade)} Φ{stir.diameter}，加密区 {stir.spacingDense}mm，非加密区 {stir.spacingNormal}mm，{stir.legs} 肢箍
          </p>
          <p className="text-xs text-green-600 mt-0.5">加密区长度: max(2h, 500) = {denseZone}mm</p>
        </div>
      </ExplainSection>

      {params.sideBar && (() => {
        const sideInfo = parseSideBar(params.sideBar);
        if (!sideInfo) return null;
        const perSide = Math.ceil(sideInfo.count / 2);
        const prefixLabel = sideInfo.prefix === 'G' ? '构造腰筋' : '抗扭筋';
        return (
          <ExplainSection title="腰筋/抗扭筋" defaultOpen>
            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="font-medium text-blue-800">{prefixLabel}: {params.sideBar}</p>
              <p className="text-xs text-blue-600 mt-1">
                {sideInfo.count} 根(每侧{perSide}根) {gradeLabel(sideInfo.grade)} Φ{sideInfo.diameter}，分布在梁两侧面
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                {sideInfo.prefix === 'G'
                  ? '22G101: 梁腹高 h ≥ 450mm 时需设构造腰筋，间距 ≤ 200mm'
                  : '22G101: 抗扭筋用于承担扭矩，计入抗扭计算'
                }
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                拉筋: {params.tieBar || 'A6(自动)'}，22G101: b≤350mm→A6，b&gt;350mm→同箍筋规格
              </p>
            </div>
          </ExplainSection>
        );
      })()}

      {(leftR || rightR) && (
        <ExplainSection title="原位标注">
          {leftR && (
            <div className="p-3 bg-purple-50 rounded-lg">
              <p className="font-medium text-purple-800">左支座负筋: {params.leftSupport}</p>
              <p className="text-xs text-purple-600 mt-1">{leftR.count} 根 {gradeLabel(leftR.grade)} Φ{leftR.diameter}，从支座伸入跨内</p>
              <p className="text-xs text-purple-600 mt-0.5">第一排: ln/3 = {supportLen}mm，第二排: ln/4 = {supportLen2}mm</p>
            </div>
          )}
          {rightR && (
            <div className="p-3 bg-purple-50 rounded-lg">
              <p className="font-medium text-purple-800">右支座负筋: {params.rightSupport}</p>
              <p className="text-xs text-purple-600 mt-1">{rightR.count} 根 {gradeLabel(rightR.grade)} Φ{rightR.diameter}，从支座伸入跨内</p>
              <p className="text-xs text-purple-600 mt-0.5">第一排: ln/3 = {supportLen}mm，第二排: ln/4 = {supportLen2}mm</p>
            </div>
          )}
        </ExplainSection>
      )}

      <ExplainSection title="端支座锚固">
        <div className="p-3 bg-cyan-50 rounded-lg">
          <p className="font-medium text-cyan-800">22G101 端支座锚固 ({params.concreteGrade}, {params.seismicGrade})</p>
          <div className="mt-1.5 space-y-1 text-xs text-cyan-700">
            <p className="font-medium">上部筋 Φ{topR.diameter} (laE={anchorTop.laE}mm):</p>
            {topEndAnchor.canStraight ? (
              <p className="ml-2">✓ 直锚: laE={anchorTop.laE}mm ≤ hc-c={hc - cover}mm → 直锚长度 max(laE, 0.5hc+5d) = {topEndAnchor.straightLen}mm</p>
            ) : (
              <>
                <p className="ml-2">✗ 直锚不满足: laE={anchorTop.laE}mm {'>'} hc-c={hc - cover}mm</p>
                <p className="ml-2">→ 弯锚: 直段 ≥ 0.4laE = {topEndAnchor.bentStraightPart}mm，弯折 15d = {topEndAnchor.bentBendPart}mm</p>
              </>
            )}
            <p className="font-medium mt-1">下部筋 Φ{botR.diameter} (laE={anchorBot.laE}mm):</p>
            {botEndAnchor.canStraight ? (
              <p className="ml-2">✓ 直锚: laE={anchorBot.laE}mm ≤ hc-c={hc - cover}mm → 直锚长度 {botEndAnchor.straightLen}mm</p>
            ) : (
              <>
                <p className="ml-2">✗ 直锚不满足: laE={anchorBot.laE}mm {'>'} hc-c={hc - cover}mm</p>
                <p className="ml-2">→ 弯锚: 直段 {botEndAnchor.bentStraightPart}mm，弯折 15d = {botEndAnchor.bentBendPart}mm</p>
              </>
            )}
          </div>
        </div>
      </ExplainSection>

      <ExplainSection title="连接与搭接">
        <div className="p-3 bg-teal-50 rounded-lg">
          <p className="font-medium text-teal-800">22G101 连接与搭接</p>
          <div className="mt-1.5 space-y-1 text-xs text-teal-700">
            <p>上部筋连接位置: 跨中 ln/3 范围内</p>
            <p>下部筋连接位置: 支座 ln/3 范围内</p>
            <p>搭接面积百分率 ≤ 50%</p>
            <p>搭接长度 llE = {anchorTop.llE}mm</p>
            <p>中间节点下部筋搭接: ≥ max(llE, 1.5h₀) = {midJointLap}mm</p>
            <p>架立筋与非贯通筋搭接 ≥ 150mm</p>
          </div>
        </div>
      </ExplainSection>

      {params.haunchType && params.haunchType !== 'none' && (
        <ExplainSection title="加腋构造 (22G101 2-36)" defaultOpen>
          <div className="p-3 bg-orange-50 rounded-lg">
            <p className="font-medium text-orange-800">
              {params.haunchType === 'horizontal' ? '水平加腋' : '竖向加腋'}
              {' · '}{params.haunchSide === 'both' ? '两端' : params.haunchSide === 'left' ? '左端' : '右端'}
            </p>
            <div className="mt-1.5 space-y-1 text-xs text-orange-700">
              <p>加腋长度 c₁ = {params.haunchLength}mm</p>
              <p>{params.haunchType === 'horizontal' ? '加腋高度' : '加腋宽度'} c₂ = {params.haunchHeight}mm</p>
              {params.haunchType === 'horizontal' && (() => {
                const botR = parseRebar(params.bottom);
                const laE = calcLaE(botR.grade, botR.diameter, params.concreteGrade, params.seismicGrade);
                const h0 = params.h - (params.cover || 25) - botR.diameter / 2;
                const hbCoeff = params.seismicGrade === '一级' ? 2.0 : 1.5;
                const denseZone1 = Math.max(hbCoeff * params.h, 500, params.haunchLength + 0.5 * h0);
                return (
                  <>
                    <p className="font-medium mt-1.5">附加筋:</p>
                    <p className="ml-2">直径同梁底纵筋第一排: Φ{botR.diameter}</p>
                    <p className="ml-2">柱内锚固 ≥ laE = {laE}mm</p>
                    <p className="ml-2">沿加腋斜面延伸入梁内 ≥ laE = {laE}mm</p>
                    <p className="font-medium mt-1.5">箍筋加密区1:</p>
                    <p className="ml-2">{params.seismicGrade === '一级' ? '一级' : '二~四级'}: ≥ {hbCoeff}h<sub>b</sub> = {Math.round(hbCoeff * params.h)}mm</p>
                    <p className="ml-2">且 ≥ 500mm</p>
                    <p className="ml-2">且 ≥ c₁ + 0.5h₀ = {params.haunchLength} + {Math.round(0.5 * h0)} = {Math.round(params.haunchLength + 0.5 * h0)}mm</p>
                    <p className="ml-2 font-medium">取值: {Math.round(denseZone1)}mm</p>
                    <p className="ml-2">加腋部位箍筋规格及肢距同梁端箍筋</p>
                  </>
                );
              })()}
              {params.haunchType === 'vertical' && (
                <>
                  <p className="font-medium mt-1">竖向加腋构造:</p>
                  <p className="ml-2">加腋区箍筋加密区同水平加腋</p>
                  <p className="ml-2">附加筋直径分别同梁内上下纵筋</p>
                </>
              )}
            </div>
          </div>
        </ExplainSection>
      )}

      <ExplainSection title="识图要点">
        <div className="p-3 bg-amber-50 rounded-lg">
          <p className="font-medium text-amber-800">识图要点 (22G101-1)</p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-700 list-disc list-inside">
            <li>集中标注适用于梁全跨，原位标注仅在标注位置有效</li>
            <li>原位标注优先级高于集中标注</li>
            <li>端支座: 直锚条件 laE ≤ hc - 保护层</li>
            <li>弯锚: 伸至柱外侧纵筋内侧，弯折15d</li>
            <li>支座负筋第一排 ln/3，第二排 ln/4</li>
            <li>箍筋加密区 = max(2h, 500mm) 从柱面起</li>
            <li>hc = 柱截面沿框架方向的宽度</li>
          </ul>
        </div>
      </ExplainSection>
    </div>
  );
}

export function ColumnExplain({ params }: { params: ColumnParams }) {
  const mainR = parseRebar(params.main);
  const stir = parseStirrup(params.stirrup);
  const anchor = calcAnchorAll(mainR.grade, mainR.diameter, params.concreteGrade, params.seismicGrade);
  const lapZone = calcColumnLapZone(params.height || 3000);

  return (
    <div className="space-y-2 text-sm">
      <div className="p-3 bg-blue-50 rounded-lg">
        <p className="font-semibold text-primary">{params.id}</p>
        <p className="text-xs text-muted mt-1">框架柱</p>
      </div>
      <div className="p-3 bg-gray-50 rounded-lg">
        <p className="font-medium">截面: {params.b}×{params.h}mm</p>
      </div>

      <ExplainSection title="配筋" defaultOpen>
        <div className="p-3 bg-red-50 rounded-lg">
          <p className="font-medium text-red-800">全部纵筋: {params.main}</p>
          <p className="text-xs text-red-600 mt-1">{mainR.count} 根 {gradeLabel(mainR.grade)} Φ{mainR.diameter}，沿截面周边均匀布置</p>
        </div>
        <div className="p-3 bg-green-50 rounded-lg">
          <p className="font-medium text-green-800">箍筋: {params.stirrup}</p>
          <p className="text-xs text-green-600 mt-1">
            {gradeLabel(stir.grade)} Φ{stir.diameter}，加密区 {stir.spacingDense}mm，非加密区 {stir.spacingNormal}mm，{stir.legs} 肢箍
          </p>
        </div>
      </ExplainSection>

      <ExplainSection title="锚固/搭接">
        <div className="p-3 bg-cyan-50 rounded-lg">
          <p className="font-medium text-cyan-800">锚固/搭接计算 ({params.concreteGrade}, {params.seismicGrade})</p>
          <div className="mt-1.5 space-y-1 text-xs text-cyan-700">
            <p>Φ{mainR.diameter}: lab={anchor.lab}mm, la={anchor.la}mm, laE={anchor.laE}mm</p>
            <p>搭接: ll={anchor.ll}mm, llE={anchor.llE}mm</p>
            <p>搭接区域: 柱根 {lapZone.start}mm ~ {lapZone.end}mm</p>
            <p>保护层厚度: {params.cover}mm</p>
          </div>
        </div>
      </ExplainSection>

      <ExplainSection title="识图要点">
        <div className="p-3 bg-amber-50 rounded-lg">
          <p className="font-medium text-amber-800">识图要点</p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-700 list-disc list-inside">
            <li>纵筋沿截面周边均匀分布</li>
            <li>箍筋加密区在柱端（塑性铰区域）</li>
            <li>加密区长度取 Hn/6、500mm、hc 三者最大值</li>
            <li>角筋必须有箍筋弯钩固定</li>
          </ul>
        </div>
      </ExplainSection>
    </div>
  );
}

export function SlabExplain({ params }: { params: SlabParams }) {
  const bx = parseSlabRebar(params.bottomX);
  const by = parseSlabRebar(params.bottomY);
  const tx = params.topX ? parseSlabRebar(params.topX) : null;
  const ty = params.topY ? parseSlabRebar(params.topY) : null;
  const dist = parseSlabRebar(params.distribution);
  const bxAnchor = calcSlabBottomAnchor(bx.grade, bx.diameter, params.concreteGrade);
  const byAnchor = calcSlabBottomAnchor(by.grade, by.diameter, params.concreteGrade);

  return (
    <div className="space-y-2 text-sm">
      <div className="p-3 bg-blue-50 rounded-lg">
        <p className="font-semibold text-primary">{params.id}</p>
        <p className="text-xs text-muted mt-1">楼板，板厚 {params.thickness}mm</p>
      </div>

      <ExplainSection title="底筋" defaultOpen>
        <div className="p-3 bg-red-50 rounded-lg">
          <p className="font-medium text-red-800">X向底筋: {params.bottomX}</p>
          <p className="text-xs text-red-600 mt-1">{gradeLabel(bx.grade)} Φ{bx.diameter}@{bx.spacing}，受力方向</p>
        </div>
        <div className="p-3 bg-orange-50 rounded-lg">
          <p className="font-medium text-orange-800">Y向底筋: {params.bottomY}</p>
          <p className="text-xs text-orange-600 mt-1">{gradeLabel(by.grade)} Φ{by.diameter}@{by.spacing}</p>
        </div>
      </ExplainSection>

      {(tx || ty) && (
        <ExplainSection title="面筋">
          {tx && (
            <div className="p-3 bg-purple-50 rounded-lg">
              <p className="font-medium text-purple-800">X向面筋: {params.topX}</p>
              <p className="text-xs text-purple-600 mt-1">{gradeLabel(tx.grade)} Φ{tx.diameter}@{tx.spacing}</p>
            </div>
          )}
          {ty && (
            <div className="p-3 bg-purple-50 rounded-lg">
              <p className="font-medium text-purple-800">Y向面筋: {params.topY}</p>
              <p className="text-xs text-purple-600 mt-1">{gradeLabel(ty.grade)} Φ{ty.diameter}@{ty.spacing}</p>
            </div>
          )}
        </ExplainSection>
      )}

      <ExplainSection title="分布筋">
        <div className="p-3 bg-green-50 rounded-lg">
          <p className="font-medium text-green-800">分布筋: {params.distribution}</p>
          <p className="text-xs text-green-600 mt-1">{gradeLabel(dist.grade)} Φ{dist.diameter}@{dist.spacing}，垂直于受力筋方向</p>
        </div>
      </ExplainSection>

      <ExplainSection title="锚固计算">
        <div className="p-3 bg-cyan-50 rounded-lg">
          <p className="font-medium text-cyan-800">锚固计算 ({params.concreteGrade})</p>
          <div className="mt-1.5 space-y-1 text-xs text-cyan-700">
            <p>X底筋伸入支座: {bxAnchor}mm (≥5d 且 ≥la/2)</p>
            <p>Y底筋伸入支座: {byAnchor}mm</p>
            <p>保护层厚度: {params.cover}mm</p>
          </div>
        </div>
      </ExplainSection>

      <ExplainSection title="识图要点">
        <div className="p-3 bg-amber-50 rounded-lg">
          <p className="font-medium text-amber-800">识图要点</p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-700 list-disc list-inside">
            <li>底筋在下，面筋在上，短方向筋在外侧</li>
            <li>板底筋伸入支座长度不小于 5d</li>
            <li>面筋一般在支座处设置，承受负弯矩</li>
            <li>分布筋垂直于受力筋，间距不大于 250mm</li>
          </ul>
        </div>
      </ExplainSection>
    </div>
  );
}

export function JointExplain({ params }: { params: import('@/lib/types').JointParams }) {
  const colR = parseRebar(params.colMain);
  const colStir = parseStirrup(params.colStirrup);
  const beamTopR = parseRebar(params.beamTop);
  const beamBotR = parseRebar(params.beamBottom);
  const laE = calcLaE(beamTopR.grade, beamTopR.diameter, params.concreteGrade, params.seismicGrade);
  const bendLen = calcBendLength(beamTopR.diameter);

  const jointTypeLabel = { middle: '中间节点', side: '边节点', corner: '角节点' };
  const anchorLabel = params.anchorType === 'bent' ? '弯锚' : '直锚';

  return (
    <div className="space-y-2 text-sm">
      <div className="p-3 bg-blue-50 rounded-lg">
        <p className="font-semibold text-primary">{jointTypeLabel[params.jointType]} · {anchorLabel}</p>
        <p className="text-xs text-muted mt-1">
          {params.jointType === 'middle' ? '柱两侧均有梁，梁筋可贯穿节点' : '柱一侧有梁，梁筋需锚入柱内'}
        </p>
      </div>

      <ExplainSection title="柱参数" defaultOpen>
        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="font-medium">柱截面: {params.colB}×{params.colH}mm</p>
        </div>
        <div className="p-3 bg-red-50 rounded-lg">
          <p className="font-medium text-red-800">柱纵筋: {params.colMain}</p>
          <p className="text-xs text-red-600 mt-1">{colR.count} 根 {gradeLabel(colR.grade)} Φ{colR.diameter}，贯穿节点区</p>
        </div>
      </ExplainSection>

      <ExplainSection title="梁参数" defaultOpen>
        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="font-medium">梁截面: {params.beamB}×{params.beamH}mm</p>
        </div>
        <div className="p-3 bg-red-50 rounded-lg">
          <p className="font-medium text-red-800">梁上部筋: {params.beamTop}</p>
          <p className="text-xs text-red-600 mt-1">{beamTopR.count} 根 Φ{beamTopR.diameter}，{anchorLabel}入柱</p>
        </div>
        <div className="p-3 bg-blue-50 rounded-lg">
          <p className="font-medium text-blue-800">梁下部筋: {params.beamBottom}</p>
          <p className="text-xs text-blue-600 mt-1">{beamBotR.count} 根 Φ{beamBotR.diameter}，{anchorLabel}入柱</p>
        </div>
      </ExplainSection>

      <ExplainSection title="节点构造">
        <div className="p-3 bg-orange-50 rounded-lg">
          <p className="font-medium text-orange-800">节点区箍筋</p>
          <p className="text-xs text-orange-600 mt-1">
            {gradeLabel(colStir.grade)} Φ{colStir.diameter}@{colStir.spacingDense}，节点区箍筋同柱端加密区
          </p>
        </div>
        {params.anchorType === 'bent' && (
          <div className="p-3 bg-purple-50 rounded-lg">
            <p className="font-medium text-purple-800">弯锚构造</p>
            <p className="text-xs text-purple-600 mt-1">
              梁筋伸入柱内，弯折段长度 15d = {bendLen}mm，弯折角度 90°
            </p>
          </div>
        )}
      </ExplainSection>

      <ExplainSection title="锚固计算">
        <div className="p-3 bg-cyan-50 rounded-lg">
          <p className="font-medium text-cyan-800">锚固计算 ({params.concreteGrade}, {params.seismicGrade})</p>
          <div className="mt-1.5 space-y-1 text-xs text-cyan-700">
            <p>梁筋 Φ{beamTopR.diameter}: laE={laE}mm</p>
            <p>弯折段: 15d = {bendLen}mm</p>
            <p>保护层厚度: {params.cover}mm</p>
          </div>
        </div>
      </ExplainSection>

      <ExplainSection title="识图要点">
        <div className="p-3 bg-amber-50 rounded-lg">
          <p className="font-medium text-amber-800">识图要点</p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-700 list-disc list-inside">
            <li>节点核心区箍筋必须加密，间距同柱端加密区</li>
            <li>柱纵筋贯穿节点区，不得在节点区内连接</li>
            <li>梁上部筋弯锚时弯折段朝下，下部筋弯折段朝上</li>
            <li>直锚长度 ≥ laE = {laE}mm</li>
            <li>当柱截面宽度不足时必须采用弯锚</li>
            <li>中间节点梁筋可贯穿，边节点必须锚固</li>
          </ul>
        </div>
      </ExplainSection>
    </div>
  );
}

export function ShearWallExplain({ params }: { params: ShearWallParams }) {
  const vert = parseSlabRebar(params.vertBar);
  const horiz = parseSlabRebar(params.horizBar);
  const boundaryR = parseRebar(params.boundaryMain);
  const boundaryStir = parseStirrup(params.boundaryStirrup);
  const BL = Math.max(params.bw, 400);
  const llE = calcLlE(boundaryR.grade, boundaryR.diameter, params.concreteGrade, params.seismicGrade);

  return (
    <div className="space-y-2 text-sm">
      <div className="p-3 bg-blue-50 rounded-lg">
        <p className="font-semibold text-primary">{params.id}</p>
        <p className="text-xs text-muted mt-1">剪力墙，墙厚 {params.bw}mm</p>
      </div>
      <div className="p-3 bg-gray-50 rounded-lg">
        <p className="font-medium">墙体: {params.bw}×{params.lw}mm，净高 {params.hw}mm</p>
      </div>

      <ExplainSection title="分布筋" defaultOpen>
        <div className="p-3 bg-red-50 rounded-lg">
          <p className="font-medium text-red-800">竖向分布筋: {params.vertBar}</p>
          <p className="text-xs text-red-600 mt-1">{gradeLabel(vert.grade)} Φ{vert.diameter}@{vert.spacing}，双排布置（两侧各一排）</p>
        </div>
        <div className="p-3 bg-blue-50 rounded-lg">
          <p className="font-medium text-blue-800">水平分布筋: {params.horizBar}</p>
          <p className="text-xs text-blue-600 mt-1">{gradeLabel(horiz.grade)} Φ{horiz.diameter}@{horiz.spacing}，双排布置</p>
          <p className="text-xs text-blue-600 mt-0.5">底部加密区: max(hn/6, 500mm)</p>
        </div>
      </ExplainSection>

      <ExplainSection title="约束边缘构件 (YBZ)">
        <div className="p-3 bg-purple-50 rounded-lg">
          <p className="font-medium text-purple-800">纵筋: {params.boundaryMain}</p>
          <p className="text-xs text-purple-600 mt-1">{boundaryR.count}根 {gradeLabel(boundaryR.grade)} Φ{boundaryR.diameter}，两端各一组</p>
          <p className="text-xs text-purple-600 mt-0.5">边缘构件长度: max(bw, 400) = {BL}mm</p>
        </div>
        <div className="p-3 bg-green-50 rounded-lg">
          <p className="font-medium text-green-800">箍筋: {params.boundaryStirrup}</p>
          <p className="text-xs text-green-600 mt-1">
            {gradeLabel(boundaryStir.grade)} Φ{boundaryStir.diameter}@{boundaryStir.spacingDense}，全高加密
          </p>
        </div>
      </ExplainSection>

      <ExplainSection title="锚固/搭接">
        <div className="p-3 bg-cyan-50 rounded-lg">
          <p className="font-medium text-cyan-800">锚固/搭接 ({params.concreteGrade}, {params.seismicGrade})</p>
          <div className="mt-1.5 space-y-1 text-xs text-cyan-700">
            <p>边缘构件纵筋搭接: llE = {llE}mm</p>
            <p>竖向分布筋搭接: ≥ 1.2la</p>
            <p>水平分布筋锚入边缘构件: ≥ laE</p>
            <p>保护层厚度: {params.cover}mm</p>
          </div>
        </div>
      </ExplainSection>

      <ExplainSection title="识图要点">
        <div className="p-3 bg-amber-50 rounded-lg">
          <p className="font-medium text-amber-800">识图要点 (22G101-1)</p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-700 list-disc list-inside">
            <li>分布筋双排布置，拉筋连接两排</li>
            <li>约束边缘构件 (YBZ) 箍筋全高加密</li>
            <li>构造边缘构件 (GBZ) 箍筋可不加密</li>
            <li>水平分布筋伸入边缘构件内锚固</li>
            <li>竖向分布筋搭接位置错开，同一截面 ≤ 50%</li>
            <li>墙身水平筋在边缘构件范围内的间距同墙身</li>
          </ul>
        </div>
      </ExplainSection>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 楼梯标注解读 (22G101-2 AT型)
// ═══════════════════════════════════════════════════════════════════

export function StairExplain({ params }: { params: StairParams }) {
  const botR = parseSlabRebar(params.bottomBar);
  const topR = parseSlabRebar(params.topBar);
  const distR = parseSlabRebar(params.distBar);
  const totalRise = params.stepCount * params.stepHeight;
  const totalRun = params.stepCount * params.stepWidth;
  const angle = (Math.atan2(totalRise, totalRun) * 180 / Math.PI).toFixed(1);
  const slabLen = Math.round(Math.sqrt(totalRise * totalRise + totalRun * totalRun));

  return (
    <div className="space-y-2 text-sm">
      <div className="p-3 bg-blue-50 rounded-lg">
        <p className="font-semibold text-primary">{params.id}</p>
        <p className="text-xs text-muted mt-1">AT型板式楼梯 (22G101-2)</p>
      </div>
      <div className="p-3 bg-gray-50 rounded-lg">
        <p className="font-medium">AT{params.stepCount}×{params.stepHeight}/{params.stepWidth}</p>
        <p className="text-xs text-muted mt-1">
          {params.stepCount}步 · 踏步高{params.stepHeight}mm · 踏步宽{params.stepWidth}mm
        </p>
        <p className="text-xs text-muted mt-0.5">
          总升高 {totalRise}mm · 水平长 {totalRun}mm · 倾角 {angle}° · 斜长 {slabLen}mm
        </p>
      </div>

      <ExplainSection title="标注解读" defaultOpen>
        <div className="p-3 bg-red-50 rounded-lg">
          <p className="font-medium text-red-800">下部纵筋: {params.bottomBar}</p>
          <p className="text-xs text-red-600 mt-1">
            {gradeLabel(botR.grade)} Φ{botR.diameter}@{botR.spacing}，沿梯板底面斜向布置
          </p>
          <p className="text-xs text-red-600 mt-0.5">
            22G101-2: 纵筋从低端梯梁（梯板低端支座）处锚入，沿梯板底面至高端梯梁（梯板高端支座）锚入
          </p>
        </div>
        <div className="p-3 bg-purple-50 rounded-lg">
          <p className="font-medium text-purple-800">上部纵筋: {params.topBar}</p>
          <p className="text-xs text-purple-600 mt-1">
            {gradeLabel(topR.grade)} Φ{topR.diameter}@{topR.spacing}，沿梯板顶面（踏步面下方）布置
          </p>
        </div>
        <div className="p-3 bg-green-50 rounded-lg">
          <p className="font-medium text-green-800">分布筋: {params.distBar}</p>
          <p className="text-xs text-green-600 mt-1">
            {gradeLabel(distR.grade)} Φ{distR.diameter}@{distR.spacing}，垂直于纵筋方向
          </p>
          <p className="text-xs text-green-600 mt-0.5">
            22G101-2: 上下两层分布筋，沿梯板斜面等间距布置
          </p>
        </div>
      </ExplainSection>

      <ExplainSection title="梯板与平台">
        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="font-medium text-gray-800">梯板</p>
          <p className="text-xs text-gray-600 mt-1">梯板厚 {params.slabThickness}mm · 梯段宽 {params.flightWidth}mm</p>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="font-medium text-gray-800">平台板</p>
          <p className="text-xs text-gray-600 mt-1">
            上平台长 {params.topPlatformLen}mm · 下平台长 {params.botPlatformLen}mm · 厚 {params.platformThickness}mm
          </p>
        </div>
        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="font-medium text-gray-800">梯梁（梯板端支座）</p>
          <p className="text-xs text-gray-600 mt-1">
            截面 {params.beamB}×{params.beamH}mm（低端/高端各一根）
          </p>
        </div>
      </ExplainSection>

      <ExplainSection title="构造要求">
        <div className="p-3 bg-amber-50 rounded-lg">
          <p className="font-medium text-amber-800">22G101-2 AT型构造要点</p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-700 list-disc list-inside">
            <li>梯板厚度一般取 L/25~L/30（L为梯板斜长）</li>
            <li>下部纵筋锚入梯梁（梯板端支座）内 ≥ la（受拉锚固长度）</li>
            <li>上部纵筋伸入平台 ≥ ln/4（ln为梯板净跨）</li>
            <li>分布筋间距 ≤ 250mm，直径不小于 6mm</li>
            <li>踏步高 h 宜为 150~175mm，2h+b ≈ 600mm</li>
            <li>保护层厚度：室内环境 15mm，室外 20mm</li>
          </ul>
        </div>
      </ExplainSection>

      <ExplainSection title="识图要点">
        <div className="p-3 bg-amber-50 rounded-lg">
          <p className="font-medium text-amber-800">识图要点 (22G101-2)</p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-700 list-disc list-inside">
            <li>AT型: 板式楼梯，梯板为受弯构件</li>
            <li>注写方式: AT+踏步数×踏步高/踏步宽</li>
            <li>剖面注写: 标注梯板厚度和配筋</li>
            <li>梯梁（梯板端支座梁）单独标注截面和配筋</li>
            <li>梯板纵筋沿行走方向布置，分布筋垂直于纵筋</li>
          </ul>
        </div>
      </ExplainSection>
    </div>
  );
}
