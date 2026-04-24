'use client';

import type { StripFoundationParams } from '@/lib/types';
import { parseSlabRebar, gradeLabel } from '@/lib/rebar';

function RuleCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
      <div className="text-xs font-semibold text-primary">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted">{label}</span>
      <div className="text-right">
        <span className="font-medium text-primary">{value}</span>
        {note && <div className="text-[11px] text-muted">{note}</div>}
      </div>
    </div>
  );
}

export function StripFoundationRulePanel({ params }: { params: StripFoundationParams }) {
  const bottom = parseSlabRebar(params.bottomBar);
  const dist = parseSlabRebar(params.distBar);
  const top = params.topBar ? parseSlabRebar(params.topBar) : null;
  const topDist = params.topDistBar ? parseSlabRebar(params.topDistBar) : null;
  const localBottom = params.localBottomBar ? parseSlabRebar(params.localBottomBar) : null;
  const localTop = params.localTopBar ? parseSlabRebar(params.localTopBar) : null;
  const clearGap = params.supportCount === 2 && params.supportSpacing
    ? Math.max(params.supportSpacing - params.supportWidth, 0)
    : 0;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-primary">条形基础构造速查 — 22G101-3</h2>

      <RuleCard title="底板配筋注写">
        <Row label="B 注写" value={`${params.bottomBar} / ${params.distBar}`} note="底部横向受力筋 / 纵向分布筋" />
        <Row label="底部横向筋" value={`${gradeLabel(bottom.grade)} Φ${bottom.diameter}@${bottom.spacing}`} />
        <Row label="底部分布筋" value={`${gradeLabel(dist.grade)} Φ${dist.diameter}@${dist.spacing}`} />
        <div className="rounded bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
          条形基础底板常按 B: 横向受力钢筋 / 纵向分布钢筋 表达，详见 22G101-3 第 1-18~1-20 页。
        </div>
      </RuleCard>

      <RuleCard title="双梁 / 双墙之间顶部钢筋">
        <Row label="支承形式" value={`${params.supportCount === 2 ? '双' : '单'}${params.supportType === 'beam' ? '梁' : '墙'}`} />
        <Row label="支承宽度" value={`${params.supportWidth} mm`} />
        <Row label="支承中心距" value={params.supportSpacing ? `${params.supportSpacing} mm` : '—'} />
        <Row label="两支承内边净距" value={clearGap > 0 ? `${clearGap} mm` : '—'} note="= 中心距 - 支承宽度" />
        <Row label="T 注写" value={params.topBar ? `${params.topBar} / ${params.topDistBar || '未设'}` : '未设置'} note="顶部横向受力筋 / 顶部分布筋" />
        <div className={`rounded px-2 py-1 text-[11px] ${params.supportCount === 2 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
          {params.supportCount === 2
            ? '双梁或双墙共用底板时，顶部钢筋通常只在两梁(墙)之间的受拉区配置，图纸中应单独表达。详见 22G101-3 第 1-19~1-20、2-20~2-22 页。'
            : '单梁或单墙条基通常以底板 B 注写为主；若有特殊顶部钢筋要求，应通过原位标注或文字说明补充。'}
        </div>
      </RuleCard>

      <RuleCard title="与 JL / JCL 的关系">
        <Row label="当前条基类型" value={params.stripKind === 'beamPlate' ? '梁板式条形基础' : '板式条形基础'} />
        <Row label="相关详图" value="JL / JCL 构造" note="22G101-3 第 2-23~2-31 页" />
        <div className="rounded bg-violet-50 px-2 py-1 text-[11px] text-violet-700">
          条形基础一旦与基础梁 JL 或基础次梁 JCL 组合出现，就需要同时核对梁端外伸、连接区、变截面和两种箍筋构造，不能只看底板配筋。
        </div>
      </RuleCard>

      {params.supportType === 'beam' && (
        <RuleCard title="JL / JCL 当前细部筋">
          <Row label="JL 底筋" value={params.jlBottom || '未设置'} />
          <Row label="JL 顶筋" value={params.jlTop || '未设置'} />
          <Row label="JL 箍筋" value={params.jlStirrup || '未设置'} />
          <Row label="JL 外伸" value={params.jlEndType === 'bothSides' ? `双端外伸 ${params.jlOverhang || 0}mm` : params.jlEndType === 'oneSide' ? `${params.jlOverhangSide === 'left' ? '左端' : '右端'}外伸 ${params.jlOverhang || 0}mm` : '无外伸'} />
          <Row label="JCL" value={params.hasJcl ? `${params.jclCount || 1}道` : '未设置'} note={params.hasJcl ? `间距 ${params.jclSpacing || '—'}mm，截面 ${params.jclB || '—'}×${params.jclH || '—'}mm` : undefined} />
          {params.hasJcl && (
            <>
              <Row label="JCL 底筋" value={params.jclBottom || '未设置'} />
              <Row label="JCL 顶筋" value={params.jclTop || '未设置'} />
              <Row label="JCL 箍筋" value={params.jclStirrup || '未设置'} />
              <Row label="JCL 外伸" value={params.jclEndType === 'bothSides' ? `双端外伸 ${params.jclOverhang || 0}mm` : params.jclEndType === 'oneSide' ? `${params.jclOverhangSide === 'left' ? '下侧' : '上侧'}外伸 ${params.jclOverhang || 0}mm` : '无外伸'} />
            </>
          )}
          <div className="rounded bg-violet-50 px-2 py-1 text-[11px] text-violet-700">
            OCR 对照要点：基础主梁与基础次梁外伸部位底部第一排纵筋伸至梁端头并上弯，其余排伸至梁端头后截断；从第三排起非贯通纵筋伸出长度应由设计注明。对应 22G101-3 第 1-26、2-25、2-29 页。
          </div>
        </RuleCard>
      )}

      <RuleCard title="设计需写明">
        <ul className="list-disc list-inside space-y-1 text-xs text-gray-700">
          <li>双梁 / 双墙之间顶部钢筋及其锚固做法。</li>
          <li>基础梁相交处同层交叉纵筋的上下关系。</li>
          <li>当底部纵筋多于两排时，从第三排起非贯通筋伸入跨内的长度值。</li>
        </ul>
        <div className="rounded bg-sky-50 px-2 py-1 text-[11px] text-sky-700">
          上述内容可结合 22G101-3 第 2-23、2-29、2-61 页一起核对。
        </div>
      </RuleCard>

      {params.hasLocalOverride && (
        <RuleCard title="原位修正段">
          <Row label="修正段起点" value={`${params.localOverrideStart || 0} mm`} />
          <Row label="修正段长度" value={`${params.localOverrideLength || 0} mm`} />
          <Row label="修正底筋" value={params.localBottomBar || '未设置'} note={localBottom ? `${gradeLabel(localBottom.grade)} Φ${localBottom.diameter}@${localBottom.spacing}` : undefined} />
          <Row label="修正顶筋" value={params.localTopBar || '未设置'} note={localTop ? `${gradeLabel(localTop.grade)} Φ${localTop.diameter}@${localTop.spacing}` : undefined} />
          <Row label="修正说明" value={params.localOverrideNote || '无'} />
          <div className="rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            原位修正表示某一局部段与集中标注不同，当前 3D 以高亮修正带和修正钢筋示意表达，便于识图对照。
          </div>
        </RuleCard>
      )}

      {(top || topDist) && (
        <RuleCard title="当前顶部配筋读取">
          {top && <Row label="顶部横向筋" value={`${gradeLabel(top.grade)} Φ${top.diameter}@${top.spacing}`} />}
          {topDist && <Row label="顶部分布筋" value={`${gradeLabel(topDist.grade)} Φ${topDist.diameter}@${topDist.spacing}`} />}
        </RuleCard>
      )}
    </div>
  );
}
