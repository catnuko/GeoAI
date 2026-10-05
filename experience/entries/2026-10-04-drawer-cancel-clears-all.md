---
id: 2026-10-04-drawer-cancel-clears-all
title: 绘图中右键「取消」在点数不足时会清空整个图形，而不是删一个点
kind: pitfall
lib: cesium
tags: [drawer, 取消, 右键, cancel, 绘制, 交互, 反直觉]
apis: [entities.remove, ScreenSpaceEventHandler]
errors: [右键一下图形全没了, 画到一半白画, 撤销行为不符预期]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
自己实现「右键撤销」时，或用现成绘图库但撤销行为不符合直觉时

> **已封装为库**：`kit.drawer` 的取消语义已修正 —— 移除最后一个点，点数归零才结束本次绘制。
> 本条保留**为什么原库是错的**，以及它带来的真实用户投诉形态。

## 现象 / 报错

绘制多边形时已经点了 2 个点，右键想「删掉上一个点」，结果**整个图形连同断点全被清空**，
得从头重画。UI 提示通常写的是「rightClick remove point」（移除点），与实际行为不符。

## 根因

cesium-extends 原库 `drawer/src/base.ts:119-132`：

```ts
protected _cancel(createShape) {
  if (this.painter._activeShapePoints.length < 3) {
    this.painter.reset();   // ← 点数不足 3 直接清空整个绘制
    return;
  }
  // 否则才 splice(-2, 1) 删掉倒数第二个点
}
```

作者显然把「少于 3 个点构不成多边形」当成了「取消就等于放弃」，
于是用 `painter.reset()` 一刀切。但用户的心智模型是**撤销上一步**，不是**放弃整个任务**。

同一个函数的第二个问题：即使点数 ≥ 3，它 `splice(-2, 1)` 删的是**倒数第二个**点
（因为最后一个是跟随鼠标的占位点），然后 `result = createShape(...)` 重建预览。
所以撤销时预览会闪一下重建，且断点实体 `pop` 的时机与 `splice` 不严格对应。

## 本库的修法

```ts
// kit.drawer 的取消实现（语义明确）
function undoPoint() {
  s.points.pop();                                  // 移除最后一个固定点
  const bp = s.breakpoints.pop();                  // 同步摘掉它的断点标记
  if (bp) viewer.entities.remove(bp);
  refreshPreview(s);                               // 重建预览
  emitPoints(s);
}
// 只有点数归零时才真的结束本次绘制
```

对应的 `POINT`（单击即完成）与 `CIRCLE`（首点定圆心）语义不同：这两种类型本就没有撤销概念，
`CIRCLE` 改半径即可，不需要撤销点。

## 自己实现时要注意

- **区分「撤销一步」与「放弃任务」**。前者是右键，后者应该是 `Escape` 或点「取消」按钮。
  把两者混在一个右键里，用户会丢数据。
- 撤销后要同步断点标记实体，否则画面上还留着已删的点（虽然实际几何已不存在）。
- 撤销到 0 个点时的收尾行为要想清楚：静默结束？还是提示「已取消本次绘制」？