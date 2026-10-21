/**
 * 「按新增日期全选」的本地日期 → UTC ISO 区间换算（纯函数，可单测）。
 *
 * 口径：date input 给的是本地时区的 "YYYY-MM-DD"；区间 = 本地
 * [当天 00:00, 次日 00:00)，转成 ISO(UTC) 传给后端 added-ids——
 * 服务端不做时区换算，只按 createdAt ∈ [from, to) 查。
 * 用本地 Date 分量构造，任意时区下口径一致；非法/不存在的日期
 * （如 2026-02-31）返回 null，绝不静默滚动到别的月份。
 */
export function localDayRangeToIso(
  dateStr: string
): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const start = new Date(y, mo - 1, d, 0, 0, 0, 0);
  // 分量回环校验：构造后分量必须与输入一致（挡住 2 月 31 日之类滚动）。
  if (
    start.getFullYear() !== y ||
    start.getMonth() !== mo - 1 ||
    start.getDate() !== d
  ) {
    return null;
  }
  const end = new Date(y, mo - 1, d + 1, 0, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** 本地今天的 "YYYY-MM-DD"（date input 的默认值）。 */
export function localTodayString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}
