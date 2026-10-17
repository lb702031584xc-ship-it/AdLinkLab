/**
 * P1-2 — 品牌提取（纯函数，可单测）。
 *
 * 自动提取仅作建议，绝不自动覆盖人工填写：调用方（Offer 表单）在用户
 * 手动改过品牌名后不再调用本函数；置信度 <0.6 时调用方提示人工确认。
 *
 * 置信度口径（讲师/旧源码经验，非平台官方标准）：
 * - 标题按 | / - / – / — / : 切，第一段像品牌名 → 0.8
 * - 标题无分隔符、整体较短（≤30 字符）→ 0.7
 * - 标题取前 2 个 token 兜底 → 0.5
 * - 域名回退（取注册域首段）→ 0.6；域名本身不像品牌（IP/单段）→ 0.3
 */

export type BrandNameSource = "manual" | "auto_extracted" | "domain_fallback";

export interface BrandExtraction {
  brandName: string;
  source: BrandNameSource;
  confidence: number;
}

const TITLE_SEPARATORS = /[|/\-–—:：]/;

function looksLikeBrand(s: string): boolean {
  // 品牌名：2–30 字符，不含句子标点/空格过多，不以数字开头。
  if (s.length < 2 || s.length > 30) return false;
  if (/^[0-9]/.test(s)) return false;
  if (/[.!?。！？，,]/.test(s)) return false;
  if (s.split(/\s+/).length > 3) return false;
  return true;
}

function registrableFirstLabel(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/^www\./, "");
  if (!host) return null;
  const labels = host.split(".").filter(Boolean);
  if (labels.length === 0) return null;
  // 去掉常见两段后缀（co.uk 等）后再取首段。
  const twoLabelSuffixes = new Set([
    "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.jp", "com.cn",
    "net.cn", "com.hk", "com.tw", "com.sg", "co.nz", "com.br",
  ]);
  let core = labels;
  if (labels.length >= 3 && twoLabelSuffixes.has(labels.slice(-2).join("."))) {
    core = labels.slice(0, -2);
  } else if (labels.length >= 2) {
    core = labels.slice(0, labels.length - 1);
  }
  const first = core[0] ?? "";
  return first || null;
}

/**
 * 从标题 + URL 提取品牌候选。两者都为空/无法解析时返回 null（调用方
 * 不填品牌名，不编造）。
 */
export function extractBrandName(input: {
  title?: string;
  url?: string;
}): BrandExtraction | null {
  const title = (input.title ?? "").trim();
  if (title) {
    const firstSeg = title.split(TITLE_SEPARATORS)[0]?.trim() ?? "";
    if (firstSeg && looksLikeBrand(firstSeg)) {
      return {
        brandName: firstSeg,
        source: "auto_extracted",
        confidence: 0.8,
      };
    }
    if (!TITLE_SEPARATORS.test(title) && title.length <= 30 && looksLikeBrand(title)) {
      return { brandName: title, source: "auto_extracted", confidence: 0.7 };
    }
    const tokens = title.split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
    if (tokens && looksLikeBrand(tokens)) {
      return { brandName: tokens, source: "auto_extracted", confidence: 0.5 };
    }
  }
  const url = (input.url ?? "").trim();
  if (url) {
    try {
      const host = new URL(url).hostname;
      const first = registrableFirstLabel(host);
      if (first) {
        const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
        return {
          brandName: first.charAt(0).toUpperCase() + first.slice(1),
          source: "domain_fallback",
          confidence: isIp ? 0.3 : 0.6,
        };
      }
    } catch {
      /* URL 解析失败：不编造品牌名 */
    }
  }
  return null;
}
