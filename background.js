const TI_PROBLEMSET_ROOT_PATTERN = /^https:\/\/ti\.luogu\.com\.cn\/problemset\/[^/?#]+\/?(?:[?#].*)?$/;
const TI_PROBLEMSET_INDEX_PATTERN = /^https:\/\/ti\.luogu\.com\.cn\/problemset\/?(?:[?#].*)?$/;
const LUOGU_PROBLEM_PAGE_PATTERN = /^https:\/\/www\.luogu\.com\.cn\/problem\/[^/?#]+(?:[/?#]|$)/;
const LUOGU_RECORD_LIST_PATTERN = /^https:\/\/www\.luogu\.com\.cn\/record\/list(?:[/?#]|$)/;
const LUOGU_RECORD_PAGE_PATTERN = /^https:\/\/www\.luogu\.com\.cn\/record\/\d+(?:[/?#]|$)/;
const VJUDGE_CONTEST_PATTERN = /^https:\/\/vjudge\.net\/contest\/\d+(?:[/?#]|$)/;
const ACTION_START_SCRAPING = "startScrapingV2";
const ACTION_COLLECT_CURRENT_PAGE_EXPORT_DATA = "collectCurrentPageExportDataV2";
const ACTION_COLLECT_TI_PROBLEMSET_PAGE_DATA = "collectTiProblemsetPageDataV2";
const ACTION_COLLECT_LUOGU_RECORD_LIST_PAGE_DATA = "collectLuoguRecordListPageDataV2";
const ACTION_COLLECT_VJUDGE_CONTEST_MANIFEST = "collectVjudgeContestManifestV2";
const ACTION_COLLECT_VJUDGE_CONTEST_STATUS = "collectVjudgeContestStatusV2";
const ACTION_COLLECT_VJUDGE_FILTERED_STATUS_SOURCE = "collectVjudgeFilteredStatusSourceV2";
const ACTION_PREPARE_NAVIGATION_AWAY = "prepareNavigationAwayV2";
const VJUDGE_PACKAGE_STEP_COOLDOWN_MS = 1200;
const VJUDGE_PACKAGE_PROBLEM_COOLDOWN_MS = 1800;

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

	if (LUOGU_PROBLEM_PAGE_PATTERN.test(url) || LUOGU_RECORD_LIST_PATTERN.test(url) || LUOGU_RECORD_PAGE_PATTERN.test(url)) {
		const exportResult = await exportLuoguPackage(windowId, tabId, url);
		return {
			redirected: false,
			filename: exportResult.filename,
			pageType: exportResult.pageType,
			recordUrl: exportResult.recordUrl || ""
		};
	}

	if (VJUDGE_CONTEST_PATTERN.test(url)) {
		if (!/#problem\//.test(url)) {
			return exportVjudgeContestPackage(windowId, tabId);
		}

		const response = await sendVjudgeScrapeMessageWithRetry(tabId);
		if (!response || response.status !== "success") {
			throw new Error(response?.message || "抓取失败");
		}

		return {
			redirected: false,
			filename: response.filename,
			pageType: response.pageType
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

async function exportLuoguPackage(windowId, sourceTabId, startUrl) {
	if (LUOGU_PROBLEM_PAGE_PATTERN.test(startUrl)) {
		await sleep(300);
		const officialMarkdown = await collectOfficialProblemMarkdownFromPage(sourceTabId);
		const problemData = await collectCurrentPageExportData(sourceTabId);
		if (officialMarkdown) {
			problemData.content = officialMarkdown;
		}
		if (!problemData.problemId) {
			throw new Error("未识别到题号，无法组装目录包");
		}

		if (!problemData.currentUserId) {
			return downloadProblemOnlyPackage(problemData);
		}

		const recordData = await collectAcceptedRecordExportData(windowId, buildLuoguRecordListUrl(problemData.problemId, problemData.currentUserId));
		return downloadLuoguPackage(problemData, recordData, recordData.recordUrl);
	}

	if (LUOGU_RECORD_LIST_PATTERN.test(startUrl)) {
		const recordData = await collectAcceptedRecordExportData(windowId, startUrl, sourceTabId);
		const problemData = await collectProblemExportData(windowId, recordData.problemId);
		return downloadLuoguPackage(problemData, recordData, recordData.recordUrl);
	}

	if (LUOGU_RECORD_PAGE_PATTERN.test(startUrl)) {
		const recordData = await collectCurrentPageExportData(sourceTabId);
		const problemData = await collectProblemExportData(windowId, recordData.problemId);
		return downloadLuoguPackage(problemData, recordData, startUrl);
	}

	throw new Error("暂不支持当前页面的目录包导出");
}

async function collectAcceptedRecordExportData(windowId, recordListUrl, currentTabId) {
	const pageData = currentTabId
		? await collectLuoguRecordListPageDataFromTab(currentTabId)
		: await withWorkerTab(windowId, recordListUrl, async (workerTabId) => collectLuoguRecordListPageDataFromTab(workerTabId));

	if (!pageData.recordUrl) {
		throw new Error("未在记录列表中找到可导出的提交记录");
	}

	const recordData = await withWorkerTab(windowId, pageData.recordUrl, async (workerTabId) => collectCurrentPageExportData(workerTabId));
	return {
		...recordData,
		recordUrl: pageData.recordUrl
	};
}

async function collectLuoguRecordListPageDataFromTab(tabId) {
	const response = await sendTabMessageWithRetry(tabId, {
		action: ACTION_COLLECT_LUOGU_RECORD_LIST_PAGE_DATA
	});

	if (!response || response.status !== "success") {
		throw new Error(response?.message || "收集提交记录失败");
	}

	return response.pageData || {};
}

async function collectCurrentPageExportData(tabId) {
	const response = await sendTabMessageWithRetry(tabId, {
		action: ACTION_COLLECT_CURRENT_PAGE_EXPORT_DATA
	});

	if (!response || response.status !== "success") {
		throw new Error(response?.message || "页面导出失败");
	}

	return response.exportData || {};
}

async function collectVjudgeContestManifestFromTab(tabId) {
	const response = await sendTabMessageWithRetry(tabId, {
		action: ACTION_COLLECT_VJUDGE_CONTEST_MANIFEST
	});

	if (!response || response.status !== "success") {
		throw new Error(response?.message || "收集 VJudge 比赛清单失败");
	}

	return response.manifestData || {};
}

async function collectVjudgeContestStatusFromTab(tabId) {
	const response = await sendTabMessageWithRetry(tabId, {
		action: ACTION_COLLECT_VJUDGE_CONTEST_STATUS
	});

	if (!response || response.status !== "success") {
		throw new Error(response?.message || "收集 VJudge 比赛状态失败");
	}

	return response.statusData || {};
}

async function exportVjudgeContestPackage(windowId, sourceTabId) {
	const manifest = await collectVjudgeContestManifestFromTab(sourceTabId);
	const problems = Array.isArray(manifest?.problems) ? manifest.problems : [];
	if (problems.length === 0) {
		throw new Error("未找到 VJudge 比赛题目列表");
	}

	const folderName = manifest.folderName || sanitizeFilename(`vjudge_${manifest.contestId || "contest"}`);
	const failures = [];
	let downloadedProblemCount = 0;

	for (const problem of problems) {
		const problemUrl = problem.problemUrl || "";
		if (!problemUrl) {
			failures.push({
				problem,
				message: "缺少 VJudge 独立题面链接"
			});
			continue;
		}

		try {
			const exportData = await withWorkerTab(windowId, problemUrl, async (workerTabId) => collectCurrentPageExportData(workerTabId));
			if (exportData?.kind !== "markdown") {
				throw new Error("独立题页未返回 markdown 数据");
			}
			await sleep(VJUDGE_PACKAGE_STEP_COOLDOWN_MS);

			const problemFolderName = sanitizeFilename([
				problem.num || problem.letter || "problem",
				problem.probNum || "",
				problem.title || ""
			].filter(Boolean).join("_"));

			await downloadContentFile(
				exportData.content || "",
				`${folderName}/${problemFolderName}/problem.md`,
				"text/markdown;charset=utf-8"
			);
			downloadedProblemCount += 1;

			const problemNum = problem.num || problem.letter || "";
			if (problemNum) {
				try {
					const sourceData = await collectVjudgeFilteredProblemAcceptedSourceData(windowId, manifest.contestId, problemNum);
					await downloadContentFile(
						sourceData.content || "",
						`${folderName}/${problemFolderName}/std.cpp`,
						"application/octet-stream"
					);
					await sleep(VJUDGE_PACKAGE_STEP_COOLDOWN_MS);
				} catch (error) {
					failures.push({
						problem,
						message: `AC 代码导出失败：${error?.message || "unknown"}`
					});
				}
			}
		} catch (error) {
			failures.push({
				problem,
				message: error?.message || "独立题页导出失败"
			});
		}

		await sleep(VJUDGE_PACKAGE_PROBLEM_COOLDOWN_MS);
	}

	await downloadContentFile(
		manifest.indexContent || "",
		`${folderName}/index.md`,
		"text/markdown;charset=utf-8"
	);

	if (failures.length > 0) {
		await downloadContentFile(
			buildVjudgeFailureReportMarkdown(manifest, failures),
			`${folderName}/failures.md`,
			"text/markdown;charset=utf-8"
		);
	}

	if (downloadedProblemCount === 0) {
		throw new Error(`VJudge 比赛题面全部导出失败，共 ${failures.length} 题失败`);
	}

	return {
		filename: `${folderName}\\**`,
		pageType: "vjudge-contest-package"
	};
}

async function collectVjudgeFilteredStatusSourceFromTab(tabId, problemNum) {
	const response = await sendTabMessageWithRetry(tabId, {
		action: ACTION_COLLECT_VJUDGE_FILTERED_STATUS_SOURCE,
		problemNum
	});

	if (!response || response.status !== "success") {
		throw new Error(response?.message || `收集题号 ${problemNum} 的 VJudge AC 代码失败`);
	}

	return response.sourceData || {};
}

async function collectVjudgeFilteredProblemAcceptedSourceData(windowId, contestId, problemNum) {
	if (!contestId || !problemNum) {
		throw new Error("缺少比赛编号或题号，无法抓取 AC 代码");
	}

	return withWorkerTab(windowId, buildVjudgeFilteredContestStatusUrl(contestId, problemNum), async (workerTabId) => {
		const sourceData = await collectVjudgeFilteredStatusSourceFromTab(workerTabId, problemNum);
		if (sourceData?.kind !== "source" || !sourceData.content) {
			throw new Error(`题号 ${problemNum} 的筛选状态页未返回源码数据`);
		}

		return sourceData;
	});
}

async function collectVjudgeAcceptedSolutions(windowId, sourceTabId, manifest, failures) {
	const contestId = manifest?.contestId || "";
	if (!contestId) {
		return {
			solutionMap: new Map(),
			statusData: null
		};
	}

	try {
		const sourceTab = await chrome.tabs.get(sourceTabId);
		const sourceUrl = sourceTab?.url || "";
		const statusData = /^https:\/\/vjudge\.net\/contest\/\d+#status/.test(sourceUrl)
			? await collectVjudgeContestStatusFromTab(sourceTabId)
			: await withWorkerTab(windowId, buildVjudgeContestStatusUrl(contestId), async (workerTabId) => collectVjudgeContestStatusFromTab(workerTabId));

		const solutionMap = new Map((Array.isArray(statusData?.solutions) ? statusData.solutions : [])
			.filter((item) => item?.problemNum)
			.map((item) => [item.problemNum, item]));

		if (solutionMap.size === 0) {
			const rowCount = Number(statusData?.rowCount || 0);
			failures.push({
				problem: {
					num: "状态页",
					title: "AC 提交"
				},
				message: rowCount > 0
					? `状态页已加载 ${rowCount} 条记录，但未找到任何可导出的 AC 提交`
					: "状态页未加载到任何提交记录，无法补全 std.cpp"
			});
		}

		return {
			solutionMap,
			statusData
		};
	} catch (error) {
		failures.push({
			problem: {
				num: "状态页",
				title: "AC 提交"
			},
			message: `收集 AC 提交失败：${error?.message || "unknown"}`
		});
		return {
			solutionMap: new Map(),
			statusData: null
		};
	}
}

async function collectVjudgeAcceptedSubmissionExportData(windowId, solutionEntry) {
	const detailUrls = Array.isArray(solutionEntry?.detailUrls) ? solutionEntry.detailUrls : [];
	let lastError = null;

	for (const detailUrl of detailUrls) {
		try {
			const exportData = await withWorkerTab(windowId, detailUrl, async (workerTabId) => collectCurrentPageExportData(workerTabId));
			if (exportData?.kind === "source" && exportData.content) {
				return exportData;
			}
			lastError = new Error("提交详情页未返回源码数据");
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError || new Error(`未找到可访问的 AC 提交详情页: ${solutionEntry?.submissionId || "unknown"}`);
}

function buildVjudgeContestStatusUrl(contestId) {
	return `https://vjudge.net/contest/${encodeURIComponent(contestId)}#status`;
}

function buildVjudgeFilteredContestStatusUrl(contestId, problemNum) {
	return `https://vjudge.net/contest/${encodeURIComponent(contestId)}#status//${encodeURIComponent(problemNum)}/1/`;
}

function buildVjudgeFailureReportMarkdown(manifest, failures) {
	const lines = [
		`# ${manifest?.contestTitle || "VJudge 比赛"} 导出失败清单`,
		"",
		`来源：${manifest?.contestUrl || ""}`,
		"",
		`- 失败题目数：${failures.length}`,
		"",
		"## 明细",
		""
	];

	failures.forEach((item, index) => {
		const problem = item.problem || {};
		lines.push(`${index + 1}. ${[problem.num || problem.letter || "?", problem.title || "unknown"].filter(Boolean).join(". ")}`);
		if (problem.problemUrl) {
			lines.push(`   - 独立题页：${problem.problemUrl}`);
		}
		if (problem.url) {
			lines.push(`   - 比赛链接：${problem.url}`);
		}
		lines.push(`   - 错误：${item.message || "unknown"}`);
	});

	return `${lines.join("\n").trim()}\n`;
}

async function collectProblemExportData(windowId, problemId) {
	if (!problemId) {
		throw new Error("提交记录中未识别到题号，无法补全题面");
	}

	const problemUrl = `https://www.luogu.com.cn/problem/${problemId}`;
	return withWorkerTab(windowId, problemUrl, async (workerTabId) => {
		const officialMarkdown = await collectOfficialProblemMarkdownFromPage(workerTabId);
		const problemData = await collectCurrentPageExportData(workerTabId);
		if (officialMarkdown) {
			problemData.content = officialMarkdown;
		}
		return problemData;
	});
}

async function collectOfficialProblemMarkdownFromPage(tabId) {
	try {
		const results = await chrome.scripting.executeScript({
			target: { tabId },
			world: "MAIN",
			func: async () => {
				const collapse = (text) => {
					return (text || "")
						.replace(/\u00a0/g, " ")
						.replace(/[ \t]+/g, " ")
						.replace(/\n{3,}/g, "\n\n")
						.trim();
				};

				const candidates = ["button", "a", "span", "div"]
					.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
				const copyButton = candidates.find((element) => {
					const text = collapse(element.innerText || element.textContent || "");
					if (!/^复制\s*Markdown$/i.test(text)) {
						return false;
					}

					const rect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
					return !rect || (rect.width > 0 && rect.height > 0);
				});

				if (!copyButton) {
					return "";
				}

				return await new Promise((resolve) => {
					let copiedText = "";
					const clipboard = navigator.clipboard;
					const originalWriteText = clipboard?.writeText ? clipboard.writeText.bind(clipboard) : null;
					const cleanupTasks = [];

					const finish = (value = "") => {
						cleanupTasks.splice(0).forEach((task) => {
							try {
								task();
							} catch (error) {
								console.warn("luogu-downloader: cleanup official markdown hook failed", error);
							}
						});
						resolve((value || copiedText || "").trim());
					};

					if (clipboard && originalWriteText) {
						clipboard.writeText = async (text) => {
							copiedText = String(text || "");
							return undefined;
						};
						cleanupTasks.push(() => {
							clipboard.writeText = originalWriteText;
						});
					}

					const preventDefault = (event) => {
						event.preventDefault();
					};
					copyButton.addEventListener("click", preventDefault, true);
					cleanupTasks.push(() => {
						copyButton.removeEventListener("click", preventDefault, true);
					});

					copyButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
					copyButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
					copyButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

					window.setTimeout(() => finish(copiedText), 1200);
				});
			}
		});

		return String(results?.[0]?.result || "");
	} catch (error) {
		console.warn("failed to collect official problem markdown", error);
		return "";
	}
}

function buildLuoguRecordListUrl(problemId, userId) {
	return `https://www.luogu.com.cn/record/list?pid=${encodeURIComponent(problemId)}&user=${encodeURIComponent(userId)}`;
}

async function downloadLuoguPackage(problemData, recordData, recordUrl = "") {
	const folderName = buildLuoguPackageFolderName(problemData);
	await downloadContentFile(problemData.content || "", `${folderName}/problem.md`, "text/markdown;charset=utf-8");
	await downloadContentFile(recordData.content || "", `${folderName}/std.cpp`, "application/octet-stream");

	return {
		filename: `${folderName}\\{problem.md,std.cpp}`,
		pageType: "luogu-package",
		recordUrl
	};
}

async function downloadProblemOnlyPackage(problemData) {
	const folderName = buildLuoguPackageFolderName(problemData);
	await downloadContentFile(problemData.content || "", `${folderName}/problem.md`, "text/markdown;charset=utf-8");

	return {
		filename: `${folderName}\\problem.md`,
		pageType: "luogu-problem-only"
	};
}

async function downloadPackageFiles(packageData) {
	const files = Array.isArray(packageData?.files) ? packageData.files : [];
	if (files.length === 0) {
		throw new Error("没有可下载的文件");
	}

	for (const file of files) {
		await downloadContentFile(file.content || "", file.filename || "export.md", file.mimeType || "text/plain;charset=utf-8");
	}

	return {
		filename: packageData.filename || packageData.folderName || `export_${files.length}_files`,
		pageType: packageData.pageType || "package"
	};
}

function buildLuoguPackageFolderName(problemData) {
	const baseName = [problemData.problemId || "", problemData.title || problemData.problemLabel || "洛谷题目"]
		.filter(Boolean)
		.join("_");
	return sanitizeFilename(baseName || "luogu_problem_package");
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
				action: ACTION_COLLECT_TI_PROBLEMSET_PAGE_DATA
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
	const startedAt = Date.now();
	const timeoutAt = startedAt + 45000;
	let lastTab = null;

	while (Date.now() < timeoutAt) {
		const tab = await chrome.tabs.get(tabId);
		lastTab = tab;
		const elapsed = Date.now() - startedAt;
		const currentUrl = tab.url || tab.pendingUrl || "";
		const urlReady = !expectedUrl || areComparableUrlsEqual(currentUrl, expectedUrl);
		const statusReady = tab.status === "complete";
		const relaxedVjudgeReady = urlReady && isVjudgeRelaxedReadyUrl(expectedUrl) && elapsed >= 6000;

		if (urlReady && (statusReady || relaxedVjudgeReady)) {
			return tab;
		}

		await sleep(250);
	}

	throw new Error(`等待页面加载超时: ${lastTab?.status || "unknown"} ${lastTab?.url || lastTab?.pendingUrl || expectedUrl}`);
}

async function sendScrapeMessageWithRetry(tabId, attempt = 0) {
	return sendTabMessageWithRetry(tabId, { action: ACTION_START_SCRAPING }, attempt);
}

async function sendVjudgeScrapeMessageWithRetry(tabId, attempt = 0) {
	const response = await sendScrapeMessageWithRetry(tabId, 0);
	if (response?.status === "success") {
		return response;
	}

	const message = String(response?.message || "");
	if (!/未找到 VJudge 比赛题面区域|VJudge 题面正文为空/.test(message) || attempt >= 5) {
		return response;
	}

	await sleep(800);
	return sendVjudgeScrapeMessageWithRetry(tabId, attempt + 1);
}

async function sendTabMessageWithRetry(tabId, message, attempt = 0) {
	try {
		return await chrome.tabs.sendMessage(tabId, message);
	} catch (error) {
		if (shouldInjectContentScript(error)) {
			await ensureContentScriptInjected(tabId);
			await sleep(250);
			return chrome.tabs.sendMessage(tabId, message);
		}

		if (attempt >= 8) {
			throw error;
		}

		await sleep(500);
		return sendTabMessageWithRetry(tabId, message, attempt + 1);
	}
}

function shouldInjectContentScript(error) {
	const message = String(error?.message || error || "");
	return /Receiving end does not exist|Could not establish connection/i.test(message);
}

async function ensureContentScriptInjected(tabId) {
	const tab = await chrome.tabs.get(tabId);
	const tabUrl = tab?.url || "";

	if (!/^https:\/\/((ti|www)\.luogu\.com\.cn|vjudge\.net)\//.test(tabUrl)) {
		throw new Error("当前标签页不支持自动注入抓取脚本");
	}

	await chrome.scripting.executeScript({
		target: { tabId },
		files: ["content.js"]
	});
}

async function prepareTabForNavigation(tabId) {
	try {
		await sendTabMessageWithRetry(tabId, { action: ACTION_PREPARE_NAVIGATION_AWAY }, 2);
		await sleep(150);
	} catch (error) {
		console.warn("prepare navigation skipped", error);
	}
}

async function withWorkerTab(windowId, url, task) {
	const workerTab = await createTabWithRetry({
		windowId,
		url,
		active: false
	});

	try {
		await waitForTabReady(workerTab.id, url);
		await sleep(getWorkerTabPostReadyDelay(url));
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
		await removeTabWithRetry(tabId);
	} catch (error) {
		console.warn("worker tab close skipped", error);
	}
}

async function createTabWithRetry(createProperties, attempt = 0) {
	try {
		return await chrome.tabs.create(createProperties);
	} catch (error) {
		if (!shouldRetryTabEditError(error) || attempt >= 10) {
			throw error;
		}

		await sleep(300 + attempt * 150);
		return createTabWithRetry(createProperties, attempt + 1);
	}
}

async function removeTabWithRetry(tabId, attempt = 0) {
	try {
		return await chrome.tabs.remove(tabId);
	} catch (error) {
		if (!shouldRetryTabEditError(error) || attempt >= 10) {
			throw error;
		}

		await sleep(300 + attempt * 150);
		return removeTabWithRetry(tabId, attempt + 1);
	}
}

function shouldRetryTabEditError(error) {
	const message = String(error?.message || error || "");
	return /Tabs cannot be edited right now|dragging a tab|tab strip/i.test(message);
}

function sleep(duration) {
	return new Promise((resolve) => setTimeout(resolve, duration));
}

function normalizeComparableUrl(url) {
	try {
		const parsedUrl = new URL(url);
		const pathname = decodeURIComponent(parsedUrl.pathname).replace(/\/+$/, "") || "/";
		const search = parsedUrl.search || "";
		return `${parsedUrl.origin}${pathname}${search}`;
	} catch (error) {
		return url.replace(/#.*$/, "").replace(/\/+$/, "");
	}
}

function areComparableUrlsEqual(left, right) {
	return normalizeComparableUrl(left) === normalizeComparableUrl(right);
}

function isVjudgeRelaxedReadyUrl(url) {
	return isVjudgeStandaloneProblemUrl(url) || isVjudgeContestStatusUrl(url);
}

function isVjudgeStandaloneProblemUrl(url) {
	return /^https:\/\/vjudge\.net\/problem\//.test(String(url || ""));
}

function isVjudgeContestStatusUrl(url) {
	return /^https:\/\/vjudge\.net\/contest\/\d+(?:[/?#]|$)/.test(String(url || "")) && /#status(?:$|\/)/.test(String(url || ""));
}

function getWorkerTabPostReadyDelay(url) {
	if (isVjudgeStandaloneProblemUrl(url)) {
		return 3800;
	}

	if (isVjudgeContestStatusUrl(url)) {
		return 4300;
	}

	return 2000;
}

async function downloadTextFile(content, filename) {
	return downloadContentFile(content, filename, "text/markdown;charset=utf-8");
}

async function downloadContentFile(content, filename, mimeType) {
	const dataUrl = `data:${mimeType},${encodeURIComponent(content)}`;
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