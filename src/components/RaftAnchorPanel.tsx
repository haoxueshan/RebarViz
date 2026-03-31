'use client';

import type { RaftFoundationParams } from '@/lib/types';
import { parseSlabRebar, parseRebar, gradeLabel } from '@/lib/rebar';
import {
  calcLaTable, calcLabTable, calcLaETable,
  ANCHOR_LARGE_DIA_THRESHOLD,
  determineJLEndAnchor, determineLPBEdgeAnchor, determineBPBEdgeAnchor,
  jlTopBarConnectionZone, jlBottomBarConnectionZone,
} from '@/lib/anchor';
import { determineColFoundAnchor } from '@/lib/construction-rules';
import type { ConcreteGrade, SeismicGrade } from '@/lib/anchor';

/* ─── Shared UI atoms ─── */
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

/* ─── Main Panel ─── */
export function RaftAnchorPanel({ params }: { params: RaftFoundationParams }) {
  const cover = params.cover || 40;
  const concreteGrade = params.concreteGrade as ConcreteGrade;
  const seismicGrade = (params.seismicGrade || '三级') as SeismicGrade;
  const raftType = params.raftType ?? 'flat';

  const botX = parseSlabRebar(params.bottomBarX);
  const botY = parseSlabRebar(params.bottomBarY);
  const colR = parseRebar(params.colMain);

  // Anchor lengths (table method)
  const laX = calcLaTable(botX.grade, botX.diameter, concreteGrade);
  const laY = calcLaTable(botY.grade, botY.diameter, concreteGrade);
  const labX = calcLabTable(botX.grade, botX.diameter, concreteGrade);
  const largeDiaX = botX.diameter > ANCHOR_LARGE_DIA_THRESHOLD;
  const largeDiaY = botY.diameter > ANCHOR_LARGE_DIA_THRESHOLD;

  // Column insert anchor
  const laECol = calcLaETable(colR.grade, colR.diameter, concreteGrade, seismicGrade);
  const colAnchor = determineColFoundAnchor(params.h, cover, colR.diameter, laECol);

  // Half-span extension for slab edge anchorage
  const extX = params.colSpacingX / 2;
  const extY = params.colSpacingY / 2;

  // ── Flat BPB ──
  const bpbEdgeX = determineBPBEdgeAnchor(extX, laX, botX.diameter);
  const bpbEdgeY = determineBPBEdgeAnchor(extY, laY, botY.diameter);

  function edgeBadge(r: { canStraight: boolean; hasExt: boolean }) {
    if (!r.hasExt) return '无外伸 → 弯折';
    return r.canStraight ? '直锚' : '弯锚 (15d)';
  }

  // ── BeamSlab ──
  const beamB = params.beamB ?? 600;
  const beamH = params.beamH ?? 900;
  const ln = params.colSpacingX - (params.colBx || 600); // JL净跨
  const lnY = params.colSpacingY - (params.colBy || 600);
  const lpbExtX = (params.colSpacingX - beamB) / 2;
  const lpbExtY = (params.colSpacingY - beamB) / 2;

  const jlEndAnchor = raftType === 'beamSlab'
    ? determineJLEndAnchor(extX, labX, botX.diameter) : null;
  const lpbEdgeX = raftType === 'beamSlab'
    ? determineLPBEdgeAnchor(lpbExtX, laX, botX.diameter) : null;
  const lpbEdgeY = raftType === 'beamSlab'
    ? determineLPBEdgeAnchor(lpbExtY, laY, botY.diameter) : null;

  const jlTopZone = ln > 0 ? jlTopBarConnectionZone(ln) : null;
  const jlBotZone = ln > 0 ? jlBottomBarConnectionZone(ln) : null;

  // ── FlatPlate ZXB/KZB ──
  const stripEdgeX = determineBPBEdgeAnchor(extX, laX, botX.diameter);
  const stripEdgeY = determineBPBEdgeAnchor(extY, laY, botY.diameter);

  const raftTypeLabel =
    raftType === 'beamSlab' ? '梁板式 (JL + LPB)'
    : raftType === 'flatPlate' ? '平板式-板带式 (ZXB/KZB)'
    : '平板式 (BPB)';

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-primary">
        筏形基础锚固构造检查 — 22G101-3 &nbsp;
        <span className="text-xs font-normal text-muted">({raftTypeLabel})</span>
      </h2>

      {/* ── Anchor length summary ── */}
      <RuleCard title="底筋锚固长度 (查表法)">
        <Row label={`X向底筋 ${gradeLabel(botX.grade)} Φ${botX.diameter}`}
          value={`la = ${laX} mm, lab = ${labX} mm`}
          note={largeDiaX ? `d=${botX.diameter}>${ANCHOR_LARGE_DIA_THRESHOLD}mm，已×1.1修正` : `${concreteGrade}`} />
        <Row label={`Y向底筋 ${gradeLabel(botY.grade)} Φ${botY.diameter}`}
          value={`la = ${laY} mm`}
          note={largeDiaY ? `d=${botY.diameter}>${ANCHOR_LARGE_DIA_THRESHOLD}mm，已×1.1修正` : undefined} />
        <Row label="参考依据" value="22G101-3 §2-2/2-3" />
      </RuleCard>

      {/* ══ FLAT BPB ══ */}
      {raftType === 'flat' && (
        <>
          <RuleCard
            title="X向底筋 — 平板边支座锚固 (BPB)"
            badge={edgeBadge(bpbEdgeX)}
            badgeOk={bpbEdgeX.canStraight}
          >
            <Row label="外伸长度" value={`${extX} mm`} note="≈ colSpacingX / 2" />
            <Row label="la" value={`${laX} mm`} />
            {!bpbEdgeX.canStraight && bpbEdgeX.hasExt && (
              <Row label="弯折段 15d" value={`${bpbEdgeX.bendPart} mm`} />
            )}
            <ResultBanner ok={bpbEdgeX.canStraight} text={bpbEdgeX.description} />
          </RuleCard>

          <RuleCard
            title="Y向底筋 — 平板边支座锚固 (BPB)"
            badge={edgeBadge(bpbEdgeY)}
            badgeOk={bpbEdgeY.canStraight}
          >
            <Row label="外伸长度" value={`${extY} mm`} note="≈ colSpacingY / 2" />
            <Row label="la" value={`${laY} mm`} />
            {!bpbEdgeY.canStraight && bpbEdgeY.hasExt && (
              <Row label="弯折段 15d" value={`${bpbEdgeY.bendPart} mm`} />
            )}
            <ResultBanner ok={bpbEdgeY.canStraight} text={bpbEdgeY.description} />
          </RuleCard>
        </>
      )}

      {/* ══ BEAM-SLAB JL + LPB ══ */}
      {raftType === 'beamSlab' && jlEndAnchor && (
        <>
          <RuleCard
            title="JL基础梁 — 端部锚固构造"
            badge={jlEndAnchor.canStraight ? '直锚' : '弯锚 (0.6lab+15d)'}
            badgeOk={jlEndAnchor.canStraight}
          >
            <Row label="外伸长度 (X跨半跨)" value={`${extX} mm`} />
            <Row label="lab" value={`${labX} mm`} />
            {jlEndAnchor.canStraight
              ? <Row label="直锚长度" value={`${jlEndAnchor.straightPart} mm`} />
              : <>
                  <Row label="直段 (≥0.6lab)" value={`${jlEndAnchor.straightPart} mm`} />
                  <Row label="弯折段 (15d)" value={`${jlEndAnchor.bendPart} mm`} />
                </>
            }
            <ResultBanner ok={jlEndAnchor.canStraight} text={jlEndAnchor.description} />
          </RuleCard>

          {lpbEdgeX && (
            <RuleCard
              title="LPB平板 — X向边缘底筋锚固"
              badge={edgeBadge(lpbEdgeX)}
              badgeOk={lpbEdgeX.canStraight}
            >
              <Row label="梁宽" value={`${beamB} mm`} />
              <Row label="LPB外伸" value={`${lpbExtX} mm`} note="= (colSpacingX - bw) / 2" />
              <Row label="la" value={`${laX} mm`} />
              {!lpbEdgeX.canStraight && lpbEdgeX.hasExt && (
                <Row label="弯折段 15d" value={`${lpbEdgeX.bendPart} mm`} />
              )}
              <ResultBanner ok={lpbEdgeX.canStraight} text={lpbEdgeX.description} />
            </RuleCard>
          )}

          {lpbEdgeY && (
            <RuleCard
              title="LPB平板 — Y向边缘底筋锚固"
              badge={edgeBadge(lpbEdgeY)}
              badgeOk={lpbEdgeY.canStraight}
            >
              <Row label="LPB外伸" value={`${lpbExtY} mm`} note="= (colSpacingY - bw) / 2" />
              {!lpbEdgeY.canStraight && lpbEdgeY.hasExt && (
                <Row label="弯折段 15d" value={`${lpbEdgeY.bendPart} mm`} />
              )}
              <ResultBanner ok={lpbEdgeY.canStraight} text={lpbEdgeY.description} />
            </RuleCard>
          )}

          {/* JL connection zones */}
          {jlTopZone && jlBotZone && (
            <RuleCard title="JL纵筋连接区 (22G101-3 §2-25)">
              <Row label="JL净跨 ln (X方向)" value={`${ln} mm`} note={`= colSpacingX - colBx = ${params.colSpacingX} - ${params.colBx}`} />
              <Row label="JL净跨 ln (Y方向)" value={`${lnY} mm`} />
              <Row label="上部筋连接区" value={`跨中 ${jlTopZone.start}～${jlTopZone.end} mm`}
                note={`距支座 ln/3=${Math.ceil(ln / 3)}mm 至 2ln/3=${Math.floor(2*ln/3)}mm`} />
              <Row label="下部筋连接区" value={`端部 0～${jlBotZone.zoneFromEachEnd} mm`}
                note={`距支座 ≤ ln/4 = ${Math.ceil(ln / 4)}mm`} />
              <Row label="同截面搭接率" value="≤ 50%" />
              <div className="text-[11px] mt-1 px-2 py-1 rounded bg-blue-50 text-blue-700">
                上部筋在跨中1/3区段连接；下部筋在距支座ln/4范围内连接 (22G101-3 §2-25)
              </div>
            </RuleCard>
          )}

          <RuleCard title="JL梁端构造说明">
            <Row label="梁截面" value={`${beamB}×${beamH} mm`} />
            <Row label="梁板位置" value={params.beamPosition === 'high' ? '高板位' : params.beamPosition === 'mid' ? '中板位' : '低板位'} />
            <div className="text-[11px] mt-1 px-2 py-1 rounded bg-gray-100 text-gray-600 leading-relaxed">
              梁端伸至基础外边缘：伸出长度 ≥ lab 时直锚；否则底部弯折 15d（22G101-3 §2-25）
            </div>
          </RuleCard>
        </>
      )}

      {/* ══ FLAT-PLATE ZXB/KZB ══ */}
      {raftType === 'flatPlate' && (
        <>
          <RuleCard
            title="ZXB/KZB — X向板带边缘底筋锚固"
            badge={edgeBadge(stripEdgeX)}
            badgeOk={stripEdgeX.canStraight}
          >
            <Row label="外伸长度" value={`${extX} mm`} note="≈ colSpacingX / 2" />
            <Row label="la" value={`${laX} mm`} />
            {!stripEdgeX.canStraight && stripEdgeX.hasExt && (
              <Row label="弯折段 15d" value={`${stripEdgeX.bendPart} mm`} />
            )}
            <ResultBanner ok={stripEdgeX.canStraight} text={stripEdgeX.description} />
          </RuleCard>

          <RuleCard
            title="ZXB/KZB — Y向板带边缘底筋锚固"
            badge={edgeBadge(stripEdgeY)}
            badgeOk={stripEdgeY.canStraight}
          >
            <Row label="外伸长度" value={`${extY} mm`} note="≈ colSpacingY / 2" />
            <Row label="la" value={`${laY} mm`} />
            {!stripEdgeY.canStraight && stripEdgeY.hasExt && (
              <Row label="弯折段 15d" value={`${stripEdgeY.bendPart} mm`} />
            )}
            <ResultBanner ok={stripEdgeY.canStraight} text={stripEdgeY.description} />
          </RuleCard>

          {params.colStripWidth && (
            <RuleCard title="ZXB柱下板带参数">
              <Row label="ZXB宽度" value={`${params.colStripWidth} mm`}
                note={`约 = ${((params.colStripWidth / Math.min(params.colSpacingX, params.colSpacingY)) * 100).toFixed(0)}% 短跨`} />
              <Row label="X向附加筋" value={params.colStripBarX ?? '—'} />
              <Row label="Y向附加筋" value={params.colStripBarY ?? '—'} />
            </RuleCard>
          )}
        </>
      )}

      {/* ── Column insert anchor (common to all types) ── */}
      <RuleCard
        title="柱插筋在筏板内锚固"
        badge={colAnchor.canStraight ? '直锚' : '弯锚'}
        badgeOk={colAnchor.canStraight}
      >
        <Row label="柱插筋" value={`${gradeLabel(colR.grade)} Φ${colR.diameter}`} />
        <Row label="抗震锚固长度 laE (查表)" value={`${laECol} mm`}
          note={`${concreteGrade} / ${seismicGrade}`} />
        <Row label="筏板内可用高度 h-c" value={`${params.h - cover} mm`} />
        {!colAnchor.canStraight && (
          <Row label="底部弯折长度" value={`${colAnchor.bendLength} mm`} />
        )}
        <ResultBanner ok={colAnchor.canStraight} text={
          colAnchor.canStraight
            ? `直锚：laE=${laECol}mm ≤ h-c=${params.h - cover}mm (22G101-3 §2-10)`
            : `弯锚：laE=${laECol}mm > h-c=${params.h - cover}mm，底弯${colAnchor.bendLength}mm (22G101-3 §2-10)`
        } />
      </RuleCard>

      {/* Code note */}
      <div className="text-[11px] text-muted bg-gray-50 rounded-lg p-3 leading-relaxed border border-gray-100">
        <p className="font-semibold text-primary mb-1">图集依据 (22G101-3)</p>
        {raftType === 'flat' && (
          <p>· BPB平板底筋在边支座：外伸 ≥ la 时可直锚过边梁；否则弯折 15d 或伸至板顶 (§2-37)。</p>
        )}
        {raftType === 'beamSlab' && (
          <>
            <p>· JL端部底筋：外伸 ≥ lab 时直锚；否则伸至外边缘弯折 15d (§2-25)。</p>
            <p>· LPB平板底筋在 JL 支座处：外伸 ≥ la 时直锚至 JL 外边缘；否则弯折 15d (§2-33)。</p>
            <p>· JL上部筋在跨中1/3范围连接；下部筋在距支座 ln/4 范围连接 (§2-25)。</p>
          </>
        )}
        {raftType === 'flatPlate' && (
          <p>· ZXB/KZB 板带底筋在边支座：外伸 ≥ la 时直锚；否则弯折 15d (§2-37)。</p>
        )}
        <p>· d {'>'} 25mm 带肋钢筋锚固长度乘以 1.1 修正系数 (GB50010 §8.3.1)。</p>
        <p>· 柱插筋锚固：laE ≤ h筏板 - c 时可直锚；否则底部弯折 (§2-10)。</p>
      </div>
    </div>
  );
}
