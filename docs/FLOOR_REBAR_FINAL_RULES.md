# RebarViz 整层楼板板筋正式规则

## 系统边界

整层模块只计算水平楼板地筋、普通面筋与面筋通墙，并由实际钢筋 Piece 生成下料料单和平铺打印图。梁、柱、楼梯梯段、屋檐、原材套料、采购量和施工损耗不属于本系统。

## 几何与支承

- `FloorSlab` 表示存在水平楼板的区域，`FloorOpening` 表示无板区域。
- `net-layout-v1` 坐标只表达净跨拓扑；正式长度不能直接把坐标差当成完整下料长度。
- `outer-wall`、`inner-wall`、`continuous`、`opening-cut` 分别表示建筑外墙、真实内墙、无墙的连续板建模边和洞口裁断边。
- 正式钢筋计算使用 Atomic Boundary；合并后的 Display Boundary 只用于显示。

## 主筋与副筋

- X/Y 是空间方向：X 为西到东，Y 为南到北。
- 主/副筋是钢筋角色：矩形 Role Domain 的短跨方向为主筋、长跨方向为副筋。
- 正方形和不规则 Role Domain 必须人工指定主筋方向。
- Opening 只裁断钢筋，不改变 Role Domain，也不改变主副筋方向。

## 地筋

- 地筋遇 `inner-wall`、`outer-wall` 或 `opening-cut` 结束；遇 `continuous` 连续。
- 内墙端增加内墙厚度，外墙端增加外墙厚度，洞口裁断端增加 0。
- 根数严格复用 `project`、`round`、`floor` 三种既有算法。

## 普通面筋

- 普通面筋与地筋使用同一 Geometry、Role、BarLine、Opening clipping 和 Atomic endpoint 链路。
- 内墙端为内墙厚度，并按该方向的 `extraMode` 决定是否增加 `topAnchorExtra`。
- 外墙端只增加外墙厚度；洞口裁断端为 0；两者都不增加 `topAnchorExtra`。
- `continuous` 不是最终 Piece 端点。

## 面筋通墙

- 通墙路径只保存稳定输入：路径 ID、名称、方向、板区 ID、全局 Band 和启用状态。
- X 通墙按西到东排序，Band 是全局 Y 半开区间；Y 通墙按南到北排序，Band 是全局 X 半开区间。
- 路径必须是一条真实共享边链；Band 必须位于所有板区与相邻共享边的共同有效范围内。
- Opening 与路径条带有正面积相交时阻断通墙；V1 不绕洞、不分叉。
- 通墙筋只能继承普通面筋已有的钢筋位置、角色、直径、间距和增加位置，不能重新调用根数公式产生新相位。
- 路径各板区的普通钢筋位置必须完全同相；规格、角色或相位冲突均阻止正式结果。
- 中间 `inner-wall` 只累计墙厚，不累计面筋增加值；中间 `continuous` 增加 0。
- 真正起终点继续遵守普通面筋端部规则。
- 通墙是替换，不是叠加：

  `Final Top Pieces = Normal Top Pieces - Claimed Normal Pieces + Through Pieces`

- 同方向路径不得争抢同一个普通 Piece；X/Y 通墙可以在平面中交叉。

## Piece、BOM 与打印

- `FloorBarLine` 是理论空间位置；`FloorBarPiece` 是真实下料最小单位。一条 Line 可因 Opening 产生多个 Piece。
- BOM 只按实际 Piece 的层位、来源、路径、方向、角色、规格和真实单根长度聚合。
- 地筋编号为 `Dxx`，普通面筋为 `Mxx`，通墙面筋为 `Txx`。
- 打印快照冻结最终 Piece、BOM、Mark 和绘图 DTO；打印页不得重新计算钢筋。
- 平铺图和下料表必须消费同一个 Mark，且面筋图只显示替换后的最终 Top Pieces。
- 理论重量统一使用项目既有 `theoreticalUnitWeight()`；打印不计算原材根数、损耗或采购量。
