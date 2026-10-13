/* AdLinkLab Offer 抓取 - popup 逻辑
 * 流程：当前 tab 注入 extract.js 提取 → POST 网站 /api/v1/ai/offer-capture
 * 认证：带网站登录态 cookie（credentials:include），无需配 API Key。
 * 未登录会收到 401，提示用户先在浏览器里登录 AdLinkLab。
 */
(function () {
  "use strict";
  var DEFAULT_SITE = "https://adtlab.xyz";

  var pageUrlEl = document.getElementById("pageUrl");
  var captureBtn = document.getElementById("capture");
  var resultEl = document.getElementById("result");
  var errorEl = document.getElementById("error");
  var openSiteEl = document.getElementById("openSite");

  function getSite(cb) {
    chrome.storage.local.get({ siteUrl: DEFAULT_SITE }, function (items) {
      cb((items.siteUrl || DEFAULT_SITE).replace(/\/+$/, ""));
    });
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
    resultEl.style.display = "none";
  }

  function showResult(data) {
    var price = data.price != null ? data.price + " " + (data.currency || "") : "未识别到价格";
    resultEl.innerHTML =
      '<div class="row"><span class="label">标题：</span>' + escapeHtml(data.title || "(无)") + "</div>" +
      '<div class="row"><span class="label">价格：</span>' + escapeHtml(price) + "</div>" +
      '<div class="row" style="color:#2e7d32">✓ 已发送，去网站「一键推演报告 → 插件抓取」选用</div>';
    resultEl.style.display = "block";
    errorEl.style.display = "none";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 显示当前 tab
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (tab && tab.url) {
      pageUrlEl.textContent = tab.url.length > 90 ? tab.url.slice(0, 90) + "…" : tab.url;
    } else {
      pageUrlEl.textContent = "无法读取当前页面";
      captureBtn.disabled = true;
    }
  });

  openSiteEl.addEventListener("click", function (e) {
    e.preventDefault();
    getSite(function (site) {
      chrome.tabs.create({ url: site + "/ai/blueprint" });
    });
  });

  captureBtn.addEventListener("click", function () {
    captureBtn.disabled = true;
    captureBtn.textContent = "抓取中…";
    errorEl.style.display = "none";
    resultEl.style.display = "none";

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        captureBtn.disabled = false;
        captureBtn.textContent = "抓取本页并发送";
        showError("无法读取当前标签页");
        return;
      }
      // 注入提取函数（extract.js 定义 __adlinklab_extract）
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: ["extract.js"] },
        function () {
          if (chrome.runtime.lastError) {
            captureBtn.disabled = false;
            captureBtn.textContent = "抓取本页并发送";
            showError("无法在该页面执行（可能是浏览器内置页面）：" + chrome.runtime.lastError.message);
            return;
          }
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, func: function () { return __adlinklab_extract(); } },
            function (results) {
              if (chrome.runtime.lastError || !results || !results[0]) {
                captureBtn.disabled = false;
                captureBtn.textContent = "抓取本页并发送";
                showError("页面提取失败，请刷新页面重试");
                return;
              }
              sendToSite(results[0].result);
            }
          );
        }
      );
    });
  });

  function sendToSite(data) {
    getSite(function (site) {
      fetch(site + "/api/v1/ai/offer-capture", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
        .then(function (res) {
          if (res.status === 401) {
            throw new Error("未登录：请先在浏览器里登录 AdLinkLab（" + site + "），再点抓取");
          }
          if (!res.ok) {
            return res.json().catch(function () { return {}; }).then(function (body) {
              throw new Error(body.message || body.error || ("发送失败（" + res.status + "）"));
            });
          }
          return res.json();
        })
        .then(function (json) {
          captureBtn.disabled = false;
          captureBtn.textContent = "抓取本页并发送";
          showResult(json);
        })
        .catch(function (err) {
          captureBtn.disabled = false;
          captureBtn.textContent = "抓取本页并发送";
          showError(String((err && err.message) || err));
        });
    });
  }
})();
