/**
 * 守卫：budget-rules 字典切片由服务端 page.tsx 以 prop 传给客户端组件
 * （BudgetRuleForm / BudgetRuleRowActions），字典里绝不能出现函数值——
 * Next.js 禁止 Server → Client 传函数，序列化期直接抛错
 * （/budget-rules 线上崩溃 2026-10-20，Digest 2860346904；同类事故
 * 2026-10-11 beginner-sop dict.dayLabel）。动态文案一律用模板字符串
 * + {name} 占位，在客户端 .replace 填充。
 *
 * 本断言写成参数化深遍历，后续任何「以 prop 跨界传递」的字典都应加入
 * CASES 一起守（仅限整本跨界的字典；经 useDict/客户端直导入的字典
 * 函数不跨界，不在此列）。
 */
import { describe, expect, it } from "vitest";
import { en, zh } from "./budget-rules";

function collectFunctionPaths(value: unknown, path: string, out: string[]): void {
  if (typeof value === "function") {
    out.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectFunctionPaths(v, `${path}[${i}]`, out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      collectFunctionPaths(v, path ? `${path}.${k}` : k, out);
    }
  }
}

const CASES: Array<{ name: string; dict: unknown }> = [
  { name: "budget-rules zh", dict: zh },
  { name: "budget-rules en", dict: en },
];

describe("dict RSC-boundary guard (no function values)", () => {
  for (const c of CASES) {
    it(`${c.name} contains no function values`, () => {
      const found: string[] = [];
      collectFunctionPaths(c.dict, "", found);
      expect(found).toEqual([]);
    });
  }

  it("budget-rules toggle confirmations are templates with {name}", () => {
    for (const d of [zh.budgetRules, en.budgetRules]) {
      expect(d.toggleConfirmEnable).toContain("{name}");
      expect(d.toggleConfirmDisable).toContain("{name}");
      expect(d.toggleConfirmEnable.replace("{name}", "Camp A")).toContain("Camp A");
      expect(d.toggleConfirmDisable.replace("{name}", "Camp A")).toContain("Camp A");
    }
  });
});
