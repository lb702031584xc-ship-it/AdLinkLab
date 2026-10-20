import { getLang } from "@/i18n/lang";

export const dynamic = "force-dynamic";

/**
 * 补强 #23 — 平台调查应对知识页（纯防御内容）。
 * 只讲如何合规应对真实调查：触发原因、CJ 流程、回复原则、证据清单。
 * 不包含任何规避检测、伪造证据或多账号分散的操作性内容。
 * 入口待协调员补到导航/dict（本页不改 layout 与字典）。
 */

const CONTENT = {
  zh: {
    title: "平台调查应对指南",
    intro:
      "收到联盟平台的调查/合规问询时不要慌：大多数调查是例行核查。核心原则是及时回复、口径自洽、只提供真实证据。本页只讲合规应对，不涉及任何规避检测的做法。",
    triggersTitle: "调查的四大常见触发",
    triggers: [
      "广告主投诉欺诈：广告主向平台反馈流量质量或转化真实性问题，平台随之启动核查。",
      "身份信息不一致：注册资料、收款账户与税务表单上的姓名/主体对不上。",
      "转化/点击数据异常：转化率、点击量或转化时间分布明显偏离该 offer 的正常区间。",
      "IP 与身份不匹配或频繁变动：登录与操作环境和注册身份所在地长期不一致，或短期内频繁变化。",
    ],
    cjTitle: "以 CJ 为例的调查流程",
    cj: [
      "Network Compliance（网络合规部）会发来正式问询函，说明被调查的推广活动与需要说明的问题。",
      "通常要求在 5 天内回复；请在期限内给出实质回复，哪怕先确认收悉并说明材料准备进度，也不要沉默。",
      "逾期不回复，可能被视为承认问询中的指控，并接受平台发出的 15 天终止通知（账号/合作终止）。",
      "调查期间，相关 pending payout（待结算佣金）会被冻结，这是流程性冻结，不等于已判定违规。",
      "合规确认通过后，冻结的佣金会释放；若确认违规，则按平台条款处理相应佣金与合作关系。",
    ],
    principlesTitle: "回复原则",
    principles: [
      "流量来源自述必须与后台数据自洽：你写的推广方式、流量渠道、投放地区，要能和平台后台看到的点击/转化数据对得上，前后两次回复也不要互相矛盾。",
      "只提供真实证据：广告系列与关键词记录、落地页页面、网站流量来源截图等，都应是实际投放的原始材料；拿不出的材料如实说明，不要拼凑或加工。",
      "逐条回应问询函的问题，不回避、不扩大解释；没有做过的推广方式明确否认并给出你的实际做法。",
      "全程保留沟通记录与提交材料的副本，后续申诉或复核时以同一套材料为准。",
    ],
    evidenceTitle: "证据清单（提前归档，出事不用现找）",
    evidence: [
      "推广方式说明：渠道、投放形式、定向与出价方式的一页说明，与实际投放一致。",
      "投放记录：广告系列与关键词记录、投放平台后台截图（含日期与账户信息）。",
      "落地页与网站材料：落地页链接/存档、网站流量来源截图（如分析工具的来源报表）。",
      "网站归属证明：域名注册/解析、网站所有权验证记录，证明推广站点归你所有或获授权。",
      "收款与税务资料一致性：收款账户、税务表单（如 W-8BEN）与注册身份信息保持一致的证明材料。",
    ],
    note: "提示：最好的应对是平时合规 — 条款先行、品牌词与直达政策先查清、投放记录随手归档。真收到调查函时，先在本页对照清单准备材料，再逐条回复平台。",
  },
  en: {
    title: "Platform Investigation Response Guide",
    intro:
      "Do not panic when a network opens an investigation or compliance inquiry: most are routine checks. Respond on time, keep your account of events consistent, and provide only genuine evidence. This page covers compliant responses only — never evasion tactics.",
    triggersTitle: "Four common investigation triggers",
    triggers: [
      "Advertiser fraud complaints: an advertiser questions traffic quality or conversion validity and the network starts a review.",
      "Inconsistent identity information: registration details, payout account and tax forms do not match.",
      "Abnormal conversion/click data: conversion rate, click volume or conversion timing far outside the offer's normal range.",
      "IP/identity mismatch or frequent changes: login environment persistently inconsistent with the registered identity's location, or changing frequently.",
    ],
    cjTitle: "How an investigation typically runs (CJ example)",
    cj: [
      "Network Compliance sends a formal inquiry letter describing the activity under review and the questions to answer.",
      "You are usually asked to reply within 5 days. Send a substantive reply within the deadline — even an acknowledgement with a preparation timeline beats silence.",
      "Failing to reply in time may be treated as accepting the allegations, followed by a 15-day termination notice.",
      "During the investigation, related pending payouts are frozen. This is a procedural hold, not a finding of violation.",
      "Once compliance is confirmed, frozen commissions are released; if a violation is confirmed, commissions and the relationship are handled per the network's terms.",
    ],
    principlesTitle: "Response principles",
    principles: [
      "Your description of traffic sources must be consistent with the network's own data: channels, methods and geos you describe should match the click/conversion data they can see, and stay consistent across replies.",
      "Provide only genuine evidence: campaign and keyword records, landing pages, and website traffic-source screenshots should be originals from your real activity. If something does not exist, say so — never fabricate or doctor materials.",
      "Answer each question in the letter, point by point. Clearly deny methods you never used and describe what you actually did.",
      "Keep copies of all correspondence and submitted materials; use the same set for any follow-up or appeal.",
    ],
    evidenceTitle: "Evidence checklist (archive in advance)",
    evidence: [
      "Promotion-method statement: a one-page description of channels, formats, targeting and bidding, matching your actual activity.",
      "Campaign records: ad campaign and keyword records and ad-platform screenshots (with dates and account info).",
      "Landing page & website materials: landing-page URLs/archives and website traffic-source screenshots (e.g. analytics source reports).",
      "Site ownership proof: domain registration/DNS and ownership verification showing the promoted sites are yours or authorized.",
      "Payout & tax consistency: materials showing payout account, tax forms (e.g. W-8BEN) and registered identity are consistent.",
    ],
    note: "Note: the best response is everyday compliance — check program terms first (brand bidding and direct-link policies included) and archive campaign records as you go. If a letter arrives, prepare against this checklist, then reply point by point.",
  },
} as const;

export default async function InvestigationGuidePage() {
  const lang = await getLang();
  const c = lang === "en" ? CONTENT.en : CONTENT.zh;

  const sections: Array<{ title: string; items: readonly string[] }> = [
    { title: c.triggersTitle, items: c.triggers },
    { title: c.cjTitle, items: c.cj },
    { title: c.principlesTitle, items: c.principles },
    { title: c.evidenceTitle, items: c.evidence },
  ];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">{c.title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink/70">
          {c.intro}
        </p>
      </header>
      {sections.map((s) => (
        <section
          key={s.title}
          className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-ink">{s.title}</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink/80">
            {s.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] px-5 py-4 text-sm leading-relaxed text-amber-800">
        {c.note}
      </p>
    </div>
  );
}
