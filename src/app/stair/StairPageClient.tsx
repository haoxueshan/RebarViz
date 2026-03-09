'use client';

import { useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { StairParams, StairType } from '@/lib/types';
import { STAIR_PRESETS } from '@/lib/rebar';
import { calcStair, calcStairRebarRatios } from '@/lib/calc';
import { checkStairCompliance } from '@/lib/compliance';
import { buildStairContext } from '@/lib/ai-context';
import { StairCrossSection } from '@/components/CrossSection';
import { StairExplain } from '@/components/NotationExplain';
import { WeightCalc } from '@/components/WeightCalc';
import { RebarRatioCard } from '@/components/RebarRatioCard';
import { CompliancePanel, ComplianceBadge } from '@/components/CompliancePanel';
import { StairBarBendingSchedule } from '@/components/StairBarBendingSchedule';
import { ShareButton } from '@/components/ShareButton';
import { AISidebar } from '@/components/AISidebar';
import { Field, NumField, Legend, ResetButton, SelectField, Section } from '@/components/FormControls';
import { ViewerSkeleton } from '@/components/ViewerSkeleton';
import { CONCRETE_GRADES } from '@/lib/anchor';
import type { ConcreteGrade } from '@/lib/anchor';
import { Sparkles } from 'lucide-react';

const DATA_TABS = [
  { key: 'section', label: '截面图' },
  { key: 'ratio', label: '配筋率' },
  { key: 'compliance', label: '规范校验' },
  { key: 'weight', label: '用量估算' },
  { key: 'bbs', label: '弯折详图' },
] as const;

const StairViewer = dynamic(() => import('@/components/StairViewer'), {
  ssr: false,
  loading: () => <ViewerSkeleton />,
});

const presetList = [
  { key: 'standard', label: '标准 AT 型', dot: 'bg-blue-400' },
  { key: 'wide', label: '宽梯段 AT 型', dot: 'bg-green-400' },
  { key: 'compact', label: '紧凑 AT 型', dot: 'bg-purple-400' },
] as const;

const STAIR_TYPE_OPTIONS: { value: StairType; label: string; enabled: boolean }[] = [
  { value: 'AT', label: 'AT 型 — 板式楼梯', enabled: true },
  { value: 'BT', label: 'BT 型 — 梁式楼梯（待开发）', enabled: false },
  { value: 'CT', label: 'CT 型 — 剪刀楼梯（待开发）', enabled: false },
  { value: 'DT', label: 'DT 型 — 双分平行楼梯（待开发）', enabled: false },
  { value: 'ET', label: 'ET 型 — 交叉楼梯（待开发）', enabled: false },
];

const DEFAULT: StairParams = { ...STAIR_PRESETS.standard };

export function StairPageClient() {
  const searchParams = useSearchParams();
  const [params, setParams] = useState<StairParams>(DEFAULT);
  const [dataTab, setDataTab] = useState<typeof DATA_TABS[number]['key']>('section');
  const aiMessage = searchParams.get('ai') || undefined;
  const [showAI, setShowAI] = useState(!!aiMessage);

  const update = (patch: Partial<StairParams>) => setParams(p => ({ ...p, ...patch }));

  const calcResult = useMemo(() => calcStair(params), [params]);
  const ratioResult = useMemo(() => calcStairRebarRatios(params), [params]);
  const complianceResults = useMemo(() => checkStairCompliance(params), [params]);
  const aiContext = useMemo(() => buildStairContext(params), [params]);

  // 计算楼梯几何信息
  const geoInfo = useMemo(() => {
    const totalRise = params.stepCount * params.stepHeight;
    const totalRun = params.stepCount * params.stepWidth;
    const angle = Math.atan2(totalRise, totalRun) * 180 / Math.PI;
    const slabLen = Math.sqrt(totalRise * totalRise + totalRun * totalRun);
    return { totalRise, totalRun, angle: angle.toFixed(1), slabLen: Math.round(slabLen) };
  }, [params.stepCount, params.stepHeight, params.stepWidth]);

  const handleAIApply = (p: Partial<StairParams>) => {
    update(p);
  };

  return (
    <main className="px-4 py-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左栏：参数输入 */}
        <div className="lg:col-span-3 space-y-4 lg:sticky lg:top-[60px] lg:max-h-[calc(100vh-76px)] lg:overflow-y-auto lg:scrollbar-thin">
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-primary">参数输入</h2>
              <div className="flex items-center gap-2">
                <ResetButton onClick={() => setParams(DEFAULT)} />
                <ShareButton params={params} />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-muted mb-2 block">快速示例</label>
              <div className="flex flex-wrap gap-1.5">
                {presetList.map(({ key, label, dot }) => (
                  <button key={key} onClick={() => setParams({ ...STAIR_PRESETS[key] })}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all bg-gray-50 text-gray-600 border border-gray-200 hover:border-gray-300 hover:bg-white hover:shadow-sm active:scale-95">
                    <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Field label="楼梯编号" value={params.id} onChange={v => update({ id: v })} />
              <div>
                <label className="text-xs text-gray-500 mb-1 block">楼梯类型</label>
                <select value={params.stairType} onChange={e => update({ stairType: e.target.value as StairType })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors bg-white text-gray-800 cursor-pointer">
                  {STAIR_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value} disabled={!o.enabled}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {params.stairType !== 'AT' && (
                  <p className="text-[11px] text-amber-600 mt-1">该类型尚在开发中，当前仅支持 AT 型</p>
                )}
              </div>
            </div>

            <Section title="踏步几何" defaultOpen>
              <NumField label="踏步数 n" value={params.stepCount} onChange={v => update({ stepCount: v })} min={3} max={24} />
              <NumField label="踏步高 h (mm)" value={params.stepHeight} onChange={v => update({ stepHeight: v })} min={100} max={200} />
              <NumField label="踏步宽 b (mm)" value={params.stepWidth} onChange={v => update({ stepWidth: v })} min={220} max={350} />
              <NumField label="梯板厚 (mm)" value={params.slabThickness} onChange={v => update({ slabThickness: v })} min={80} max={200} />
              <NumField label="梯段宽 (mm)" value={params.flightWidth} onChange={v => update({ flightWidth: v })} min={800} max={2000} />
            </Section>

            <Section title="平台">
              <NumField label="上平台板长 (mm)" value={params.topPlatformLen} onChange={v => update({ topPlatformLen: v })} min={600} max={3000} />
              <NumField label="下平台板长 (mm)" value={params.botPlatformLen} onChange={v => update({ botPlatformLen: v })} min={600} max={3000} />
              <NumField label="平台板厚 (mm)" value={params.platformThickness} onChange={v => update({ platformThickness: v })} min={80} max={200} />
              <NumField label="梯梁宽 (mm)" value={params.beamB} onChange={v => update({ beamB: v })} min={150} max={400} />
              <NumField label="梯梁高 (mm)" value={params.beamH} onChange={v => update({ beamH: v })} min={200} max={600} />
            </Section>

            <Section title="配筋" defaultOpen>
              <Field label="下部纵筋" value={params.bottomBar} onChange={v => update({ bottomBar: v })} placeholder="如: C10@150" />
              <Field label="上部纵筋" value={params.topBar} onChange={v => update({ topBar: v })} placeholder="如: C8@200" />
              <Field label="分布筋" value={params.distBar} onChange={v => update({ distBar: v })} placeholder="如: A6@250" />
            </Section>

            <Section title="材料与构造">
              <SelectField label="混凝土等级" value={params.concreteGrade} onChange={v => update({ concreteGrade: v as ConcreteGrade })}
                options={CONCRETE_GRADES.map(g => ({ value: g, label: g }))} />
              <NumField label="保护层 (mm)" value={params.cover} onChange={v => update({ cover: v })} min={10} max={30} />
            </Section>
          </div>

          <Legend items={[
            { color: '#C0392B', label: '下部纵筋' },
            { color: '#8E44AD', label: '上部纵筋' },
            { color: '#27AE60', label: '分布筋' },
            { color: '#BDC3C7', label: '混凝土（半透明）', opacity: 0.6 },
          ]} />
        </div>

        {/* 中栏：3D模型 + 数据 tab */}
        <div className={`${showAI ? 'lg:col-span-6' : 'lg:col-span-9'} space-y-4 min-w-0 transition-all`}>
          <StairViewer params={params} />

          {/* Data tabs */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100">
              <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-0.5">
                {DATA_TABS.map(t => (
                  <button key={t.key} onClick={() => setDataTab(t.key)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${dataTab === t.key ? 'bg-white text-accent shadow-sm' : 'text-muted hover:text-primary'}`}>
                    {t.label}
                    {t.key === 'compliance' && <ComplianceBadge results={complianceResults} />}
                  </button>
                ))}
              </div>
              {/* AI toggle */}
              <button onClick={() => setShowAI(a => !a)}
                className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${showAI ? 'bg-gradient-to-r from-blue-500 to-violet-500 text-white shadow-md shadow-blue-500/20' : 'bg-gradient-to-r from-blue-50 to-violet-50 text-violet-600 hover:from-blue-100 hover:to-violet-100'}`}>
                <Sparkles className="w-3.5 h-3.5" />
                AI 助手
              </button>
            </div>
            <div className="p-5">
              {dataTab === 'section' && (
                <>
                  <h2 className="text-sm font-semibold text-primary mb-3">梯板截面配筋示意</h2>
                  <div className="flex justify-center">
                    <StairCrossSection params={params} />
                  </div>
                  {/* 几何信息 */}
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <InfoCard label="总升高" value={`${geoInfo.totalRise} mm`} sub={`${params.stepCount}×${params.stepHeight}`} />
                      <InfoCard label="总水平长" value={`${geoInfo.totalRun} mm`} sub={`${params.stepCount}×${params.stepWidth}`} />
                      <InfoCard label="梯板倾角" value={`${geoInfo.angle}°`} sub="tan⁻¹(H/B)" />
                      <InfoCard label="梯板斜长" value={`${geoInfo.slabLen} mm`} sub="沿斜面" />
                    </div>
                    <div className="mt-3">
                      <h4 className="text-xs font-semibold text-muted mb-2">22G101-2 AT型 注写方式</h4>
                      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 font-mono leading-relaxed">
                        <p>AT{params.stepCount}×{params.stepHeight}/{params.stepWidth}</p>
                        <p className="text-[11px] text-muted mt-1">
                          第1项: 楼梯类型代号 AT · 第2项: 踏步数×踏步高/踏步宽
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
              {dataTab === 'ratio' && <RebarRatioCard ratios={ratioResult} />}
              {dataTab === 'compliance' && <CompliancePanel results={complianceResults} />}
              {dataTab === 'weight' && <WeightCalc result={calcResult} beamId={params.id} meta={{ id: params.id }} />}
              {dataTab === 'bbs' && <StairBarBendingSchedule params={params} />}
            </div>
          </div>
        </div>

        {/* 右栏：AI 侧边栏（可收起） */}
        {showAI && (
          <div className="lg:col-span-3">
            <AISidebar
              componentType="stair"
              currentParams={params}
              onApplyParams={(p) => handleAIApply(p as Partial<StairParams>)}
              context={aiContext}
              notationSlot={<StairExplain params={params} />}
              initialMessage={aiMessage}
            />
          </div>
        )}
      </div>
    </main>
  );
}

function InfoCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-sm font-semibold text-primary mt-0.5">{value}</p>
      <p className="text-[11px] text-muted mt-0.5">{sub}</p>
    </div>
  );
}
