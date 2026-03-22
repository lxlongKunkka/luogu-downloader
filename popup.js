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

      const isSupportedPage = /^https:\/\/(ti|www)\.luogu\.com\.cn\//.test(activeTab.url);
      if (!isSupportedPage) {
        throw new Error("请先打开洛谷主站题目页或洛谷有题页面");
      }

      if (/^https:\/\/ti\.luogu\.com\.cn\/problemset\/?(?:[?#].*)?$/.test(activeTab.url)) {
        setStatus("正在后台标签页扫描分页并批量导出题库，请稍候...");
      } else if (/^https:\/\/ti\.luogu\.com\.cn\//.test(activeTab.url)) {
        setStatus("正在后台标签页处理并导出 Markdown...");
      } else {
        setStatus("正在处理页面并导出 Markdown...");
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
      } else {
        setStatus(`已导出: ${response.filename || "markdown 文件"}`);
      }
    } catch (error) {
      console.error("抓取失败", error);
      setStatus(error.message || "抓取失败", true);
    }
  });
});