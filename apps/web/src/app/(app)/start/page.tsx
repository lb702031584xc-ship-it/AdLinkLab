/**
 * 新手操作流程 —— 从选品到投放，按顺序做。
 *
 * 核心原则只有一条：**先算钱，再选品。**
 * 大多数新手亏钱不是投得不好，是选了一个「佣金根本付不起点击」的 offer。
 */

interface Step {
  no: string;
  title: string;
  where: string;
  do: string[];
  pass: string;
  fail: string;
  trap?: string;
}

const STEPS: Step[] = [
  {
    no: "1",
    title: "导入商品",
    where: "商品库（Catalog）→ 同步",
    do: [
      "选一个联盟网络（PB / YP / Amazon），同步商品",
      "确认同步下来的商品带「价格」和「佣金率」——这是后面算钱的原料",
    ],
    pass: "商品数 ≥ 50，且价格与佣金率不为空",
    fail: "同步不到就换网络或换品类，别手动录几百个",
    trap: "别跳过这一步直接手动建 Offer——你会失去后面所有的自动判断",
  },
  {
    no: "2",
    title: "商品库挑选（最关键的一步）",
    where: "商品库 → 挑选",
    do: [
      "① 单笔佣金 < $12 → 砍掉（这个价付不起任何点击）",
      "② 保本 CPC < 类目 CPC → 砍掉（数字上不可能赚）",
      "③ 缺货 → 砍掉",
      "④ 同品牌只留 payout 最高的那一个",
    ],
    pass: "挑出 1–5 个。超过 5 个说明门槛太松",
    fail:
      "一个都没挑出来 → 看提示的主因：佣金太低就换高客单品类，覆盖不了 CPC 就换 offer（不是调出价）",
    trap: "别把「挑不出来」当成工具坏了——它是在告诉你这批货不赚钱",
  },
  {
    no: "3",
    title: "建 Offer",
    where: "选品 → 新建 Offer",
    do: [
      "只建第 2 步挑出来的那几个，不要全建",
      "建的时候确认：单笔佣金、佣金类型、均价都对",
    ],
    pass: "Offer 列表里只有 1–5 条",
    fail: "佣金显示为 0 或未知 → 回商品库检查佣金率是不是没同步",
    trap: "建 50 个 Offer 再筛 = 上次亏钱的做法",
  },
  {
    no: "4",
    title: "跑初筛",
    where: "选品 → 勾选 → 一键初筛",
    do: ["看三样：go / unknown / stop", "重点读 stop 的原因，它写明了被哪一条卡掉"],
    pass: "至少 1 个 go",
    fail: "全是 stop → 看原因：佣金不足 / 品牌没人投广告 / 流量不够",
    trap: "「unknown」不是「没问题」，是「数据不够，判不了」",
  },
  {
    no: "5",
    title: "生成关键词",
    where: "选品 → 生成关键词",
    do: [
      "看每个词的「保本 CPC」——这是你最多能出的价",
      "只留判定为「可测」的词",
      "长尾勾选后复制，格式是 [完全匹配]",
    ],
    pass: "≥ 3 个可测词，且保本 CPC ≥ 这些词的实际 CPC",
    fail: "保本 CPC 低于实际 CPC → 这个 offer 付不起，回第 2 步换",
    trap: "别用广泛匹配。新手用广泛匹配 = 把钱撒给无关搜索",
  },
  {
    no: "6",
    title: "建计划",
    where: "投流 → 自动建计划",
    do: [
      "出价上限 = 保本 CPC（超了系统会拦你）",
      "预算按探针计划：约 100 点击数 / 3 天",
      "先建成 PAUSED，检查完再手动开",
    ],
    pass: "系统没拦你，且预算 ≤ 你能承受的亏损上限",
    fail: "被拦了 → 说明出价高于保本线，改价或换词，别硬开",
    trap: "别用「尽可能提高转化次数」智能出价——你没有真实转化回传，它学不出来",
  },
  {
    no: "7",
    title: "投放",
    where: "Google Ads 手动开",
    do: [
      "加否词：bags / rolls / replacement / parts / accessories / filter / hose / used",
      "给链接加 sub_id（不然以后不知道单从哪来）",
      "手机 4G 点一次自己的广告，确认联盟后台点击数 +1",
    ],
    pass: "自测有点击记录 + 否词已加 + sub_id 已带",
    fail: "自测没记录 → 链接坏了，先修链再花钱",
    trap: "sub_id 忘了加，等于这次测试白做——你永远分不清哪条广告出的单",
  },
  {
    no: "8",
    title: "等（这一步最难）",
    where: "不操作",
    do: [
      "第 1 天：看曝光与 CTR。CTR < 1% → 改文案（不是改出价）",
      "第 3 天：还几乎没曝光 → 查出价是否被压死、广告是否审核通过",
      "到 200 点击：才算能下结论",
    ],
    pass: "200 点击前不做任何改动",
    fail: "样本不足时得出的「不行」都是噪声",
    trap: "每天改一点 = 每天重置学习期 = 永远跑不出结果",
  },
  {
    no: "9",
    title: "判定与复盘",
    where: "今天 / 复盘",
    do: [
      "看阶段：未开始 / 没拿到量 / 样本不足 / 该停 / 有苗头 / 可扩量",
      "「没拿到量」是投放设置问题，「该停」才是 offer 问题——两者别混",
      "看校准：计划 EPC 是实测的几倍，下一批假设要除以它",
    ],
    pass: "能说清这次是「offer 不行」还是「投放没跑起来」",
    fail: "分不清 → 大概率是没拿到量，先去查出价和审核",
    trap: "「可扩量」需要 ≥10 次转化。1 单就加预算，是在赌运气",
  },
];

export default function StartPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl">新手操作流程</h1>
        <p className="mt-1 text-sm text-ink/70">
          按顺序做，别跳步。整套流程只有一条原则：
          <strong className="text-ink">先算钱，再选品。</strong>
          大多数新手亏钱不是投得不好，是选了一个「佣金根本付不起点击」的 offer。
        </p>
      </div>

      {STEPS.map((s) => (
        <section key={s.no} className="rounded-xl border border-ink/10 p-4">
          <div className="flex items-baseline gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
              {s.no}
            </span>
            <h2 className="text-base font-semibold">{s.title}</h2>
          </div>
          <p className="mt-1 text-xs text-ink/50">在哪：{s.where}</p>

          <ul className="mt-2 flex flex-col gap-1 text-sm text-ink/85">
            {s.do.map((d) => (
              <li key={d}>· {d}</li>
            ))}
          </ul>

          <div className="mt-2 grid gap-1 text-xs">
            <p className="text-emerald-700">过关：{s.pass}</p>
            <p className="text-amber-700">不过：{s.fail}</p>
            {s.trap && <p className="text-red-600">别做：{s.trap}</p>}
          </div>
        </section>
      ))}

      <section className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
        <h2 className="text-sm font-semibold">如果只能记住一句话</h2>
        <p className="mt-1 text-sm text-ink/75">
          保本 CPC = 单笔佣金 × 转化率。你出的每一个价，都必须在这条线下。
          线下就是赚，线上就是亏——跟你选什么词、写什么文案都没关系。
        </p>
      </section>
    </div>
  );
}
