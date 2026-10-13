/**
 * Landing-page 4-step pipeline dictionary (Batch 5).
 *
 * ①抓取 → ②推荐 → ③AI制作 → ④A/B测试 (+ 我的落地页 tab).
 *
 * Standalone zh/en dictionary, imported directly by the pipeline client.
 * Pure strings only — no functions (client components must not receive
 * functions through i18n dicts).
 */

export type LanderPipelineLang = "zh" | "en";

export type LanderPipelineVertical =
  | "saas"
  | "ecommerce"
  | "finance"
  | "health"
  | "education"
  | "gaming";

export interface LanderPipelineVerticalInfo {
  label: string;
  blurb: string;
  /** Recommended template categories, comma-separated display string. */
  categories: string;
  why: string;
  /** High-converting structure tips for this vertical. */
  structure: string[];
}

export interface LanderPipelineDict {
  page: {
    title: string;
    description: string;
  };
  steps: {
    scrape: string;
    recommend: string;
    generate: string;
    abtest: string;
    pages: string;
  };
  stepDesc: {
    scrape: string;
    recommend: string;
    generate: string;
    abtest: string;
    pages: string;
  };
  nav: {
    next: string;
    prev: string;
    markDone: string;
    markedDone: string;
    unmark: string;
    openStandalone: string;
  };
  status: {
    done: string;
    todo: string;
  };
  scrape: {
    intro: string;
  };
  recommend: {
    intro: string;
    pickVertical: string;
    recommendedCategories: string;
    whyItWorks: string;
    structureTitle: string;
    openTemplateLibrary: string;
    verticals: Record<LanderPipelineVertical, LanderPipelineVerticalInfo>;
  };
  generate: {
    intro: string;
  };
  abtest: {
    intro: string;
    openExperiments: string;
    nextStepTitle: string;
    nextStepHint: string;
    nextStepAds: string;
  };
}

