# AdLinkLab Offer 抓取（Chrome 插件）

在任意 offer 页面（**包括 Amazon**，因为用的是你自己的真实浏览器）一键抓取，
发送到 AdLinkLab「一键推演报告」选用。不走服务器抓取，不怕反爬。

## 安装（2 分钟）

1. Chrome 打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录（`apps/extension`）
4. 在 Chrome 里登录你的 AdLinkLab 网站（`https://adtlab.xyz`）一次
5. 打开任意 offer 页面 → 点工具栏插件图标 → 「抓取本页并发送」
6. 去网站「分析判断 → 一键推演报告 → 🧩 插件抓取」里选用刚才的抓取

## 原理

- 插件在当前页面注入 `extract.js`，提取标题 / meta 描述 / 渲染后正文（前 20000 字）
- `fetch(site + "/api/v1/ai/offer-capture", { credentials: "include" })` 带网站登录态 cookie 发送，无需 API Key
- 后端用同一套 `extractOfferMeta` 规则提取价格/币种，存入 `offer_captures` 表（按租户隔离，保留最近记录）

## 换网站地址

插件设置页（`chrome://extensions` → 插件「详情」→「扩展程序选项」）可改网站地址。
如果是非 `adtlab.xyz` 的域名，还要在 `manifest.json` 的 `host_permissions` 里加上该域名后重新加载插件。

## 权限说明

- `activeTab`：只在点击插件图标时读取当前标签页
- `scripting`：向当前页注入提取脚本
- `storage`：保存网站地址设置
- `host_permissions(adtlab.xyz)`：向你的网站发送抓取结果（带登录态）
