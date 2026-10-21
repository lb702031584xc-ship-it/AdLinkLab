/**
 * Offer 列表"测试优先分"单元格：分数 + 第一条理由小字，
 * 全部理由放 title 悬停。sort=priority 时全局名次 ≤5 显示「先测」徽标
 * （rank 由列表页按 (page-1)*pageSize + 行序算好传入；非该排序不传 rank）。
 * 纯展示组件（无状态），分数与理由均来自后端真实信号计算，前端不重算。
 */
export interface OfferTestPriorityCellDict {
  testFirst: string;
}

export interface OfferTestPriority {
  score: number;
  reasons: string[];
}

export function OfferTestPriorityCell({
  priority,
  rank,
  dict,
}: {
  priority?: OfferTestPriority | null;
  rank?: number | null;
  dict: OfferTestPriorityCellDict;
}) {
  if (!priority) return <span>—</span>;
  return (
    <span className="whitespace-nowrap" title={priority.reasons.join("；")}>
      <span className="text-sm font-semibold">{priority.score}</span>
      {rank != null && rank <= 5 ? (
        <span className="ml-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
          {dict.testFirst}
        </span>
      ) : null}
      {priority.reasons[0] ? (
        <span className="block text-[11px] font-normal text-ink/55">
          {priority.reasons[0]}
        </span>
      ) : null}
    </span>
  );
}
