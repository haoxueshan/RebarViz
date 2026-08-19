import type {
  FloorPrintBomRow,
  FloorPrintLayer,
  FloorPrintPiece,
  FloorPrintSnapshot,
} from "@/lib/floor-print";
import { floorOpeningTouchesFloor } from "@/lib/floor-2d";
import {
  buildFloorPrintAreaGroups,
  buildFloorPrintSiteIndex,
  buildFloorPrintSlabRefs,
} from "@/lib/floor-print-layout";
import { FloorPrintPlanSvg } from "./FloorPrintPlanSvg";
import styles from "./FloorPrintReport.module.css";

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSingleLength(valueMm: number, unit: "mm" | "m"): string {
  if (unit === "m") return `${(valueMm / 1000).toFixed(3)} m`;
  return `${Number(valueMm.toFixed(1)).toLocaleString("zh-CN")} mm`;
}

function roleLabel(role: FloorPrintBomRow["role"]): string {
  return role === "main" ? "主筋" : "副筋";
}

function directionLabel(direction: FloorPrintBomRow["direction"]): string {
  return direction === "x" ? "东西向" : "南北向";
}

function sourceLabel(row: FloorPrintBomRow): string {
  if (row.layer === "bottom") return "地筋";
  return row.source === "through"
    ? `通墙面筋${row.throughPathName ? ` · ${row.throughPathName}` : ""}`
    : "普通面筋";
}

function supportLabel(support: FloorPrintPiece["startSupport"]): string {
  if (support === "outer-wall") return "外墙";
  if (support === "inner-wall") return "内墙";
  if (support === "opening-cut") return "洞口裁断";
  return "连续板边";
}

function paperClass(snapshot: FloorPrintSnapshot): string {
  const key = `${snapshot.options.paperSize}${snapshot.options.orientation}`;
  if (key === "A3landscape") return styles.paperA3Landscape;
  if (key === "A3portrait") return styles.paperA3Portrait;
  if (key === "A4landscape") return styles.paperA4Landscape;
  return styles.paperA4Portrait;
}

function ReportHeader({ snapshot, title }: { snapshot: FloorPrintSnapshot; title?: string }) {
  return (
    <>
      <header className={styles.header}>
        <div>
          <p className={styles.brand}>RebarViz · FLOOR REBAR</p>
          <h1 className={styles.title}>{title ?? "整层楼板钢筋料单"}</h1>
        </div>
        <div className={styles.status}>{snapshot.status === "official" ? "正式下料单" : "草稿 · 不可用于正式下料"}</div>
      </header>
    </>
  );
}

