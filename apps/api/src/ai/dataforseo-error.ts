/**
 * DataForSEO 错误响应解析：把返回体里的 status_message 提取出来，
 * 让 HTTP 403 这类失败显示真实原因（凭证错 / 账户未激活 / 余额不足等），
 * 而不是只剩一个状态码、用户无法判断是哪种原因。
 *
 * 安全：只取 status_message / raw text，绝不输出凭证（login / password
 * 不会进错误信息或日志——解析只读响应体，不碰请求头与请求体）。
 */
export async function readDataForSeoErrorDetail(
  res: Response
): Promise<string | null> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    return null;
  }
  if (!raw.trim()) return null;
  try {
    const data = JSON.parse(raw) as {
      status_message?: unknown;
      tasks?: Array<{ status_message?: unknown }>;
    };
    // 先顶层 status_message，没有则取 tasks[0].status_message。
    const top =
      typeof data?.status_message === "string"
        ? data.status_message.trim()
        : "";
    if (top) return top;
    const taskMsg = data?.tasks?.[0]?.status_message;
    if (typeof taskMsg === "string" && taskMsg.trim()) return taskMsg.trim();
    // JSON 但无 status_message → 不拿整段 JSON 当 detail。
    return null;
  } catch {
    // 非 JSON → raw text 截断到 200 字符当 detail。
    return raw.slice(0, 200);
  }
}

/** 组装错误信息：有 detail 则带上，否则保持原来的 `HTTP ${status}`。 */
export function dataForSeoErrorMessage(
  status: number,
  detail: string | null
): string {
  return detail
    ? `DataForSEO 请求失败（HTTP ${status}：${detail}）`
    : `DataForSEO 请求失败（HTTP ${status}）`;
}
