/**
 * P1-20：CSRF 保护（API 侧 Origin 校验）。
 *
 * 规则：请求带有 Origin 头 + 带有会话 Cookie（alk_session）+ Origin 的
 * host 与 Host 头不一致 → 403。Bearer / API-key 请求不带 Cookie，
 * 不受影响（跳过）；非浏览器客户端不发 Origin，也不受影响。
 * 会话 Cookie 本身已是 HttpOnly + SameSite=Lax（见 auth.ts）。
 *
 * 注意：不校验 Origin 不存在的情况（curl / 服务端调用无 Origin），
 * 避免误杀合法的非浏览器客户端。
 */
import type { FastifyInstance } from "fastify";

export const SESSION_COOKIE_NAME = "alk_session";

/** 纯函数：给定 Origin/Host/Cookie 判断是否应拦截（可单测）。 */
export function shouldBlockCsrf(input: {
  origin?: string | string[] | undefined;
  host?: string | string[] | undefined;
  cookie?: string | string[] | undefined;
}): boolean {
  const origin = Array.isArray(input.origin) ? input.origin[0] : input.origin;
  const host = Array.isArray(input.host) ? input.host[0] : input.host;
  const cookie = Array.isArray(input.cookie) ? input.cookie[0] : input.cookie;
  if (!origin || !cookie) return false;
  if (!cookie.includes(`${SESSION_COOKIE_NAME}=`)) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  if (!host) return false;
  return originHost.toLowerCase() !== host.toLowerCase();
}

export function registerCsrfHook(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (
      shouldBlockCsrf({
        origin: request.headers.origin,
        host: request.headers.host,
        cookie: request.headers.cookie,
      })
    ) {
      await reply.code(403).send({
        error: "CSRF blocked: cross-origin request with session cookie",
      });
    }
  });
}
