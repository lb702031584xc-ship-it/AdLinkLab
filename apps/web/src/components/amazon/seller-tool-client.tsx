"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";

/**
 * 卖家工具 P0 网页版：与桌面版 app.py 同一套逻辑。
 * - 潜力库：手动录入 / CSV 批量导入，数据只存浏览器 localStorage。
 * - 筛选模板：阈值全部可配置，默认值来自课程说法，不是平台规则。
 * - 利润门：完整成本利润核算，净利润 <= 0 直接拦截。
 * - IP 标签：商标 / 版权 / 专利三道检查只打标签，最终签字在人。
 * - 不调 API、不爬取亚马逊、不写服务器数据库。
 */

type IpState = "未查" | "无风险" | "有风险";

interface Product {
  id: string;
  name: string;
  asin: string;
  category: string;
  price: number;
  cost: number;
  fbaFee: number;
  shipping: number;
  monthlySales: number;
  reviews: number;
  rating: number;
  ipTrademark: IpState;
  ipCopyright: IpState;
  ipPatent: IpState;
  notes: string;
}

interface Settings {
  minPrice: number;
  minProfitRule: number;
  minMonthlySales: number;
  minMargin: number;
  maxReviews: number;
  defaultReturnRate: number;
  defaultAdRate: number;
}

const PRODUCTS_KEY = "adlinklab-seller-tool-products-v1";
const SETTINGS_KEY = "adlinklab-seller-tool-settings-v1";

const DEFAULT_SETTINGS: Settings = {
  minPrice: 80,
  minProfitRule: 5,
  minMonthlySales: 100,
  minMargin: 0.15,
  maxReviews: 500,
  defaultReturnRate: 0.05,
  defaultAdRate: 0.1,
};

const SAMPLE_PRODUCTS: Product[] = [
  { id: "sample-1", name: "示例-收纳篮", asin: "B0XXXXXXX1", category: "Home",
    price: 35.99, cost: 12, fbaFee: 4.2, shipping: 3, monthlySales: 1200,
    reviews: 54, rating: 4.5, ipTrademark: "无风险", ipCopyright: "无风险",
    ipPatent: "无风险", notes: "演示数据" },
  { id: "sample-2", name: "示例-低价配件", asin: "B0XXXXXXX2", category: "Home",
    price: 19.99, cost: 8, fbaFee: 3.39, shipping: 2, monthlySales: 3000,
    reviews: 800, rating: 4.2, ipTrademark: "未查", ipCopyright: "未查",
    ipPatent: "未查", notes: "演示数据，价格未达 80 但利润需复核" },
  { id: "sample-3", name: "示例-亏损款", asin: "B0XXXXXXX3", category: "Home",
    price: 29.99, cost: 25, fbaFee: 5, shipping: 3, monthlySales: 500,
    reviews: 100, rating: 4.0, ipTrademark: "未查", ipCopyright: "未查",
    ipPatent: "未查", notes: "演示数据，应被利润门拦截" },
];

function calcProfit(price: number, cost: number, fbaFee: number, shipping: number,
                    returnRate: number, adRate: number): { profit: number; margin: number } {
  const profit = price - cost - fbaFee - shipping - returnRate * price - adRate * price;
  return { profit: Math.round(profit * 100) / 100, margin: price ? profit / price : 0 };
}

function ipStatus(p: Product): string {
  const flags: string[] = [];
  if (p.ipTrademark === "有风险") flags.push("商标");
  if (p.ipCopyright === "有风险") flags.push("版权");
  if (p.ipPatent === "有风险") flags.push("专利");
  if (flags.length > 0) return `需人工终审：${flags.join("、")}`;
  if ([p.ipTrademark, p.ipCopyright, p.ipPatent].includes("未查")) return "IP未查全";
  return "IP已查无风险";
}

