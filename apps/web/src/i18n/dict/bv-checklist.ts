/**
 * #18 广告客户验证（BV）准备清单 — 独立 dict（不接入 dictionaries.ts，跟随 ads-auto/arb-coach 模式）。
 * 纯静态 checklist 页文案；勾选状态只存浏览器 localStorage，不调后端。
 */

export interface BvChecklistDict {
  title: string;
  description: string;
  /** 每年 5 月显示的横幅（BV 集中检测期）。 */
  mayBanner: string;
  progress: string;
  reset: string;
  resetConfirm: string;
  complete: string;
  items: { id: string; label: string; hint: string }[];
}

export const zh: BvChecklistDict = {
  title: "广告客户验证（BV）准备清单",
  description:
    "Google Ads 广告客户验证（Business Verification）材料提前备齐：逐项核对后勾选，进度只存你浏览器本地。材料不一致是 BV 被拒最常见的原因，提交前按这张表对一遍。",
  mayBanner: "⚠️ 5 月是 BV（品牌验证）集中检测期，提前备齐材料，别等账户被限了才补。",
  progress: "已备齐 {done} / {total}",
  reset: "重置勾选",
  resetConfirm: "确定要清空全部勾选吗？",
  complete: "🎉 清单已全部备齐——BV 审核来了可以直接提交。",
  items: [
    {
      id: "license-match-ads",
      label: "营业执照信息与 Ads 账户一致",
      hint: "公司全名、注册地址、统一社会信用代码与 Google Ads 账户里填写的企业信息逐字一致。",
    },
    {
      id: "payment-match-license",
      label: "付款资料与执照一致",
      hint: "付款方式的持有人 / 公司名、账单地址与营业执照主体一致，个人卡付公司账容易被卡。",
    },
    {
      id: "site-match-license",
      label: "网站域名 / 公司名与执照一致",
      hint: "落地页网站展示的公司名、页脚主体信息与执照一致；域名持有主体如被问到能对上。",
    },
    {
      id: "privacy-contact",
      label: "隐私政策与联系页齐全",
      hint: "网站有可访问的隐私政策页和联系页，联系页上的公司名、地址、邮箱与执照信息一致。",
    },
    {
      id: "brand-authorization",
      label: "品牌授权材料（如适用）",
      hint: "投别人品牌时备齐商标注册证或品牌方授权书；自有品牌备商标证。不适用可直接勾掉并在心里注明原因。",
    },
    {
      id: "eu-political-ads",
      label: "欧盟政治广告声明已选择",
      hint: "在 Ads 账户里按实际情况完成欧盟政治广告声明选择（是否为政治广告），不要留着未选择状态。",
    },
  ],
};

export const en: BvChecklistDict = {
  title: "Advertiser Verification (BV) Prep Checklist",
  description:
    "Get your Google Ads advertiser verification (Business Verification) materials ready in advance: check each item off — progress is stored in your browser only. Mismatched details are the most common reason BV gets rejected, so run through this list before submitting.",
  mayBanner: "⚠️ May is the BV (brand verification) intensive review period — prepare your materials early instead of scrambling after the account gets limited.",
  progress: "Ready {done} / {total}",
  reset: "Reset checks",
  resetConfirm: "Clear all checkmarks?",
  complete: "🎉 Everything is ready — you can submit as soon as BV review arrives.",
  items: [
    {
      id: "license-match-ads",
      label: "Business license details match the Ads account",
      hint: "Legal company name, registered address and business registration number exactly match the business info in your Google Ads account.",
    },
    {
      id: "payment-match-license",
      label: "Payment details match the license",
      hint: "The payment method holder / company name and billing address match the licensed entity — personal cards paying for a company account often get stuck.",
    },
    {
      id: "site-match-license",
      label: "Website domain / company name match the license",
      hint: "The company name shown on your landing site and in the footer matches the license; domain ownership can be explained if asked.",
    },
    {
      id: "privacy-contact",
      label: "Privacy policy and contact pages are in place",
      hint: "The site has a reachable privacy policy page and a contact page whose company name, address and email match the license.",
    },
    {
      id: "brand-authorization",
      label: "Brand authorization materials (if applicable)",
      hint: "When advertising someone else's brand, prepare the trademark certificate or the brand owner's authorization letter; for your own brand, keep the trademark certificate handy. If not applicable, check it off and note why.",
    },
    {
      id: "eu-political-ads",
      label: "EU political ads declaration selected",
      hint: "Complete the EU political advertising declaration in the Ads account truthfully (whether your ads are political) — don't leave it unselected.",
    },
  ],
};
