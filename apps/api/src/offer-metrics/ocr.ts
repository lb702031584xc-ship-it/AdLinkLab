/**
 * 截图 OCR 识别指标（第四批：手动输入的升级版）。
 *
 * 引擎：tesseract.js（npm 纯 JS/WASM，不改 Dockerfile、不加系统包）。
 * 语言只用 eng；识别超时 60s；语言数据首次运行时从公网 CDN 下载。
 *
 * 流程：图片 Buffer（内存，不落盘）→ tesseract 全文识别 → 正则提取：
 *  - rating:      /(\d\.\d)\s*out of 5/
 *  - reviewCount: /([\d,]+)\s*(?:ratings?|reviews?)/
 *  - price:       /\$\s?([\d,]+\.\d{2})/（currency 记 USD）
 *  - soldCount:   /([\d,]+)\+?\s*bought in past month/
 *
 * 返回 { rating, reviewCount, price, currency, soldCount, confidence, needsReview: true }；
 * 识别不到的字段为 null。全文识别失败抛 OcrError（调用方转 422，绝不 500）。
 */
import { createWorker } from "tesseract.js";
import { AppError } from "@adlinklab/shared";

export class OcrError extends AppError {
  constructor(message: string) {
    super(message, { code: "OCR_FAILED", statusCode: 422 });
    this.name = "OcrError";
  }
}

export interface OcrMetrics {
  rating: number | null;
  reviewCount: number | null;
  price: number | null;
  currency: string | null;
  soldCount: number | null;
  /** tesseract 平均置信度 0-100（识别失败时为 null）。 */
  confidence: number | null;
  /** 识别值仅供参考，必须人工核对。 */
  needsReview: true;
}

const OCR_TIMEOUT_MS = 60_000;

const num = (s: string): number | null => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** 从 OCR 全文里提取指标（大小写不敏感）。纯函数，可单测。 */
export function extractMetricsFromText(text: string): Omit<OcrMetrics, "confidence" | "needsReview"> {
  const t = (text ?? "").replace(/\s+/g, " ");
  let rating: number | null = null;
  let reviewCount: number | null = null;
  let price: number | null = null;
  let currency: string | null = null;
  let soldCount: number | null = null;

  const rm = t.match(/(\d\.\d)\s*out of 5/i);
  if (rm) {
    const r = num(rm[1]!);
    if (r !== null && r >= 0 && r <= 5) rating = r;
  }

  const cm = t.match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
  if (cm) {
    const c = num(cm[1]!);
    if (c !== null && c >= 0) reviewCount = Math.round(c);
  }

  const pm = t.match(/\$\s?([\d,]+\.\d{2})/);
  if (pm) {
    const p = num(pm[1]!);
    if (p !== null && p > 0) {
      price = p;
      currency = "USD";
    }
  }

  const sm = t.match(/([\d,]+)\+?\s*bought in past month/i);
  if (sm) {
    const sc = num(sm[1]!);
    if (sc !== null && sc >= 0) soldCount = Math.round(sc);
  }

  return { rating, reviewCount, price, currency, soldCount };
}

export interface OcrDeps {
  /** Injectable for tests：返回识别全文与置信度。 */
  recognizeImpl?: (image: Buffer) => Promise<{ text: string; confidence: number | null }>;
}

async function recognizeWithTesseract(image: Buffer): Promise<{
  text: string;
  confidence: number | null;
}> {
  const worker = await createWorker("eng");
  try {
    const job = worker.recognize(image);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OCR timeout (60s)")), OCR_TIMEOUT_MS)
    );
    const { data } = await Promise.race([job, timeout]);
    return {
      text: data.text ?? "",
      confidence:
        typeof data.confidence === "number" ? Math.round(data.confidence) : null,
    };
  } finally {
    try {
      await worker.terminate();
    } catch {
      // 忽略清理失败
    }
  }
}

/**
 * 对图片做 OCR，只返回识别全文与置信度（不提取指标）。
 * 给一键推演报告的截图兜底用：全文喂给 extractOfferMeta 做价格提取、
 * 取前几百字当产品描述、全文（截断）喂给广告生成。
 */
export async function ocrImageText(
  image: Buffer,
  deps: OcrDeps = {}
): Promise<{ text: string; confidence: number | null }> {
  if (!image || image.length === 0) {
    throw new OcrError("图片为空，无法识别");
  }
  const recognize = deps.recognizeImpl ?? recognizeWithTesseract;
  try {
    const r = await recognize(image);
    if (!r.text || !r.text.trim()) {
      throw new OcrError("截图中未识别出任何文字，请换一张更清晰的截图重试");
    }
    return { text: r.text, confidence: r.confidence };
  } catch (e) {
    if (e instanceof OcrError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new OcrError(`截图识别失败（${msg}），请换一张更清晰的截图重试`);
  }
}

/**
 * 对图片做 OCR 并提取指标。图片只在内存里处理，不落盘、不存库。
 * 全文识别失败 → 抛 OcrError（422）。
 */
export async function ocrImageMetrics(
  image: Buffer,
  deps: OcrDeps = {}
): Promise<OcrMetrics> {
  if (!image || image.length === 0) {
    throw new OcrError("图片为空，无法识别");
  }
  const recognize = deps.recognizeImpl ?? recognizeWithTesseract;
  let text: string;
  let confidence: number | null;
  try {
    const r = await recognize(image);
    text = r.text;
    confidence = r.confidence;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new OcrError(`截图识别失败（${msg}），请换一张更清晰的截图重试`);
  }
  if (!text || !text.trim()) {
    throw new OcrError("截图中未识别出任何文字，请换一张更清晰的截图重试");
  }
  return {
    ...extractMetricsFromText(text),
    confidence,
    needsReview: true as const,
  };
}
