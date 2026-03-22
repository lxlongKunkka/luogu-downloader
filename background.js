const TI_PROBLEMSET_ROOT_PATTERN = /^https:\/\/ti\.luogu\.com\.cn\/problemset\/[^/?#]+\/?(?:[?#].*)?$/;
const TI_PROBLEMSET_INDEX_PATTERN = /^https:\/\/ti\.luogu\.com\.cn\/problemset\/?(?:[?#].*)?$/;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action !== "startScrapeFlow") {
		return false;
	}

	runScrapeFlow(request.tabId, request.url)
		.then((result) => sendResponse({ status: "success", ...result }))
		.catch((error) => {
			console.error("scrape flow failed", error);
			sendResponse({
				status: "error",
				message: error.message || "抓取失败"
			});
		});

	return true;
});

function buildTiTrainingUrl(url) {
	if (!TI_PROBLEMSET_ROOT_PATTERN.test(url) || /\/training(?:[/?#]|$)/.test(url)) {
		return "";
	}

	const parsedUrl = new URL(url);
	parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "") + "/training";
	parsedUrl.search = "";
	parsedUrl.hash = "";
	return parsedUrl.toString();
}

async function runScrapeFlow(tabId, url) {
	if (!tabId || !url) {
		throw new Error("缺少标签页信息");
	}

	const sourceTab = await chrome.tabs.get(tabId);
	const windowId = sourceTab.windowId;

	if (TI_PROBLEMSET_INDEX_PATTERN.test(url)) {
		const batchResult = await exportAllProblemsetsFromIndex(windowId, url);
		return {
			redirected: false,
			filename: `已导出 ${batchResult.exportedCount} 个题库，并生成索引 ${batchResult.indexFilename}`,
			pageType: "ti-problemset-index"
		};
	}

	const redirectUrl = buildTiTrainingUrl(url);
	const targetUrl = redirectUrl || url;

	if (/^https:\/\/ti\.luogu\.com\.cn\//.test(url)) {
		return withWorkerTab(windowId, targetUrl, async (workerTabId) => {
			const response = await sendScrapeMessageWithRetry(workerTabId);
			if (!response) {
				throw new Error("内容脚本未返回结果");
			}

			if (response.status !== "success") {
				throw new Error(response.message || "抓取失败");
			}

			return {
				redirected: Boolean(redirectUrl),
				filename: response.filename,
				pageType: response.pageType
			};
		});
	}

	const response = await sendScrapeMessageWithRetry(tabId);
	if (!response) {
		throw new Error("内容脚本未返回结果");
	}

	if (response.status !== "success") {
		throw new Error(response.message || "抓取失败");
	}

	return {
		redirected: Boolean(redirectUrl),
		filename: response.filename,
		pageType: response.pageType
	};
}

async function exportAllProblemsetsFromIndex(windowId, startUrl) {
	const collection = await collectAllProblemsetEntries(windowId, startUrl);
	if (collection.problemsets.length === 0) {
		throw new Error("未找到可导出的题库链接");
	}

	const exportResults = [];
	for (const problemset of collection.problemsets) {
		const exportResult = await withWorkerTab(windowId, problemset.url, async (workerTabId) => {
			const response = await sendScrapeMessageWithRetry(workerTabId);
			if (!response || response.status !== "success") {
				throw new Error(response?.message || `导出失败: ${problemset.url}`);
			}

			return {
				title: problemset.title,
				url: problemset.url,
				filename: response.filename || "",
				pageType: response.pageType || ""
			};
		});

		exportResults.push(exportResult);
		await sleep(300);
	}

	const indexMarkdown = buildProblemsetIndexMarkdown(collection, exportResults);
	const indexFilename = `${sanitizeFilename(collection.title || "ti_problemset_index")}_index.md`;
	await downloadTextFile(indexMarkdown, indexFilename);

	return {
		exportedCount: exportResults.length,
		indexFilename,
		pagesScanned: collection.pagesScanned,
		problemsets: collection.problemsets,
		results: exportResults
	};
}

async function collectAllProblemsetEntries(windowId, startUrl) {
	const queue = [normalizeComparableUrl(startUrl)];
	const visitedPages = new Set();
	const problemsetMap = new Map();
	let listTitle = "题库列表";

	while (queue.length > 0) {
		const pageUrl = queue.shift();
		if (!pageUrl || visitedPages.has(pageUrl)) {
			continue;
		}

		visitedPages.add(pageUrl);
		const pageData = await withWorkerTab(windowId, pageUrl, async (workerTabId) => {
			const response = await sendTabMessageWithRetry(workerTabId, {
				action: "collectTiProblemsetPageData"
			});

			if (!response || response.status !== "success") {
				throw new Error(response?.message || `收集题库链接失败: ${pageUrl}`);
			}

			return response.pageData || {};
		});
		if (pageData.title) {
			listTitle = pageData.title;
		}

		(pageData.problemsets || []).forEach((item) => {
			if (!item?.url || problemsetMap.has(item.url)) {
				return;
			}

			problemsetMap.set(item.url, {
				title: item.title || item.url,
				url: item.url,
				sourcePage: pageUrl
			});
		});

		(pageData.paginationLinks || []).forEach((nextPage) => {
			const normalizedPage = normalizeComparableUrl(nextPage);
			if (!visitedPages.has(normalizedPage) && !queue.includes(normalizedPage)) {
				queue.push(normalizedPage);
			}
		});
	}

	return {
		title: listTitle,
		startUrl,
		pagesScanned: Array.from(visitedPages),
		problemsets: Array.from(problemsetMap.values())
	};
}

async function waitForTabReady(tabId, expectedUrl = "") {
	const timeoutAt = Date.now() + 20000;

	while (Date.now() < timeoutAt) {
		const tab = await chrome.tabs.get(tabId);
		const statusReady = tab.status === "complete";
		const urlReady = !expectedUrl || normalizeComparableUrl(tab.url || "") === normalizeComparableUrl(expectedUrl);

		if (statusReady && urlReady) {
			return tab;
		}

		await sleep(250);
	}

	throw new Error("等待页面加载超时");
}

async function sendScrapeMessageWithRetry(tabId, attempt = 0) {
	return sendTabMessageWithRetry(tabId, { action: "startScraping" }, attempt);
}

async function sendTabMessageWithRetry(tabId, message, attempt = 0) {
	try {
		return await chrome.tabs.sendMessage(tabId, message);
	} catch (error) {
		if (attempt >= 8) {
			throw error;
		}

		await sleep(500);
		return sendTabMessageWithRetry(tabId, message, attempt + 1);
	}
}

async function prepareTabForNavigation(tabId) {
	try {
		await sendTabMessageWithRetry(tabId, { action: "prepareNavigationAway" }, 2);
		await sleep(150);
	} catch (error) {
		console.warn("prepare navigation skipped", error);
	}
}

async function withWorkerTab(windowId, url, task) {
	const workerTab = await chrome.tabs.create({
		windowId,
		url,
		active: false
	});

	try {
		await waitForTabReady(workerTab.id, url);
		await sleep(800);
		return await task(workerTab.id);
	} finally {
		await closeWorkerTab(workerTab.id);
	}
}

async function closeWorkerTab(tabId) {
	try {
		await prepareTabForNavigation(tabId);
	} catch (error) {
		console.warn("worker tab prepare close skipped", error);
	}

	try {
		await chrome.tabs.remove(tabId);
	} catch (error) {
		console.warn("worker tab close skipped", error);
	}
}

function sleep(duration) {
	return new Promise((resolve) => setTimeout(resolve, duration));
}

function normalizeComparableUrl(url) {
	return url.replace(/#.*$/, "").replace(/\/+$/, "");
}

async function downloadTextFile(content, filename) {
	const dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;
	await chrome.downloads.download({
		url: dataUrl,
		filename,
		saveAs: false,
		conflictAction: "uniquify"
	});
}

function buildProblemsetIndexMarkdown(collection, exportResults) {
	const lines = [
		`# ${collection.title || "题库导出索引"}`,
		"",
		`来源：${collection.startUrl}`,
		"",
		"## 统计",
		"",
		`- 扫描分页数：${collection.pagesScanned.length}`,
		`- 导出题库数：${exportResults.length}`,
		"",
		"## 分页",
		""
	];

	collection.pagesScanned.forEach((pageUrl) => {
		lines.push(`- ${pageUrl}`);
	});

	lines.push("", "## 题库清单", "");
	exportResults.forEach((item, index) => {
		lines.push(`${index + 1}. ${item.title || item.filename || item.url}`);
		lines.push(`   - 题库地址：${item.url}`);
		if (item.filename) {
			lines.push(`   - 导出文件：${item.filename}`);
		}
	});

	return `${lines.join("\n").trim()}\n`;
}

function sanitizeFilename(name) {
	return (name || "luogu-export")
		.replace(/[\\/:*?"<>|]/g, "_")
		.replace(/\s+/g, "_")
		.slice(0, 120);
}