const zh: LanderPipelineDict = {
  page: {
    title: "落地页流水线",
    description:
      "按营销实战顺序走完 4 步：抓取竞品拆解 → 按行业推荐结构 → AI 生成落地页 → A/B 测试验证。每步可单独进入，也可以按顺序走完。",
  },
  steps: {
    scrape: "① 抓取拆解",
    recommend: "② 结构推荐",
    generate: "③ AI 制作",
    abtest: "④ A/B 测试",
    pages: "我的落地页",
  },
  stepDesc: {
    scrape: "输入竞品落地页 URL，抓取并拆解它的结构（Hero / 痛点 / 对比表 / FAQ / CTA），看高转化页面长什么样。",
    recommend: "按你的行业（SaaS / 电商 / 金融…）推荐高转化模板类型和页面结构，先抄对结构再谈优化。",
    generate: "基于抓取的拆解和你的 offer 信息，让 AI 生成落地页文案，一键部署。",
    abtest: "为新旧落地页创建 A/B 实验，分流验证哪个版本转化更高，用数据说话。",
    pages: "该 offer 下已有的全部落地页。",
  },
  nav: {
    next: "下一步 →",
    prev: "← 上一步",
    markDone: "标记本步完成",
    markedDone: "已完成 ✓",
    unmark: "取消完成标记",
    openStandalone: "在独立页面打开 →",
  },
  status: {
    done: "已完成",
    todo: "未完成",
  },
  scrape: {
    intro:
      "先看对手：把跑得好的竞品落地页 URL 贴进来，AI 会逐项拆解它的结构和得分，拆解结论可以直接用到第 ③ 步的 AI 制作里。",
  },
  recommend: {
    intro:
      "不同行业的高转化结构不一样。选你的行业，看推荐用什么模板类型、页面重点放哪里。",
    pickVertical: "选择你的行业",
    recommendedCategories: "推荐模板类型",
    whyItWorks: "为什么这样搭",
    structureTitle: "高转化结构要点",
    openTemplateLibrary: "去模板库挑选模板 →",
    verticals: {
      saas: {
        label: "SaaS / 软件",
        blurb: "决策周期长，靠信任和对比成交",
        categories: "对比表、指南、需求测评",
        why: "SaaS 买家会横向对比好几家，对比表直接帮他做决策；指南型页面用内容建立专业信任；测评 quiz 能筛出高意向用户再推试用。",
        structure: [
          "Hero：痛点 + 核心价值主张 + 免费试用 CTA，一屏讲清",
          "信任区：客户 logo、数据指标（提升 x%、节省 x 小时）",
          "对比表：和竞品/和现状对比，突出差异点",
          "FAQ：打消价格、迁移、数据安全顾虑",
          "CTA：全页至少 3 次，试用按钮全程可达",
        ],
      },
      ecommerce: {
        label: "电商 / 实物",
        blurb: "冲动+比价并存，靠评测和优惠推动",
        categories: "评测、榜单、优惠券",
        why: "实物购买前用户大量看评测，评测型页面承接搜索流量最自然；榜单型满足比价心理；优惠券页直接给下单理由，缩短决策。",
        structure: [
          "Hero：产品大图/视频 + 核心卖点 + 限时优惠",
          "痛点区：说出用户现在用的东西有多糟",
          "评测/榜单：参数对比表，星级评分可视化",
          "信任区：真实评价截图、销量数据、退换政策",
          "CTA：优惠倒计时 + 库存紧张提示，临门一脚",
        ],
      },
      finance: {
        label: "金融 / 保险",
        blurb: "高信任门槛，靠权威和透明成交",
        categories: "指南、对比表、资质测评",
        why: "金融决策重、信任门槛最高，指南型内容先教育再转化；对比表把费率/条款摊开讲，透明反而加分；测评 quiz 顺带收集销售线索。",
        structure: [
          "Hero：权威背书（持牌/合作机构）+ 核心利益点",
          "信任区：资质、监管信息、用户规模放首屏",
          "对比表：费率、额度、门槛横向对比，越透明越好",
          "指南区：讲清流程和风险，合规措辞先行",
          "CTA：免费咨询/测算，低门槛先留资",
        ],
      },
      health: {
        label: "健康 / 保健",
        blurb: "效果敏感，靠案例和成分说服",
        categories: "评测、榜单、指南",
        why: "健康类最吃真实案例和成分背书，评测型页面讲清成分和机理；榜单型借“同类最好”的心理；指南型用科普建立专业感，注意合规不夸大疗效。",
        structure: [
          "Hero：针对的人群 + 解决的困扰 + 温和 CTA",
          "痛点区：描述症状和困扰，引发共鸣",
          "机理区：成分/原理可视化，专家背书",
          "案例区：使用前后对比、真实评价（合规前提下）",
          "FAQ：安全性、副作用、适用人群必须讲透",
        ],
      },
      education: {
        label: "教育 / 课程",
        blurb: "效果可视化，靠 syllabus 和学员成果",
        categories: "需求测评、指南、评测",
        why: "教育产品先要让用户知道自己“缺什么”，测评 quiz 天然适合；指南型讲清学习路径；评测型对比不同课程，帮用户做选择。",
        structure: [
          "Hero：学完能得到什么（具体成果）+ 免费试听 CTA",
          "痛点区：现在学不好的后果/错过的机会",
          "课程大纲：模块化展示，越具体越可信",
          "学员成果：案例、就业/提分数据",
          "FAQ：退费政策、学习时间、适合人群",
        ],
      },
      gaming: {
        label: "游戏 / 娱乐",
        blurb: "冲动驱动，靠刺激和稀缺性",
        categories: "优惠券、榜单、需求测评",
        why: "游戏娱乐决策快、冲动性强，优惠券页用福利直接拉新；榜单型满足“最好玩”的比较欲；测评 quiz 用趣味互动顺带分发。",
        structure: [
          "Hero：视觉冲击 + 福利（首充/礼包）+ 立即领取",
          "刺激区：玩法亮点、画面/视频展示",
          "福利区：礼包、返利、限时活动集中轰炸",
          "榜单/评价：排名、玩家评价营造热度",
          "CTA：稀缺性（限时/限量）贯穿全页",
        ],
      },
    },
  },
  generate: {
    intro:
      "把第 ① 步的拆解结论和第 ② 步选定的结构告诉 AI：选模板或已有页面做底，填好受众和卖点，一键生成、一键部署。",
  },
  abtest: {
    intro:
      "新页面上线别凭感觉：建一个 A/B 实验，让新旧版本各分一半流量，用点击和转化数据判定胜者。",
    openExperiments: "打开实验管理页 →",
    nextStepTitle: "落地页就绪，下一步",
    nextStepHint: "页面定稿后，去自动化广告生成广告系列结构和 RSA 文案，开始投流。",
    nextStepAds: "去自动化广告 →",
  },
};