function screenProduct(p: Product, s: Settings): string {
  const { profit, margin } = calcProfit(p.price, p.cost, p.fbaFee, p.shipping,
    s.defaultReturnRate, s.defaultAdRate);
  if (profit <= 0) return "拦截：净利润<=0";
  const reasons: string[] = [];
  if (margin < s.minMargin) reasons.push(`利润率${Math.round(margin * 100)}%<${Math.round(s.minMargin * 100)}%`);
  if (p.monthlySales < s.minMonthlySales) reasons.push(`月销量<${s.minMonthlySales}`);
  if (p.price < s.minPrice && profit <= s.minProfitRule) reasons.push("价格与单件利润均未达双轨线");
  if (p.reviews > s.maxReviews) reasons.push("评论数偏高（仅提醒）");
  return reasons.length > 0 ? `待复核：${reasons.join("；")}` : "通过";
}

function parseCsv(text: string): Product[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const pick = (row: string[], names: string[]): string => {
    const idx = headers.findIndex((h) => names.includes(h));
    return idx >= 0 ? (row[idx] ?? "").trim() : "";
  };
  const num = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const out: Product[] = [];
  for (const line of lines.slice(1)) {
    const row = line.split(",");
    const name = pick(row, ["产品名", "name"]);
    if (!name) continue;
    out.push({
      id: `csv-${Date.now()}-${out.length}`,
      name,
      asin: pick(row, ["ASIN", "asin"]),
      category: pick(row, ["类目", "category"]),
      price: num(pick(row, ["售价", "price"])),
      cost: num(pick(row, ["采购成本", "cost"])),
      fbaFee: num(pick(row, ["FBA配送", "fbaFee", "fba_fee"])),
      shipping: num(pick(row, ["头程", "shipping"])),
      monthlySales: Math.round(num(pick(row, ["月销量", "monthlySales", "monthly_sales"]))),
      reviews: Math.round(num(pick(row, ["评论数", "reviews"]))),
      rating: num(pick(row, ["评分", "rating"])),
      ipTrademark: "未查", ipCopyright: "未查", ipPatent: "未查",
      notes: pick(row, ["备注", "notes"]),
    });
  }
  return out;
}

function toCsv(products: Product[]): string {
  const header = "产品名,ASIN,类目,售价,采购成本,FBA配送,头程,月销量,评论数,评分,备注";
  const rows = products.map((p) => [p.name, p.asin, p.category, p.price, p.cost,
    p.fbaFee, p.shipping, p.monthlySales, p.reviews, p.rating, p.notes].join(","));
  return [header, ...rows].join("\n");
}

const EMPTY_FORM = {
  name: "", asin: "", category: "", price: "", cost: "", fbaFee: "",
  shipping: "", monthlySales: "", reviews: "", rating: "", notes: "",
};

