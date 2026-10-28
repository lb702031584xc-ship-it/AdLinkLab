/**
 * 开户前检查清单 —— 给第一次跑 Google Ads 联盟投流的人。
 *
 * 这些不是「优化技巧」，是「不做就会白亏」的前置条件。
 * 静态页，不查数据；每一项都是可勾选的确认动作。
 */
export default function StartPage() {
  const sections: Array<{
    title: string;
    why: string;
    items: string[];
  }> = [
    {
      title: "1. 账户",
      why: "账户类型决定封号概率，比素材质量更影响你能不能持续跑。",
      items: [
        "确认账户类型：个人号 vs 代理开户（代理开户通常更稳，但受制于代理）",
        "一个主体不要同时开多个账户去投同一类目（关联封号最常见的原因）",
        "账户注册信息、支付方式、登录设备尽量保持独立",
        "先确认目标国家是否需要额外的税务/资质信息",
      ],
    },
    {
      title: "2. 支付",
      why: "卡被拒 = 广告停投，而且会在账户留下风险标记。",
      items: [
        "准备至少两张可用卡（一张主用、一张备用）",
        "确认卡支持美元结算与目标国家扣款",
        "不要在多个账户复用同一张卡",
        "预留 3–5 天的支付验证时间，别等到要投放才发现卡不行",
      ],
    },
    {
      title: "3. 时区与币种",
      why: "报表时区错一天，你的所有「昨天数据」判断都是错的。",
      items: [
        "确认 Google Ads 账户时区（建议设成你每天看报表的时区）",
        "确认账户币种与信用卡结算币种的关系（有汇率损耗）",
        "确认联盟后台的结算币种，把两边统一成同一币种再算 ROAS",
      ],
    },
    {
      title: "4. 落地页",
      why: "Google 审核看的是落地页，不是你的广告。",
      items: [
        "自有域名 + HTTPS（不要用裸 IP 或短链直跳）",
        "必须有：隐私政策、联系方式、退订/退款说明",
        "页面内容与广告文案一致（关键词要出现在标题或 H1）",
        "移动端能正常打开，首屏 3 秒内加载完",
        "不要做「审核看到一个页面、用户看到另一个」——那是 cloaking，直接封号",
      ],
    },
    {
      title: "5. 合规",
      why: "联盟合同与 Google 政策是两套独立的红线，踩任何一套都白干。",
      items: [
        "确认 offer 是否禁止品牌词竞价（投了就是违约 + 封号）",
        "确认是否禁止直链（direct linking）",
        "确认是否允许 SEM / 付费搜索流量",
        "确认目标国家是否有品类限制（金融、健康、减肥类尤其严格）",
      ],
    },
    {
      title: "6. 收款",
      why: "赚到钱和拿到钱是两件事。",
      items: [
        "确认联盟的打款方式（Payoneer / 电汇 / 平台余额）与起付金额",
        "确认结算周期（Net-30 / Net-60），算进现金流",
        "了解结汇与税务处理方式",
      ],
    },
    {
      title: "7. 心态与止损",
      why: "新手亏钱通常不是选错，是不肯认错。",
      items: [
        "先决定这次最多亏多少（建议 = 一个 offer 的测试预算）",
        "写下止损线：花费达到 3 × 单笔佣金且 0 转化就停",
        "不要在同一个 offer 上连续加预算「想回本」",
        "一次只测 1 个 offer，不要摊给 5 个",
      ],
    },
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl">开户前检查清单</h1>
        <p className="mt-1 text-sm text-ink/60">
          下面这些不是优化技巧，是「不做就会白亏」的前置条件。
          每一项都确认过，再开始投第一块钱。
        </p>
      </div>

      {sections.map((s) => (
        <section key={s.title} className="rounded-xl border border-ink/10 p-4">
          <h2 className="text-sm font-semibold">{s.title}</h2>
          <p className="mt-1 text-xs text-ink/60">{s.why}</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {s.items.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-0.5 select-none text-ink/30">☐</span>
                <span className="text-ink/80">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="text-xs text-ink/50">
        检查完再开始。这套系统能帮你算保本线、拦超价出价、判测试阶段，
        但这些前置项它替不了——它们决定你有没有资格上牌桌。
      </p>
    </div>
  );
}