const en: LanderPipelineDict = {
  page: {
    title: "Landing Page Pipeline",
    description:
      "Walk the 4 steps in marketing order: scrape & deconstruct competitors → get structure recommendations by vertical → generate with AI → validate with A/B tests. Enter any step directly or go in order.",
  },
  steps: {
    scrape: "① Scrape & deconstruct",
    recommend: "② Structure picks",
    generate: "③ Build with AI",
    abtest: "④ A/B test",
    pages: "My landing pages",
  },
  stepDesc: {
    scrape:
      "Paste a competitor's landing page URL to scrape and deconstruct its structure (Hero / pain points / comparison table / FAQ / CTA) — see what high-converting pages look like.",
    recommend:
      "High-converting structures differ by vertical. Pick yours to get recommended template types and page structure first.",
    generate:
      "Feed the deconstruction and your offer info to the AI: generate the copy and deploy in one click.",
    abtest:
      "Create an A/B experiment for old vs new pages, split traffic, and let click and conversion data pick the winner.",
    pages: "All existing landing pages under this offer.",
  },
  nav: {
    next: "Next →",
    prev: "← Prev",
    markDone: "Mark step done",
    markedDone: "Done ✓",
    unmark: "Unmark",
    openStandalone: "Open standalone page →",
  },
  status: {
    done: "Done",
    todo: "To do",
  },
  scrape: {
    intro:
      "Study the winners first: paste a top-performing competitor URL and the AI deconstructs its structure and scores it section by section. Feed the takeaways into step ③.",
  },
  recommend: {
    intro:
      "High-converting structures differ by vertical. Pick your vertical to see which template types to use and where to put the emphasis.",
    pickVertical: "Pick your vertical",
    recommendedCategories: "Recommended template types",
    whyItWorks: "Why this structure",
    structureTitle: "High-converting structure checklist",
    openTemplateLibrary: "Browse the template library →",
    verticals: {
      saas: {
        label: "SaaS / Software",
        blurb: "Long decision cycles — trust and comparison close deals",
        categories: "Comparison, guide, quiz",
        why: "SaaS buyers compare several vendors; a comparison table decides for them. Guides build authority; quizzes filter high-intent users toward a trial.",
        structure: [
          "Hero: pain point + core value prop + free-trial CTA above the fold",
          "Trust: customer logos, metrics (x% lift, x hours saved)",
          "Comparison table: vs competitors / vs status quo",
          "FAQ: defuse pricing, migration, data-security objections",
          "CTA: at least 3x per page, trial button always reachable",
        ],
      },
      ecommerce: {
        label: "E-commerce / Physical",
        blurb: "Impulse meets comparison — reviews and deals push orders",
        categories: "Review, listicle, coupon",
        why: "Shoppers read reviews before buying physical goods; listicles serve the comparison urge; coupon pages give a reason to buy now.",
        structure: [
          "Hero: product visual + key benefit + limited-time deal",
          "Pain points: how bad the current alternative is",
          "Review/listicle: spec comparison table, visual star ratings",
          "Trust: real review screenshots, sales numbers, return policy",
          "CTA: countdown + low-stock nudge for the final push",
        ],
      },
      finance: {
        label: "Finance / Insurance",
        blurb: "High trust bar — authority and transparency close deals",
        categories: "Guide, comparison, quiz",
        why: "Finance decisions are heavy; guides educate before converting, comparison tables win on transparency, quizzes double as lead capture.",
        structure: [
          "Hero: authority badges (licensed/partners) + core benefit",
          "Trust: credentials, regulation info, user scale above the fold",
          "Comparison table: rates, limits, requirements side by side",
          "Guide section: explain process and risks, compliance-first copy",
          "CTA: free consultation/quote — low-friction lead capture",
        ],
      },
      health: {
        label: "Health / Supplements",
        blurb: "Results-sensitive — cases and ingredients persuade",
        categories: "Review, listicle, guide",
        why: "Health converts on real cases and ingredient proof. Reviews explain mechanism; listicles borrow 'best of' psychology; guides build expertise — never overclaim efficacy.",
        structure: [
          "Hero: who it's for + the struggle + gentle CTA",
          "Pain points: describe symptoms to build resonance",
          "Mechanism: visualize ingredients/science, expert backing",
          "Cases: before/after, real testimonials (compliance permitting)",
          "FAQ: safety, side effects, suitability must be thorough",
        ],
      },
      education: {
        label: "Education / Courses",
        blurb: "Outcome-visible — syllabus and student results sell",
        categories: "Quiz, guide, review",
        why: "First show learners what they're missing — quizzes fit naturally. Guides map the learning path; reviews compare course options.",
        structure: [
          "Hero: concrete outcome + free preview CTA",
          "Pain points: cost of not learning / missed opportunity",
          "Syllabus: modular, the more specific the more credible",
          "Student results: cases, placement/score data",
          "FAQ: refund policy, time needed, who it's for",
        ],
      },
      gaming: {
        label: "Gaming / Entertainment",
        blurb: "Impulse-driven — excitement and scarcity convert",
        categories: "Coupon, listicle, quiz",
        why: "Fast, impulsive decisions: coupon pages pull with perks, listicles feed the 'best game' comparison, quizzes distribute through fun.",
        structure: [
          "Hero: visual punch + perk (starter pack/gift) + claim now",
          "Excitement: feature highlights, trailers/gameplay",
          "Perks: gift packs, rebates, limited events front and center",
          "Social proof: rankings, player reviews, hype signals",
          "CTA: scarcity (limited-time/quantity) throughout",
        ],
      },
    },
  },
  generate: {
    intro:
      "Hand the AI your step ① takeaways and step ② structure: pick a template or existing page as the base, fill in audience and selling points, generate and deploy in one click.",
  },
  abtest: {
    intro:
      "Don't guess on a new page: create an A/B experiment, split traffic 50/50 between old and new, and let click and conversion data crown the winner.",
    openExperiments: "Open experiments →",
    nextStepTitle: "Landing page ready — next",
    nextStepHint: "With the page finalized, generate the campaign structure and RSA copy in Auto Ads.",
    nextStepAds: "Go to Auto Ads →",
  },
};

export const landerPipelineDict: Record<LanderPipelineLang, LanderPipelineDict> = {
  zh,
  en,
};
