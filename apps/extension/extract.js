/**
 * 注入到 offer 页执行的提取函数（纯函数，不依赖插件上下文）。
 * 抓：URL、标题、meta 描述、正文（渲染后 innerText，前 20000 字）。
 * 价格由 AdLinkLab 后端统一提取（与服务器抓取同一套规则）。
 */
function __adlinklab_extract() {
  var title = document.title || "";
  var md = document.querySelector(
    'meta[name="description"], meta[property="og:description"]'
  );
  var description = md ? md.getAttribute("content") || "" : "";
  var bodyText = "";
  try {
    bodyText = (document.body && document.body.innerText) || "";
  } catch (e) {
    bodyText = "";
  }
  var html = "";
  try {
    html = document.documentElement ? document.documentElement.outerHTML || "" : "";
  } catch (e) {
    html = "";
  }
  return {
    url: location.href,
    title: title,
    description: description,
    text: bodyText.slice(0, 20000),
    html: html.slice(0, 200000),
  };
}
