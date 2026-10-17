/**
 * P1-18：提示词 DB 化。
 *
 * - AiPrompt 表：key（terms/analyze/ad-plan/traffic）+ version 唯一；
 *   同一 key 只有一个 isActive 行。
 * - syncDefaultPrompts(prisma)：启动时 best-effort 播种 — 若不存在
 *   version === PROMPT_VERSION 的行，则用代码 builder 生成的 system 提示词
 *   建一行（无 active 行时设为 active）。已有行绝不覆盖（人工编辑优先）。
 * - getActivePrompt(prisma, key)：取 active 行；无则 null（调用方回退代码默认）。
 * - 记录规则：AiAnalysis.promptVersion 记录实际使用的版本（见 blueprint：
 *   用了 DB 覆盖时记 `db:<version>`，否则记 PROMPT_VERSION）。
 *
 * 接入点（先接 ONE caller）：blueprint 条款调用 — 有 active 覆盖时用其
 * content 当 system prompt，否则 buildTermsPrompt。其他调用方仍用代码默认，
 * 后续按同一模式接入。
 *
 * Prompt 文案改动 ⇒ bump PROMPT_VERSION（P0-6 规则），并在 docs 中说明。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  buildAnalysisPrompt,
  buildTermsPrompt,
  PROMPT_VERSION,
} from "./prompts.js";
import { buildAdPlanPrompt } from "./ad-generator.js";
import { buildTrafficPlanPrompt } from "./traffic-planner.js";

export const PROMPT_KEYS = ["terms", "analyze", "ad-plan", "traffic"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export interface ActivePrompt {
  id: string;
  key: string;
  version: string;
  content: string;
}

/** 代码默认 seed 内容（neutral 输入的 builder 输出）。 */
function seedContent(key: PromptKey): string {
  switch (key) {
    case "terms":
      return buildTermsPrompt("", "zh").system;
    case "analyze":
      return buildAnalysisPrompt({ pageText: "", language: "zh" }).system;
    case "ad-plan":
      return buildAdPlanPrompt({
        url: "",
        pageText: "",
        language: "zh",
        copyStyle: "affiliate",
      }).system;
    case "traffic":
      return buildTrafficPlanPrompt({
        mode: "direct",
        brandPolicy: "forbidden",
        language: "zh",
        offerName: "",
        keywords: [],
        negativeKeywords: [],
      }).system;
  }
}

/**
 * 启动时播种默认提示词（best-effort：失败只记 log，不阻断启动；
 * 已有同版本行时不覆盖）。
 */
export async function syncDefaultPrompts(prisma: PrismaClient): Promise<void> {
  for (const key of PROMPT_KEYS) {
    try {
      const existing = await prisma.aiPrompt.findUnique({
        where: { key_version: { key, version: PROMPT_VERSION } },
      });
      if (existing) continue;
      const active = await prisma.aiPrompt.findFirst({
        where: { key, isActive: true },
      });
      await prisma.aiPrompt.create({
        data: {
          id: randomUUID(),
          key,
          version: PROMPT_VERSION,
          content: seedContent(key),
          isActive: !active,
        },
      });
    } catch (e) {
      console.error(`[prompts] syncDefaultPrompts failed for ${key}`, e);
    }
  }
}

export async function getActivePrompt(
  prisma: PrismaClient,
  key: PromptKey
): Promise<ActivePrompt | null> {
  // Best-effort：DB 查询失败（无表/无连接/测试 fake）→ null，调用方回退代码默认，
  // 提示词查找绝不阻断主流程。
  let row: {
    id: string;
    key: string;
    content: string;
    version: string;
  } | null;
  try {
    row = await prisma.aiPrompt.findFirst({
      where: { key, isActive: true },
      orderBy: { updatedAt: "desc" },
    });
  } catch {
    return null;
  }
  if (!row) return null;
  return { id: row.id, key: row.key, version: row.version, content: row.content };
}

/**
 * P1-18 管理 API 的共享逻辑（路由层调用）：
 * - upsertPromptVersion：新建版本行（version 必须唯一），并设为 active，
 *   旧 active 行全部 deactivate。
 * - activatePromptVersion：切换 active 到已有版本。
 */
export async function upsertPromptVersion(
  prisma: PrismaClient,
  key: string,
  version: string,
  content: string
): Promise<ActivePrompt> {
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    throw new Error(`unknown prompt key: ${key}`);
  }
  if (!version.trim()) throw new Error("version is required");
  if (!content.trim()) throw new Error("content is required");
  const dup = await prisma.aiPrompt.findUnique({
    where: { key_version: { key, version } },
  });
  if (dup) throw new Error(`prompt ${key}@${version} already exists`);
  await prisma.aiPrompt.updateMany({
    where: { key, isActive: true },
    data: { isActive: false },
  });
  const row = await prisma.aiPrompt.create({
    data: { id: randomUUID(), key, version, content, isActive: true },
  });
  return { id: row.id, key: row.key, version: row.version, content: row.content };
}

export async function activatePromptVersion(
  prisma: PrismaClient,
  key: string,
  version: string
): Promise<ActivePrompt> {
  const target = await prisma.aiPrompt.findUnique({
    where: { key_version: { key, version } },
  });
  if (!target) throw new Error(`prompt ${key}@${version} not found`);
  await prisma.aiPrompt.updateMany({
    where: { key, isActive: true },
    data: { isActive: false },
  });
  const row = await prisma.aiPrompt.update({
    where: { id: target.id },
    data: { isActive: true },
  });
  return { id: row.id, key: row.key, version: row.version, content: row.content };
}