export function SellerToolClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [form, setForm] = useState(EMPTY_FORM);
  const [ipForm, setIpForm] = useState<{ trademark: IpState; copyright: IpState; patent: IpState }>(
    { trademark: "未查", copyright: "未查", patent: "未查" });
  const [showSettings, setShowSettings] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [calc, setCalc] = useState({ price: "50", cost: "15", fba: "5", ship: "3", ret: "0.05", ad: "0.10" });

  useEffect(() => {
    try {
      const rawP = localStorage.getItem(PRODUCTS_KEY);
      if (rawP) setProducts(JSON.parse(rawP) as Product[]);
      const rawS = localStorage.getItem(SETTINGS_KEY);
      if (rawS) setSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(rawS) as Partial<Settings>) });
    } catch {
      // 本地数据损坏时从空开始，不阻塞页面。
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // 隐私模式等写不进 localStorage 时只影响本地保存，不影响当次使用。
    }
  }, [products, settings, loaded]);

  const rows = useMemo(() => products.map((p) => {
    const { profit, margin } = calcProfit(p.price, p.cost, p.fbaFee, p.shipping,
      settings.defaultReturnRate, settings.defaultAdRate);
    return { p, profit, margin, result: screenProduct(p, settings), ip: ipStatus(p) };
  }), [products, settings]);

  const calcResult = useMemo(() => {
    const vals = [calc.price, calc.cost, calc.fba, calc.ship, calc.ret, calc.ad].map((v) => parseFloat(v));
    if (vals.some((v) => !Number.isFinite(v))) return null;
    return calcProfit(vals[0], vals[1], vals[2], vals[3], vals[4], vals[5]);
  }, [calc]);

  const addProduct = () => {
    if (!form.name.trim()) {
      alert("产品名不能为空");
      return;
    }
    const num = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    setProducts((prev) => [{
      id: `p-${Date.now()}`,
      name: form.name.trim(), asin: form.asin.trim(), category: form.category.trim(),
      price: num(form.price), cost: num(form.cost), fbaFee: num(form.fbaFee),
      shipping: num(form.shipping), monthlySales: Math.round(num(form.monthlySales)),
      reviews: Math.round(num(form.reviews)), rating: num(form.rating),
      ipTrademark: ipForm.trademark, ipCopyright: ipForm.copyright, ipPatent: ipForm.patent,
      notes: form.notes.trim(),
    }, ...prev]);
    setForm(EMPTY_FORM);
    setIpForm({ trademark: "未查", copyright: "未查", patent: "未查" });
  };

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const items = parseCsv(String(reader.result ?? ""));
      if (items.length === 0) {
        alert("没有读到有效行，请检查 CSV 列名是否与示例一致");
        return;
      }
      setProducts((prev) => [...items, ...prev]);
      alert(`成功导入 ${items.length} 条`);
    };
    reader.readAsText(file, "UTF-8");
  };

  const exportFile = () => {
    const blob = new Blob([toCsv(products)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "seller-tool-products.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const setField = (key: keyof typeof EMPTY_FORM) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const setSetting = (key: keyof Settings) => (e: ChangeEvent<HTMLInputElement>) => {
    const n = parseFloat(e.target.value);
    if (Number.isFinite(n)) setSettings((s) => ({ ...s, [key]: n }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">卖家工具 P0：选品潜力库 + 利润门</h1>
        <p className="mt-1 text-sm text-ink/60">
          桌面版的网页版，逻辑一致。数据只存在你的浏览器本地（localStorage），不上传服务器、
          不调任何接口、不爬取亚马逊。筛选阈值全部可在下方改，默认值来自课程说法，不是平台规则，
          执行前以当前 Seller Central 为准。IP 任一项“有风险”只打标签，必须人工终审，系统不会自动放行。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setProducts(SAMPLE_PRODUCTS)}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm text-white">载入示例（3 条）</button>
        <label className="cursor-pointer rounded-lg border border-ink/20 px-3 py-1.5 text-sm">
          导入 CSV
          <input type="file" accept=".csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        </label>
        <button type="button" onClick={exportFile}
          className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm">导出 CSV</button>
        <button type="button" onClick={() => setShowSettings((v) => !v)}
          className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm">
          {showSettings ? "收起参数设置" : "参数设置"}
        </button>
        <button type="button" onClick={() => { if (confirm("清空全部本地产品？")) setProducts([]); }}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700">清空本地数据</button>
      </div>

      {showSettings && (
        <div className="rounded-lg border border-ink/10 p-4">
          <h2 className="font-semibold">筛选参数（改完自动保存到浏览器本地）</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {([
              ["minPrice", "价格下限 $"], ["minProfitRule", "单件利润双轨线 $"],
              ["minMonthlySales", "月销量下限"], ["minMargin", "利润率下限（0.15=15%）"],
              ["maxReviews", "评论数提醒线"], ["defaultReturnRate", "默认退货率"],
              ["defaultAdRate", "默认广告占比"],
            ] as Array<[keyof Settings, string]>).map(([key, label]) => (
              <label key={key} className="text-sm">
                <span className="text-ink/60">{label}</span>
                <input type="number" step="any" value={settings[key]} onChange={setSetting(key)}
                  className="mt-1 w-full rounded border border-ink/20 px-2 py-1" />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink/55">
            入选规则：价格 ≥ 下限 或 单件利润 &gt; 双轨线，二选一；净利润 ≤ 0 直接拦截；其余未达标显示“待复核”并列出原因。
          </p>
        </div>
      )}

      <div className="rounded-lg border border-ink/10 p-4">
        <h2 className="font-semibold">利润试算（改数字即时算，不写入库）</h2>
        <div className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-6">
          {([
            ["price", "售价 $"], ["cost", "采购成本 $"], ["fba", "FBA配送 $"],
            ["ship", "头程 $"], ["ret", "退货率"], ["ad", "广告占比"],
          ] as const).map(([key, label]) => (
            <label key={key} className="text-sm">
              <span className="text-ink/60">{label}</span>
              <input value={calc[key]} onChange={(e) => setCalc((c) => ({ ...c, [key]: e.target.value }))}
                className="mt-1 w-full rounded border border-ink/20 px-2 py-1" />
            </label>
          ))}
        </div>
        <p className="mt-3 font-semibold">
          {calcResult
            ? `单件利润 $${calcResult.profit} ｜ 利润率 ${Math.round(calcResult.margin * 100)}%${calcResult.profit > 0 && calcResult.margin >= settings.minMargin ? " ✅ 通过" : " ⚠ 未达利润门"}`
            : "请输入数字"}
        </p>
      </div>

      <div className="rounded-lg border border-ink/10 p-4">
        <h2 className="font-semibold">新增产品</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {([
            ["name", "产品名 *"], ["asin", "ASIN"], ["category", "类目"], ["price", "售价 $"],
            ["cost", "采购成本 $"], ["fbaFee", "FBA配送 $"], ["shipping", "头程 $"],
            ["monthlySales", "月销量"], ["reviews", "评论数"], ["rating", "评分"], ["notes", "备注"],
          ] as Array<[keyof typeof EMPTY_FORM, string]>).map(([key, label]) => (
            <label key={key} className="text-sm">
              <span className="text-ink/60">{label}</span>
              <input value={form[key]} onChange={setField(key)}
                className="mt-1 w-full rounded border border-ink/20 px-2 py-1" />
            </label>
          ))}
          {([
            ["trademark", "商标检查"], ["copyright", "版权检查"], ["patent", "专利检查"],
          ] as const).map(([key, label]) => (
            <label key={key} className="text-sm">
              <span className="text-ink/60">{label}</span>
              <select value={ipForm[key]}
                onChange={(e) => setIpForm((f) => ({ ...f, [key]: e.target.value as IpState }))}
                className="mt-1 w-full rounded border border-ink/20 px-2 py-1">
                <option value="未查">未查</option>
                <option value="无风险">无风险</option>
                <option value="有风险">有风险</option>
              </select>
            </label>
          ))}
        </div>
        <button type="button" onClick={addProduct}
          className="mt-4 rounded-lg bg-ink px-4 py-1.5 text-sm text-white">保存到潜力库</button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-ink/10">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-ink/5 text-left">
              {["产品名", "ASIN", "类目", "售价$", "月销量", "评论数", "评分", "单件利润$", "利润率", "筛选结果", "IP状态", ""].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={12} className="px-3 py-6 text-center text-ink/55">
                潜力库是空的：点“载入示例”看 3 条演示数据，或上面新增、导入 CSV。
              </td></tr>
            )}
            {rows.map(({ p, profit, margin, result, ip }) => (
              <tr key={p.id} className="border-t border-ink/10">
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2">{p.asin || "—"}</td>
                <td className="px-3 py-2">{p.category || "—"}</td>
                <td className="px-3 py-2">{p.price}</td>
                <td className="px-3 py-2">{p.monthlySales}</td>
                <td className="px-3 py-2">{p.reviews}</td>
                <td className="px-3 py-2">{p.rating}</td>
                <td className="px-3 py-2">{profit}</td>
                <td className="px-3 py-2">{Math.round(margin * 100)}%</td>
                <td className="px-3 py-2">{result}</td>
                <td className="px-3 py-2">{ip}</td>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => setProducts((prev) => prev.filter((x) => x.id !== p.id))}
                    className="text-red-700">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink/55">
        CSV 列名：产品名、ASIN、类目、售价、采购成本、FBA配送、头程、月销量、评论数、评分、备注。
        后续版本按 P1–P3 推进：Listing 生成与校验、广告结构与报告、站外与库存盈亏。
      </p>
    </div>
  );
}
