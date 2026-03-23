document.addEventListener("DOMContentLoaded", () => {
  const scrapeButton = document.getElementById("scrapeButton");
  const status = document.getElementById("status");

  function setStatus(message, isError = false) {
    if (!status) {
      return;
    }

    status.textContent = message;
    status.dataset.state = isError ? "error" : "normal";
  }

  if (!scrapeButton) {
    console.error("未找到抓取按钮");
    return;
  }

  scrapeButton.addEventListener("click", async () => {
    setStatus("正在连接当前页面...");

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];

      if (!activeTab || !activeTab.id || !activeTab.url) {
        throw new Error("未找到活动标签页");
      }

      const isSupportedPage = /^https:\/\/(ti\.luogu\.com\.cn|www\.luogu\.com\.cn|vjudge\.net)\//.test(activeTab.url);
      if (!isSupportedPage) {
        throw new Error("请先打开洛谷页面、洛谷有题页面，或 VJudge 比赛题面/题单页面");
      }

      if (/^https:\/\/ti\.luogu\.com\.cn\/problemset\/?(?:[?#].*)?$/.test(activeTab.url)) {
        setStatus("正在后台标签页扫描分页并批量导出题库，请稍候...");
      } else if (/^https:\/\/www\.luogu\.com\.cn\/record\/list(?:[/?#]|$)/.test(activeTab.url)) {
        setStatus("正在定位 AC 记录并打包 problem.md 与 std.cpp...");
      } else if (/^https:\/\/www\.luogu\.com\.cn\/record\/\d+(?:[/?#]|$)/.test(activeTab.url)) {
        setStatus("正在补全题面并打包 problem.md 与 std.cpp...");
      } else if (/^https:\/\/www\.luogu\.com\.cn\/problem\/[^/?#]+(?:[/?#]|$)/.test(activeTab.url)) {
        setStatus("正在抓取题面并查找本账号 AC 代码，随后打包...");
      } else if (/^https:\/\/vjudge\.net\/contest\/\d+#problem\//.test(activeTab.url)) {
        setStatus("正在导出 VJudge 当前比赛题面...");
      } else if (/^https:\/\/vjudge\.net\/contest\/\d+#status/.test(activeTab.url)) {
        setStatus("正在导出比赛题面，并尝试从状态页补全本账号 AC 代码...");
      } else if (/^https:\/\/vjudge\.net\/contest\/\d+(?:[/?#]|$)/.test(activeTab.url)) {
        setStatus("正在批量导出 VJudge 比赛题面，并尝试补全本账号 AC 代码...");
      } else if (/^https:\/\/ti\.luogu\.com\.cn\//.test(activeTab.url)) {
        setStatus("正在后台标签页处理并导出 Markdown...");
      } else {
        setStatus("正在处理页面并导出 Markdown...");
      }

      if (/^https:\/\/www\.luogu\.com\.cn\/problem\/[^/?#]+(?:[/?#]|$)/.test(activeTab.url)) {
        chrome.runtime.sendMessage({
          action: "startScrapeFlow",
          tabId: activeTab.id,
          url: activeTab.url
        }).catch((error) => {
          console.error("后台抓取启动失败", error);
        });
        window.close();
        return;
      }

      const response = await chrome.runtime.sendMessage({
        action: "startScrapeFlow",
        tabId: activeTab.id,
        url: activeTab.url
      });

      if (!response) {
        throw new Error("内容脚本未返回结果");
      }

      if (response.status !== "success") {
        throw new Error(response.message || "抓取失败");
      }

      if (response.pageType === "ti-problemset-index") {
        setStatus(response.filename || "已批量导出题库");
      } else if (response.pageType === "luogu-package") {
        setStatus(`已导出目录包: ${response.filename || "problem.md / std.cpp"}`);
      } else if (response.pageType === "luogu-problem-only") {
        setStatus(`已导出题面: ${response.filename || "problem.md"}；未识别到当前账号，未导出 std.cpp`);
      } else if (response.pageType === "vjudge-contest-package") {
        setStatus(`已导出比赛目录包: ${response.filename || "比赛文件夹"}`);
      } else {
        setStatus(`已导出: ${response.filename || "markdown 文件"}`);
      }
    } catch (error) {
      console.error("抓取失败", error);
      setStatus(error.message || "抓取失败", true);
    }
  });
});