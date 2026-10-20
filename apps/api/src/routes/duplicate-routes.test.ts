/**
 * 路由冲突回归测试。
 *
 * 2026-10-19 教训：测试里 services.prisma 为 undefined，prisma 门控的整个
 * 路由注册块被跳过；生产环境全量注册时 FST_ERR_DUPLICATED_ROUTE 直接让
 * API 容器启动崩溃（POST /api/v1/data/import 被用户自助 data-io 和管理
 * 员 data-exchange 同时声明）。这个测试静态扫描全部路由文件中的字面量
 * method+path 声明，断言没有任何重复，避免同类启动崩溃。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES_DIR = join(__dirname);
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".test.ts") || name.endsWith(".d.ts")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      collectTsFiles(p, out);
    } else if (name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

function extractRoutes(src: string): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  // 匹配 app.get("/path") / app.post<{...}>("/path")，允许泛型参数跨行。
  const re = /\bapp\.(get|post|put|patch|delete)(?:<[\s\S]*?>)?\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    routes.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  // 匹配 app.route({ method: "POST", url: "/path" })（Fastify 完整声明形式）。
  const re2 =
    /\bapp\.route\(\s*\{\s*method\s*:\s*["'](GET|POST|PUT|PATCH|DELETE)["']\s*,\s*url\s*:\s*["']([^"']+)["']/g;
  while ((m = re2.exec(src)) !== null) {
    routes.push({ method: m[1], path: m[2] });
  }
  return routes;
}

describe("duplicate-routes（路由冲突扫描）", () => {
  it("全部路由文件中不存在 method+path 完全重复的声明", () => {
    const files = collectTsFiles(ROUTES_DIR);
    expect(files.length).toBeGreaterThan(0);
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const r of extractRoutes(src)) {
        const key = `${r.method} ${r.path}`;
        if (seen.has(key)) {
          dups.push(`${key}  ←  ${seen.get(key)}  与  ${file}`);
        } else {
          seen.set(key, file);
        }
      }
    }
    expect(dups).toEqual([]);
  });

  it("扫描器能识别本文件风格的 app.get/post 字面量声明", () => {
    const src = readFileSync(join(ROUTES_DIR, "data-io.ts"), "utf8");
    const routes = extractRoutes(src);
    const keys = routes.map((r) => `${r.method} ${r.path}`);
    expect(keys).toContain("GET /api/v1/user-data/export");
    expect(keys).toContain("POST /api/v1/user-data/import");
    const admin = extractRoutes(readFileSync(join(ROUTES_DIR, "data-exchange.ts"), "utf8"));
    const adminKeys = admin.map((r) => `${r.method} ${r.path}`);
    expect(adminKeys).toContain("POST /api/v1/data/export");
    expect(adminKeys).toContain("POST /api/v1/data/import");
  });
});