function LayerBomTable({
  title,
  rows,
  layer,
  snapshot,
  pageBreak = true,
}: {
  title: string;
  rows: readonly FloorPrintBomRow[];
  layer: FloorPrintLayer;
  snapshot: FloorPrintSnapshot;
  pageBreak?: boolean;
}) {
  const piecesById = new Map(layer.pieces.map((piece) => [piece.id, piece]));
  const showWeight = snapshot.options.display.weights;
  const showAnchors = snapshot.options.display.anchorDetails;
  return (
    <section className={`${styles.pageSection} ${pageBreak ? styles.pageBreak : ""}`} data-print-section={`${rows[0]?.layer ?? "combined"}-bom`}>
      <h2 className={styles.sectionTitle}>
        <span>{title}</span>
        <span className={styles.sectionNote}>数量来自实际 FloorBarPiece；单根下料不使用平均长度</span>
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.table} data-print-bom-layout="report">
          <thead>
            <tr>
              <th style={{ width: "7%" }}>编号</th>
              <th style={{ width: "19%" }}>板区/区域</th>
              <th style={{ width: "12%" }}>类型</th>
              <th style={{ width: "9%" }}>主副筋</th>
              <th style={{ width: "9%" }}>方向</th>
              <th style={{ width: "11%" }}>规格</th>
              <th style={{ width: "13%" }}>单根下料</th>
              <th style={{ width: "8%" }}>根数</th>
              <th style={{ width: "12%" }}>总长度</th>
              {showWeight && <th style={{ width: "12%" }}>重量</th>}
              {showAnchors && <th>端部支承</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowPieces = row.pieceIds.flatMap((id) => {
                const piece = piecesById.get(id);
                return piece ? [piece] : [];
              });
              const supports = [...new Set(rowPieces.map((piece) =>
                `${supportLabel(piece.startSupport)}→${supportLabel(piece.endSupport)}`))];
              return (
                <tr key={`${row.layer}:${row.mark}`} data-print-mark={row.mark}>
                  <td className={styles.mark}>{row.mark}</td>
                  <td className={styles.area}>{row.slabNames.join(" + ")}</td>
                  <td>{sourceLabel(row)}</td>
                  <td>{roleLabel(row.role)}</td>
                  <td>{directionLabel(row.direction)}</td>
                  <td>Φ{row.diameter}@{row.spacing}</td>
                  <td>{formatSingleLength(row.singleLengthMm, snapshot.options.lengthUnit)}</td>
                  <td>{row.count}</td>
                  <td>{formatNumber(row.totalLengthM)} m</td>
                  {showWeight && <td>{formatNumber(row.weightKg)} kg</td>}
                  {showAnchors && <td>{supports.join("；")}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.subtotal}>本层小计：{rows.reduce((sum, row) => sum + row.count, 0)} 件 · {formatNumber(rows.reduce((sum, row) => sum + row.totalLengthM, 0))} m{showWeight ? ` · ${formatNumber(rows.reduce((sum, row) => sum + row.weightKg, 0))} kg` : ""}</p>
    </section>
  );
}

function SiteLayerBomTable({
  title,
  rows,
  snapshot,
}: {
  title: string;
  rows: readonly FloorPrintBomRow[];
  snapshot: FloorPrintSnapshot;
}) {
  const slabRefs = buildFloorPrintSlabRefs(snapshot.geometry);
  const normalGroups = buildFloorPrintAreaGroups(rows.filter((row) => row.source === "normal"), slabRefs)
    .map((group) => ({ group, heading: group.displayName, key: `normal:${group.areaKey}` }));
  const throughRowsByPath = new Map<string, FloorPrintBomRow[]>();
  rows.filter((row) => row.source === "through").forEach((row) => {
    const pathKey = row.throughPathId ?? row.throughPathName ?? "through";
    const pathRows = throughRowsByPath.get(pathKey) ?? [];
    pathRows.push(row);
    throughRowsByPath.set(pathKey, pathRows);
  });
  const throughGroups = [...throughRowsByPath.entries()].flatMap(([pathKey, pathRows]) =>
    buildFloorPrintAreaGroups(pathRows, slabRefs).map((group) => ({
      group,
      key: `through:${pathKey}:${group.areaKey}`,
      heading: `通墙面筋 · ${pathRows[0]?.throughPathName ?? "通墙路径"} · ${group.displayName}`,
    })));
  const groups = [...normalGroups, ...throughGroups];
  return (
    <section className={`${styles.pageSection} ${styles.pageBreak}`} data-print-section={`${rows[0]?.layer ?? "combined"}-bom`}>
      <h2 className={styles.sectionTitle}>
        <span>{title}</span>
        <span className={styles.sectionNote}>按板区组织正式 FloorBarPiece，下料长度以 D/M/T 编号料单为准</span>
      </h2>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.siteTable}`} data-print-bom-layout="site">
          <thead>
            <tr>
              <th style={{ width: "12%" }}>编号</th>
              <th style={{ width: "14%" }}>主/副</th>
              <th style={{ width: "17%" }}>方向</th>
              <th style={{ width: "20%" }}>规格</th>
              <th style={{ width: "23%" }}>单根长度</th>
              <th style={{ width: "14%" }}>根数</th>
            </tr>
          </thead>
          {groups.map(({ group, heading, key }) => {
            const groupRows = [...group.mainRows, ...group.secondaryRows];
            return (
              <tbody
                key={key}
                className={groupRows.length <= 6 ? styles.smallAreaGroup : undefined}
                data-area-group={group.areaKey}
              >
                <tr className={styles.areaHeaderRow} data-area-header={group.areaKey}>
                  <td colSpan={6}>{heading}</td>
                </tr>
                {groupRows.map((row) => (
                  <tr key={`${row.layer}:${row.mark}`} data-print-mark={row.mark} data-source={row.source}>
                    <td className={styles.mark}>{row.mark}</td>
                    <td>{roleLabel(row.role)}</td>
                    <td>{directionLabel(row.direction)}</td>
                    <td>Φ{row.diameter}@{row.spacing}</td>
                    <td>{formatSingleLength(row.singleLengthMm, snapshot.options.lengthUnit)}</td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className={styles.subtotal}>本层小计：{rows.reduce((sum, row) => sum + row.count, 0)} 件 · {formatNumber(rows.reduce((sum, row) => sum + row.totalLengthM, 0))} m</p>
    </section>
  );
}

function PlanPage({
  snapshot,
  mode,
  title,
}: {
  snapshot: FloorPrintSnapshot;
  mode: "geometry" | "bottom" | "top";
  title: string;
}) {
  const pieces = mode === "bottom" ? snapshot.bottom.pieces : mode === "top" ? snapshot.top.pieces : [];
  const rows = mode === "bottom" ? snapshot.bottom.rows : mode === "top" ? snapshot.top.rows : [];
  const areaIndexEntries = mode === "bottom"
    ? buildFloorPrintSiteIndex(
      rows.filter((row) => row.source === "normal"),
      snapshot.top.rows.filter((row) => row.source === "through"),
      buildFloorPrintSlabRefs(snapshot.geometry),
    )
    : [];
  const geometryNote = snapshot.source.coordinateModel === "clear-space-physical-v2"
    ? "本图使用正式V3物理净空、墙体与实物钢筋坐标；下料长度以D/M/T编号料单为准"
    : "本图为净跨布置示意；实际钢筋下料长度以D/M/T编号料单为准";
  return (
    <section className={`${styles.pageSection} ${styles.planPage}`} data-print-section={`${mode}-plan`}>
      <h2 className={styles.sectionTitle}>
        <span>{title}</span>
        <span className={styles.sectionNote}>{geometryNote}</span>
      </h2>
      <div className={styles.planFrame}>
        <FloorPrintPlanSvg geometry={snapshot.geometry} coordinateModel={snapshot.source.coordinateModel} mode={mode} pieces={pieces} rows={rows} display={snapshot.options.display} />
      </div>
      {mode === "bottom" && (
        <div className={styles.areaIndex} aria-label="板区施工索引">
          <strong>板区施工索引</strong>
          <div className={styles.areaIndexGrid} data-area-index-columns={areaIndexEntries.length <= 8 ? 2 : 3}>
            {areaIndexEntries.map((entry) => (
              <span key={entry.key} data-area-index={entry.key} data-area-index-kind={entry.kind}>
                {entry.displayName}　主 {entry.mainMarks}　副 {entry.secondaryMarks}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function FloorPrintReport({ snapshot }: { snapshot: FloorPrintSnapshot }) {
  const sections = snapshot.options.sections;
  const isSiteLayout = snapshot.options.layoutMode === "site";
  const uncoveredOpenings = snapshot.geometry.openings.filter((opening) =>
    !floorOpeningTouchesFloor(opening, snapshot.geometry));
  return (
    <article className={`${styles.report} ${paperClass(snapshot)}`} data-floor-print-status={snapshot.status} data-floor-print-layout={snapshot.options.layoutMode} data-testid="floor-print-report">
      {snapshot.status === "draft" && <div className={styles.draftWatermark}>草稿 · 不可用于正式下料</div>}

      {sections.summary && (
        <section className={styles.pageSection} data-print-section="summary">
          <ReportHeader snapshot={snapshot} />
          <div className={styles.projectGrid}>
            <div className={styles.field}><span className={styles.fieldLabel}>项目</span><span className={styles.fieldValue}>{snapshot.project.projectName || "未填写"}</span></div>
            <div className={styles.field}><span className={styles.fieldLabel}>楼层</span><span className={styles.fieldValue}>{snapshot.project.floorName || "未填写"}</span></div>
            <div className={styles.field}><span className={styles.fieldLabel}>生成时间</span><span className={styles.fieldValue}>{new Date(snapshot.createdAt).toLocaleString("zh-CN", { hour12: false })}</span></div>
          </div>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCard}><span className={styles.summaryLabel}>地筋实际下料</span><strong className={styles.summaryValue}>{snapshot.summary.bottomPieceCount} 件</strong><span>{formatNumber(snapshot.summary.bottomLengthM)} m · {formatNumber(snapshot.summary.bottomWeightKg)} kg</span></div>
            <div className={styles.summaryCard}><span className={styles.summaryLabel}>面筋实际下料</span><strong className={styles.summaryValue}>{snapshot.summary.topPieceCount} 件</strong><span>普通 {snapshot.summary.topNormalPieceCount} · 通墙 {snapshot.summary.topThroughPieceCount} 件</span><span>{formatNumber(snapshot.summary.topLengthM)} m · {formatNumber(snapshot.summary.topWeightKg)} kg</span></div>
            <div className={styles.summaryCard}><span className={styles.summaryLabel}>整层理论汇总</span><strong className={styles.summaryValue}>{snapshot.summary.totalPieceCount} 件</strong><span>{formatNumber(snapshot.summary.totalLengthM)} m · {formatNumber(snapshot.summary.totalWeightKg)} kg</span></div>
          </div>
          <div className={styles.parameterGrid}>
            <div className={styles.parameterCard}><span className={styles.parameterLabel}>板区 / 洞口</span><strong className={styles.parameterValue}>{snapshot.summary.slabCount} / {snapshot.summary.openingCount}</strong></div>
            <div className={styles.parameterCard}><span className={styles.parameterLabel}>坐标模型</span><strong className={styles.parameterValue}>{snapshot.source.coordinateModel}</strong></div>
            <div className={styles.parameterCard}><span className={styles.parameterLabel}>快照Schema</span><strong className={styles.parameterValue}>{snapshot.schemaVersion}</strong></div>
          </div>
          {snapshot.project.remark && <div className={styles.remark}><strong>备注：</strong>{snapshot.project.remark}</div>}
          {uncoveredOpenings.length > 0 && <div className={styles.remark}><strong>几何提示：</strong>存在 {uncoveredOpenings.length} 个未覆盖楼板的洞口；平铺图已优先按真实楼板主体取景，请返回计算器复核洞口位置。</div>}
        </section>
      )}

      {sections.floorPlan && <PlanPage snapshot={snapshot} mode="geometry" title="整层楼板平面" />}
      {sections.bottomPlan && <PlanPage snapshot={snapshot} mode="bottom" title="地筋平铺图" />}
      {sections.bottomBom && (isSiteLayout
        ? <SiteLayerBomTable title="地筋下料单" rows={snapshot.bottom.rows} snapshot={snapshot} />
        : <LayerBomTable title="地筋下料单" rows={snapshot.bottom.rows} layer={snapshot.bottom} snapshot={snapshot} />)}
      {sections.topPlan && <PlanPage snapshot={snapshot} mode="top" title="面筋平铺图（普通 + 通墙）" />}
      {sections.topBom && (isSiteLayout
        ? <SiteLayerBomTable title="面筋下料单（普通 + 通墙）" rows={snapshot.top.rows} snapshot={snapshot} />
        : <LayerBomTable title="面筋下料单（普通 + 通墙）" rows={snapshot.top.rows} layer={snapshot.top} snapshot={snapshot} />)}
      {sections.combinedBom && <LayerBomTable title="地筋 + 面筋综合明细" rows={snapshot.combinedRows} layer={{
        rows: snapshot.combinedRows,
        pieces: [...snapshot.bottom.pieces, ...snapshot.top.pieces],
        totalPieceCount: snapshot.summary.totalPieceCount,
        totalLengthM: snapshot.summary.totalLengthM,
        totalWeightKg: snapshot.summary.totalWeightKg,
      }} snapshot={snapshot} />}

      {sections.diameterSummary && (
        <section className={`${styles.pageSection} ${styles.pageBreak}`} data-print-section="diameter-summary">
          <h2 className={styles.sectionTitle}><span>按直径汇总</span><span className={styles.sectionNote}>仅统计理论总长度、重量与实际下料件数；不含原材套料和损耗</span></h2>
          <table className={styles.table}>
            <thead><tr><th>直径</th><th>实际下料件数</th><th>总长度</th>{snapshot.options.display.weights && <th>理论重量</th>}</tr></thead>
            <tbody>{snapshot.diameterSummary.map((row) => <tr key={row.diameter}><td className={styles.mark}>Φ{row.diameter}</td><td>{row.pieceCount}</td><td>{formatNumber(row.totalLengthM)} m</td>{snapshot.options.display.weights && <td>{formatNumber(row.weightKg)} kg</td>}</tr>)}</tbody>
          </table>
        </section>
      )}

      {sections.calculationParameters && (
        <section className={`${styles.pageSection} ${styles.pageBreak}`} data-print-section="parameters">
          <h2 className={styles.sectionTitle}>计算参数与范围</h2>
          <div className={styles.parameterGrid}>
            <div className={styles.parameterCard}><span className={styles.parameterLabel}>内墙 / 外墙厚度</span><strong className={styles.parameterValue}>{snapshot.parameters.innerWallThicknessMm} / {snapshot.parameters.outerWallThicknessMm} mm</strong></div>
            <div className={styles.parameterCard}><span className={styles.parameterLabel}>地筋 / 面筋Physical Domain</span><strong className={styles.parameterValue}>{snapshot.parameters.bottomPhysicalDomainCount} / {snapshot.parameters.topPhysicalDomainCount}</strong></div>
            <div className={styles.parameterCard}><span className={styles.parameterLabel}>Role Domain</span><strong className={styles.parameterValue}>{snapshot.parameters.roleDomainCount}</strong></div>
          </div>
          <p className={styles.remark}>计算模块：Geometry V2.1 · Bottom Rebar V1.1 · Top Rebar V1 · Floor Rebar Role V1.1 · Top Through V1。当前料单包含地筋、普通面筋与通墙面筋；不含原材套料、采购根数和施工损耗。</p>
        </section>
      )}

      <footer className={styles.footer}>RebarViz · 生成时间 {new Date(snapshot.createdAt).toLocaleString("zh-CN", { hour12: false })} · 计算结果用于现场下料复核，不替代结构设计图纸及工程师审核。</footer>
    </article>
  );
}
