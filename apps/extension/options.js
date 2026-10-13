(function () {
  "use strict";
  var input = document.getElementById("siteUrl");
  var saved = document.getElementById("saved");
  chrome.storage.local.get({ siteUrl: "https://adtlab.xyz" }, function (items) {
    input.value = items.siteUrl || "https://adtlab.xyz";
  });
  document.getElementById("save").addEventListener("click", function () {
    var v = (input.value || "").trim().replace(/\/+$/, "") || "https://adtlab.xyz";
    chrome.storage.local.set({ siteUrl: v }, function () {
      saved.style.display = "block";
      setTimeout(function () { saved.style.display = "none"; }, 2000);
    });
  });
})();
