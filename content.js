console.log("luogu-downloader: content script loaded");

const ACTION_START_SCRAPING = "startScrapingV2";
const ACTION_COLLECT_CURRENT_PAGE_EXPORT_DATA = "collectCurrentPageExportDataV2";
const ACTION_COLLECT_TI_PROBLEMSET_PAGE_DATA = "collectTiProblemsetPageDataV2";
const ACTION_COLLECT_LUOGU_RECORD_LIST_PAGE_DATA = "collectLuoguRecordListPageDataV2";
const ACTION_COLLECT_VJUDGE_CONTEST_MANIFEST = "collectVjudgeContestManifestV2";
const ACTION_COLLECT_VJUDGE_CONTEST_STATUS = "collectVjudgeContestStatusV2";
const ACTION_COLLECT_VJUDGE_FILTERED_STATUS_SOURCE = "collectVjudgeFilteredStatusSourceV2";
const ACTION_PREPARE_NAVIGATION_AWAY = "prepareNavigationAwayV2";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === ACTION_PREPARE_NAVIGATION_AWAY) {
    try {
      suppressBeforeUnloadDialog();
      sendResponse({ status: "success" });
    } catch (error) {
      console.error("luogu-downloader: suppress beforeunload failed", error);
      sendResponse({
        status: "error",
        message: error.message || "处理离站弹窗失败"
      });
    }

    return true;
  }

  if (request.action === ACTION_COLLECT_TI_PROBLEMSET_PAGE_DATA) {
    try {
      sendResponse({
        status: "success",
        pageData: collectTiProblemsetPageData()
      });
    } catch (error) {
      console.error("luogu-downloader: collect links failed", error);
      sendResponse({
        status: "error",
        message: error.message || "收集题库链接失败"
      });
    }

    return true;
  }

  if (request.action === ACTION_COLLECT_LUOGU_RECORD_LIST_PAGE_DATA) {
    try {
      sendResponse({
        status: "success",
        pageData: collectLuoguRecordListPageData()
      });
    } catch (error) {
      console.error("luogu-downloader: collect record list failed", error);
      sendResponse({
        status: "error",
        message: error.message || "收集提交记录失败"
      });
    }

    return true;
  }

  if (request.action === ACTION_COLLECT_CURRENT_PAGE_EXPORT_DATA) {
    Promise.resolve()
      .then(() => buildCurrentPageExportData())
      .then((exportData) => {
        sendResponse({
          status: "success",
          exportData
        });
      })
      .catch((error) => {
        console.error("luogu-downloader: collect page export data failed", error);
        sendResponse({
          status: "error",
          message: error.message || "收集页面导出数据失败"
        });
      });

    return true;
  }

  if (request.action === ACTION_COLLECT_VJUDGE_CONTEST_MANIFEST) {
    Promise.resolve()
      .then(() => collectVjudgeContestManifestData())
      .then((manifestData) => {
        sendResponse({
          status: "success",
          manifestData
        });
      })
      .catch((error) => {
        console.error("luogu-downloader: collect VJudge contest manifest failed", error);
        sendResponse({
          status: "error",
          message: error.message || "收集 VJudge 比赛清单失败"
        });
      });

    return true;
  }

  if (request.action === ACTION_COLLECT_VJUDGE_CONTEST_STATUS) {
    Promise.resolve()
      .then(() => collectVjudgeContestStatusManifestData())
      .then((statusData) => {
        sendResponse({
          status: "success",
          statusData
        });
      })
      .catch((error) => {
        console.error("luogu-downloader: collect VJudge contest status failed", error);
        sendResponse({
          status: "error",
          message: error.message || "收集 VJudge 比赛状态失败"
        });
      });

    return true;
  }

  if (request.action === ACTION_COLLECT_VJUDGE_FILTERED_STATUS_SOURCE) {
    Promise.resolve()
      .then(() => collectVjudgeFilteredStatusSourceData(request.problemNum || ""))
      .then((sourceData) => {
        sendResponse({
          status: "success",
          sourceData
        });
      })
      .catch((error) => {
        console.error("luogu-downloader: collect VJudge filtered status source failed", error);
        sendResponse({
          status: "error",
          message: error.message || "收集 VJudge 筛选状态源码失败"
        });
      });

    return true;
  }

  if (request.action !== ACTION_START_SCRAPING) {
    return false;
  }

  Promise.resolve()
    .then(() => buildDownloadArtifactForCurrentPage())
    .then((result) => {
      downloadContent(result.content, result.filename, result.mimeType);
      sendResponse({
        status: "success",
        filename: result.filename,
        pageType: result.pageType
      });
    })
    .catch((error) => {
      console.error("luogu-downloader: scrape failed", error);
      sendResponse({
        status: "error",
        message: error.message || "抓取失败"
      });
    });

  return true;
});

async function buildDownloadArtifactForCurrentPage() {
  const pageData = await buildCurrentPageExportData();

  if (pageData.markdown) {
    return {
      pageType: pageData.pageType,
      filename: pageData.filename,
      content: pageData.markdown,
      mimeType: "text/markdown;charset=utf-8"
    };
  }

  if (pageData.kind === "markdown") {
    return {
      pageType: pageData.pageType,
      filename: pageData.filename,
      content: pageData.content,
      mimeType: "text/markdown;charset=utf-8"
    };
  }

  if (pageData.kind === "source") {
    return {
      pageType: pageData.pageType,
      filename: pageData.filename,
      content: pageData.content,
      mimeType: "application/octet-stream"
    };
  }

  throw new Error("不支持当前页面的导出格式");
}

function suppressBeforeUnloadDialog() {
  try {
    window.onbeforeunload = null;
  } catch (error) {
    console.warn("luogu-downloader: failed to clear window.onbeforeunload", error);
  }

  const script = document.createElement("script");
  script.textContent = `
    (() => {
      if (window.__luoguDownloaderBeforeUnloadSuppressed) {
        return;
      }

      window.__luoguDownloaderBeforeUnloadSuppressed = true;

      const swallowBeforeUnload = (event) => {
        try {
          event.stopImmediatePropagation();
          event.preventDefault();
          event.returnValue = undefined;
        } catch (error) {
          console.warn("luogu-downloader: swallow beforeunload failed", error);
        }
      };

      try {
        window.onbeforeunload = null;
      } catch (error) {
        console.warn("luogu-downloader: clear page onbeforeunload failed", error);
      }

      try {
        Object.defineProperty(window, "onbeforeunload", {
          configurable: true,
          get() {
            return null;
          },
          set() {
            return null;
          }
        });
      } catch (error) {
        console.warn("luogu-downloader: redefine onbeforeunload failed", error);
      }

      window.addEventListener("beforeunload", swallowBeforeUnload, true);

      const originalAddEventListener = window.addEventListener;
      window.addEventListener = function(type, listener, options) {
        if (type === "beforeunload") {
          return;
        }

        return originalAddEventListener.call(this, type, listener, options);
      };
    })();
  `;

  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();
}

function collectTiProblemsetPageData() {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const problemsets = [];
  const paginationLinks = [];
  const seenProblemsets = new Set();
  const seenPages = new Set();

  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    if (!href) {
      return;
    }

    const absoluteUrl = new URL(href, location.href).toString();
    const normalizedUrl = absoluteUrl.replace(/\/+$/, "");

    if (/^https:\/\/ti\.luogu\.com\.cn\/problemset\/[^/?#]+(?:\/training)?(?:[?#].*)?$/.test(normalizedUrl) && !/\/problemset\/?(?:[?#].*)?$/.test(normalizedUrl)) {
      const trainingUrl = normalizedUrl.replace(/(?:\/training)?(?:[?#].*)?$/, "/training");
      if (!seenProblemsets.has(trainingUrl)) {
        seenProblemsets.add(trainingUrl);
        problemsets.push({
          title: collapseText(anchor.innerText || anchor.textContent || "") || trainingUrl,
          url: trainingUrl
        });
      }
      return;
    }

    if (/^https:\/\/ti\.luogu\.com\.cn\/problemset\/?(?:\?.*)?$/.test(normalizedUrl)) {
      const indexUrl = normalizedUrl.replace(/#.*$/, "");
      if (!seenPages.has(indexUrl)) {
        seenPages.add(indexUrl);
        paginationLinks.push(indexUrl);
      }
    }
  });

  const title = getFirstText(["h1", ".page-header h1", "main h1"]) || document.title || "题库列表";

  return {
    title,
    currentPage: location.href,
    problemsets,
    paginationLinks
  };
}

async function buildCurrentPageExportData() {
  const url = window.location.href;

  if (location.hostname === "www.luogu.com.cn" && /\/record\/\d+/.test(location.pathname)) {
    return collectLuoguRecordSourceData();
  }

  if (location.hostname === "www.luogu.com.cn" && /\/problem\//.test(location.pathname)) {
    return collectLuoguProblemMarkdownData();
  }

  if (location.hostname === "ti.luogu.com.cn") {
    return exportTiPage();
  }

  if (location.hostname === "vjudge.net" && /\/contest\/\d+/.test(location.pathname)) {
    if (/^#problem\//.test(location.hash || "")) {
      return collectVjudgeContestProblemMarkdownData();
    }

    return collectVjudgeContestPackageData();
  }

  if (location.hostname === "vjudge.net" && /\/(?:solution|submission)\/\d+/.test(location.pathname)) {
    return collectVjudgeSubmissionSourceData();
  }

  if (location.hostname === "vjudge.net" && /\/problem\//.test(location.pathname)) {
    return collectVjudgeStandaloneProblemMarkdownData();
  }

  throw new Error(`暂不支持当前页面: ${url}`);
}

async function collectVjudgeContestManifestData() {
  const problems = await waitForValue(() => collectVjudgeContestProblems(), {
    timeout: 5000,
    interval: 150
  });

  if (!problems || problems.length === 0) {
    throw new Error("未找到 VJudge 比赛题目列表");
  }

  const contestTitle = getVjudgeContestTitle() || document.title;
  const contestId = getVjudgeContestId();
  const folderName = sanitizeFilename([
    "vjudge",
    contestId,
    contestTitle || "contest"
  ].filter(Boolean).join("_"));
  const contestUrl = new URL(`/contest/${contestId}`, location.origin).toString();
  const contestIndex = await collectVjudgeContestIndexMarkdownData();

  return {
    contestId,
    contestTitle,
    contestUrl,
    folderName,
    indexContent: contestIndex.content,
    problems: problems.map((item) => ({
      num: item.num || item.letter || "",
      letter: item.letter || item.num || "",
      title: item.title || "",
      origin: item.origin || "",
      problemUrl: item.problemUrl || "",
      url: item.url || "",
      probNum: item.probNum || "",
      oj: item.oj || ""
    }))
  };
}

async function collectVjudgeContestStatusManifestData() {
  await ensureVjudgeStatusTabActivated();

  const contestId = getVjudgeContestId();
  const contestTitle = getVjudgeContestTitle() || document.title;
  const username = detectVjudgeCurrentUsername();
  if (!username) {
    throw new Error("未识别到当前 VJudge 用户名，请先登录后重试");
  }

  const problems = await waitForValue(() => collectVjudgeContestProblems(), {
    timeout: 5000,
    interval: 150
  });
  const problemLetters = new Set((problems || []).map((item) => String(item?.num || item?.letter || "").trim()).filter(Boolean));
  const statusState = await waitForValue(() => {
    if (!hasVjudgeStatusTableShell()) {
      return "";
    }

    const rows = collectVjudgeContestStatusRows(username, problemLetters);
    if (rows.length > 0 || hasVjudgeEmptyStatusIndicator()) {
      return { rows };
    }

    return "";
  }, {
    timeout: 10000,
    interval: 200
  });

  const acceptedByProblem = new Map();
  const rows = Array.isArray(statusState?.rows) ? statusState.rows : [];
  rows.forEach((row) => {
    if (!row?.accepted || !row.problemNum || !row.username) {
      return;
    }

    if (!acceptedByProblem.has(row.problemNum)) {
      acceptedByProblem.set(row.problemNum, row);
    }
  });

  return {
    contestId,
    contestTitle,
    username,
    statusUrl: buildVjudgeContestStatusUrl(contestId),
    rowCount: rows.length,
    solutions: Array.from(acceptedByProblem.values()).map((item) => ({
      problemNum: item.problemNum,
      username: item.username || "",
      submissionId: item.submissionId || "",
      detailUrls: item.detailUrls || [],
      languageLabel: item.languageLabel || ""
    }))
  };
}

async function collectVjudgeContestProblemMarkdownData() {
  const contestTitle = getVjudgeContestTitle();
  const problemEntry = await waitForValue(() => getVjudgeCurrentProblemEntry(), {
    timeout: 3000,
    interval: 100
  });
  const fetchedStatement = await fetchVjudgeProblemStatementContext(problemEntry);
  let statementContext = fetchedStatement || await waitForValue(() => findVjudgeProblemStatementContext(), {
    timeout: 8000,
    interval: 150
  });

  if (!statementContext?.root) {
    throw new Error("未找到 VJudge 比赛题面区域");
  }

  let problemMeta = getVjudgeCurrentProblemMeta(statementContext.root, statementContext.document);
  let rawText = getNodeText(statementContext.root) || getNodeText(statementContext.document?.body) || getNodeText(document.body) || "";
  const structuredMarkdown = extractVjudgeStructuredDescriptionMarkdown(statementContext.document, location.href);
  let markdownBody = structuredMarkdown || convertNodeChildrenToMarkdown(statementContext.root).trim()
    || extractVjudgeProblemMarkdownFromText(rawText)
    || extractVjudgeProblemMarkdownFromDom(statementContext.root);

  if (!markdownBody && fetchedStatement) {
    const fallbackStatement = await waitForValue(() => findVjudgeProblemStatementContext(), {
      timeout: 3000,
      interval: 150
    });

    if (fallbackStatement?.root) {
      statementContext = fallbackStatement;
      problemMeta = getVjudgeCurrentProblemMeta(statementContext.root, statementContext.document);
      rawText = getNodeText(statementContext.root) || getNodeText(statementContext.document?.body) || getNodeText(document.body) || "";
      markdownBody = convertNodeChildrenToMarkdown(statementContext.root).trim()
        || extractVjudgeProblemMarkdownFromText(rawText)
        || extractVjudgeProblemMarkdownFromDom(statementContext.root);
    }
  }

  if (!markdownBody) {
    throw new Error("VJudge 题面正文为空，无法导出");
  }

  const lines = [`# ${problemMeta.title || problemMeta.letter || document.title}`, "", `来源：${location.href}`];

  if (contestTitle || problemMeta.letter) {
    lines.push("", "## 基本信息", "");
    if (contestTitle) {
      lines.push(`- 比赛：${contestTitle}`);
    }
    if (problemMeta.letter) {
      lines.push(`- 题号：${problemMeta.letter}`);
    }
    if (problemMeta.origin) {
      lines.push(`- 原题：${problemMeta.origin}`);
    }
  }

  lines.push("", formatVjudgeProblemMarkdown(markdownBody, Boolean(structuredMarkdown)));

  const filenameBase = ["vjudge", getVjudgeContestId(), problemMeta.letter, sanitizeFilename(problemMeta.title || "")]
    .filter(Boolean)
    .join("_");

  return {
    pageType: "vjudge-problem",
    kind: "markdown",
    filename: `${sanitizeFilename(filenameBase || "vjudge_problem")}.md`,
    content: normalizeMarkdown(lines.join("\n"))
  };
}

async function collectVjudgeContestIndexMarkdownData() {
  const problemList = await waitForValue(() => collectVjudgeContestProblems(), {
    timeout: 5000,
    interval: 150
  });

  if (!problemList || problemList.length === 0) {
    throw new Error("未找到 VJudge 比赛题单");
  }

  const contestTitle = getVjudgeContestTitle() || document.title;
  const lines = [`# ${contestTitle}`, "", `来源：${location.href}`, "", "## 题目列表", ""];

  problemList.forEach((item, index) => {
    lines.push(`${index + 1}. ${[item.letter, item.title].filter(Boolean).join(". ") || item.url}`);
    if (item.origin) {
      lines.push(`   - 来源题库：${item.origin}`);
    }
    if (item.url) {
      lines.push(`   - 题面链接：${item.url}`);
    }
  });

  const filenameBase = ["vjudge", getVjudgeContestId(), sanitizeFilename(contestTitle || "contest")]
    .filter(Boolean)
    .join("_");

  return {
    pageType: "vjudge-contest",
    kind: "markdown",
    filename: `${sanitizeFilename(filenameBase || "vjudge_contest")}.md`,
    content: normalizeMarkdown(lines.join("\n"))
  };
}

async function collectVjudgeContestPackageData() {
  const problems = collectVjudgeContestProblems().map((item) => ({
    ...item,
    num: item.num || item.letter || ""
  }));
  if (problems.length === 0) {
    throw new Error("未找到 VJudge 比赛题目列表");
  }

  const contestTitle = getVjudgeContestTitle() || document.title;
  const contestId = getVjudgeContestId();
  const contestFolderName = sanitizeFilename([
    "vjudge",
    contestId,
    contestTitle || "contest"
  ].filter(Boolean).join("_"));

  const files = [];
  for (const problemEntry of problems) {
    const problemMarkdown = await collectVjudgeProblemMarkdownDocument(problemEntry, contestTitle);
    const problemFolderName = sanitizeFilename([
      problemEntry.num || "problem",
      problemEntry.probNum || "",
      problemEntry.title || ""
    ].filter(Boolean).join("_"));

    files.push({
      filename: `${contestFolderName}/${problemFolderName}/problem.md`,
      content: problemMarkdown,
      mimeType: "text/markdown;charset=utf-8"
    });
  }

  const contestIndex = await collectVjudgeContestIndexMarkdownData();
  files.push({
    filename: `${contestFolderName}/index.md`,
    content: contestIndex.content,
    mimeType: "text/markdown;charset=utf-8"
  });

  return {
    pageType: "vjudge-contest-package",
    kind: "package",
    folderName: contestFolderName,
    filename: `${contestFolderName}\\**`,
    files
  };
}

async function collectVjudgeProblemMarkdownDocument(problemEntry, contestTitle = "") {
  const statementContext = await fetchVjudgeProblemStatementContext(problemEntry);
  if (!statementContext?.root) {
    throw new Error(`未找到 VJudge 题面区域: ${problemEntry?.num || problemEntry?.title || "unknown"}`);
  }

  const problemMeta = getVjudgeProblemMetaFromEntry(problemEntry, statementContext.root, statementContext.document);
  const rawText = getNodeText(statementContext.root) || getNodeText(statementContext.document?.body) || "";
  const structuredMarkdown = extractVjudgeStructuredDescriptionMarkdown(statementContext.document, problemEntry?.problemUrl || location.href);
  const markdownBody = structuredMarkdown || convertNodeChildrenToMarkdown(statementContext.root).trim()
    || extractVjudgeProblemMarkdownFromText(rawText)
    || extractVjudgeProblemMarkdownFromDom(statementContext.root);

  if (!markdownBody) {
    throw new Error(`VJudge 题面正文为空，无法导出: ${problemMeta.letter || problemMeta.title || "unknown"}`);
  }

  const sourceUrl = problemEntry?.problemUrl || buildVjudgeContestProblemUrl(problemEntry?.num);
  const lines = [`# ${problemMeta.title || problemMeta.letter || document.title}`, "", `来源：${sourceUrl}`];

  if (contestTitle || problemMeta.letter) {
    lines.push("", "## 基本信息", "");
    if (contestTitle) {
      lines.push(`- 比赛：${contestTitle}`);
    }
    if (problemMeta.letter) {
      lines.push(`- 题号：${problemMeta.letter}`);
    }
    if (problemMeta.origin) {
      lines.push(`- 原题：${problemMeta.origin}`);
    }
    if (problemEntry?.problemUrl) {
      lines.push(`- VJudge 题面：${problemEntry.problemUrl}`);
    }
  }

  lines.push("", formatVjudgeProblemMarkdown(markdownBody, Boolean(structuredMarkdown)));
  return normalizeMarkdown(lines.join("\n"));
}

async function collectVjudgeStandaloneProblemMarkdownData() {
  let statementContext = await waitForValue(() => findVjudgeProblemStatementContext(), {
    timeout: 15000,
    interval: 150
  });

  if (!statementContext?.root) {
    const pageRoot = findVjudgeProblemStatementRoot(document) || document.body;
    if (pageRoot) {
      statementContext = {
        root: pageRoot,
        document
      };
    }
  }

  const structuredMarkdown = extractVjudgeStructuredDescriptionMarkdown(statementContext?.document || document, location.href);
  let rawText = statementContext?.root
    ? getNodeText(statementContext.root) || getNodeText(statementContext.document?.body) || getNodeText(document.body) || ""
    : "";
  let markdownBody = structuredMarkdown || (statementContext?.root
    ? convertNodeChildrenToMarkdown(statementContext.root).trim()
      || extractVjudgeProblemMarkdownFromText(rawText)
      || extractVjudgeProblemMarkdownFromDom(statementContext.root)
    : "");

  if (!markdownBody) {
    const iframeCandidates = Array.from(document.querySelectorAll("iframe[src*='/problem/description/']"));
    for (const iframe of iframeCandidates) {
      const iframeSrc = iframe.getAttribute("src") || "";
      if (!iframeSrc) {
        continue;
      }

      const parsed = await fetchVjudgeStatementContextByUrl(new URL(iframeSrc, location.origin).toString());
      if (!parsed?.root) {
        continue;
      }

      rawText = getNodeText(parsed.root) || getNodeText(parsed.document?.body) || "";
      markdownBody = convertNodeChildrenToMarkdown(parsed.root).trim()
        || extractVjudgeProblemMarkdownFromText(rawText)
        || extractVjudgeProblemMarkdownFromDom(parsed.root);
      if (markdownBody) {
        break;
      }
    }
  }

  if (!markdownBody) {
    const pageSnapshot = collapseText(getNodeText(document.body) || "").slice(0, 240);
    throw new Error(`VJudge 独立题面正文为空，无法导出；页面片段: ${pageSnapshot}`);
  }

  const title = getFirstText([
    "#problem-title",
    "h1",
    "h2",
    ".page-header h2",
    ".panel-title"
  ]) || document.title.replace(/\s*-\s*Virtual Judge.*$/i, "").trim();
  const origin = collapseText(document.querySelector("#problem-origin")?.innerText || document.querySelector("a[href$='/origin']")?.innerText || "");
  const lines = [`# ${title}`, "", `来源：${location.href}`, "", "## 基本信息", ""];

  if (origin) {
    lines.push(`- 原题：${origin}`);
  }

  lines.push("", formatVjudgeProblemMarkdown(markdownBody, Boolean(structuredMarkdown)));

  return {
    pageType: "vjudge-problem",
    kind: "markdown",
    filename: `${sanitizeFilename(title || "vjudge_problem")}.md`,
    content: normalizeMarkdown(lines.join("\n"))
  };
}

async function collectVjudgeSubmissionSourceData() {
  const submissionId = extractVjudgeSubmissionIdFromUrl(location.href);
  let code = extractVjudgeSubmissionCode(document);

  if (!code) {
    code = await waitForValue(() => extractVjudgeSubmissionCode(document), {
      timeout: 5000,
      interval: 150
    });
  }

  if (!code && submissionId) {
    code = await fetchVjudgeSubmissionCodeById(submissionId);
  }

  if (!code) {
    throw new Error("未找到可导出的 VJudge 提交源码，可能当前提交不允许查看源码");
  }

  const language = detectRecordLanguage(document.body.innerText || "");
  return {
    pageType: "vjudge-submission-source",
    kind: "source",
    filename: "std.cpp",
    content: code,
    submissionId,
    languageLabel: language.label,
    languageFence: language.fence
  };
}

async function collectVjudgeFilteredStatusSourceData(problemNum = "") {
  const normalizedProblemNum = String(problemNum || "").trim();
  if (!normalizedProblemNum) {
    throw new Error("缺少题号，无法从状态页抓取 AC 代码");
  }

  await ensureVjudgeFilteredStatusPage(normalizedProblemNum);

  const matchedRow = await waitForValue(() => findFirstVisibleVjudgeStatusRow(), {
    timeout: 10000,
    interval: 200
  });

  if (!matchedRow?.row) {
    throw new Error(`题号 ${normalizedProblemNum} 的筛选状态页中未找到可点击的提交记录`);
  }

  const inlineCode = await openVjudgeStatusRowSource(matchedRow.row, matchedRow.submissionId);
  if (!inlineCode) {
    throw new Error(`题号 ${normalizedProblemNum} 的 AC 提交 ${matchedRow.submissionId || "unknown"} 未返回源码`);
  }

  const language = detectRecordLanguage(matchedRow.languageLabel || document.body.innerText || "");
  return {
    pageType: "vjudge-filtered-status-source",
    kind: "source",
    filename: "std.cpp",
    content: inlineCode,
    problemNum: normalizedProblemNum,
    username: matchedRow.username || "",
    submissionId: matchedRow.submissionId || "",
    languageLabel: language.label,
    languageFence: language.fence
  };
}

function getVjudgeProblemMetaFromEntry(problemEntry, statementRoot = null, statementDocument = document) {
  if (problemEntry) {
    return {
      letter: problemEntry.num || "",
      title: problemEntry.title || getFirstTextWithin(statementRoot || statementDocument.body, ["h1", "h2", "h3", "h4", ".panel-title"]),
      origin: [problemEntry.oj, problemEntry.probNum].filter(Boolean).join(" - ")
    };
  }

  return getVjudgeCurrentProblemMeta(statementRoot, statementDocument);
}

function buildVjudgeContestProblemUrl(problemLetter) {
  return problemLetter ? new URL(`#problem/${problemLetter}`, location.href).toString() : location.href;
}

function getVjudgeContestId() {
  return location.pathname.match(/\/contest\/(\d+)/)?.[1] || "";
}

function getVjudgeContestTitle() {
  const contestData = getVjudgeContestData();
  if (contestData?.title) {
    return contestData.title.trim();
  }

  return getFirstText([
    ".contest-title",
    "h1",
    "h2",
    ".page-header h3",
    ".page-header h4"
  ]) || document.title.replace(/\s*-\s*Virtual Judge.*$/i, "").trim();
}

function getVjudgeCurrentProblemMeta(statementRoot = null, statementDocument = document) {
  const currentHash = location.hash || "";
  const currentLetter = currentHash.match(/^#problem\/([^/?#]+)/)?.[1] || "";
  const problemEntry = getVjudgeCurrentProblemEntry();

  if (problemEntry) {
    return {
      letter: problemEntry.num || currentLetter,
      title: problemEntry.title || `${currentLetter} 题目`.trim(),
      origin: [problemEntry.oj, problemEntry.probNum].filter(Boolean).join(" - ")
    };
  }

  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const currentAnchor = anchors.find((anchor) => {
    const href = anchor.getAttribute("href") || "";
    return href === currentHash || href.endsWith(currentHash);
  });

  const anchorText = collapseText(currentAnchor?.innerText || "");
  const titleMatch = anchorText.match(/^([A-Z0-9]+)[.\s-]+(.+)$/);

  if (titleMatch) {
    return {
      letter: titleMatch[1],
      title: titleMatch[2]
    };
  }

  const headingText = getFirstTextWithin(statementRoot || findVjudgeProblemStatementRoot(statementDocument) || statementDocument.body, ["h1", "h2", "h3", "h4", ".panel-title"]);
  return {
    letter: currentLetter,
    title: headingText || `${currentLetter} 题目`.trim()
  };
}

function collectVjudgeContestProblems() {
  const tableProblemMeta = getVjudgeContestProblemTableMeta();
  const contestData = getVjudgeContestData();
  if (contestData?.problems?.length) {
    return contestData.problems.map((item) => mergeVjudgeProblemWithTableMeta({
      ...item,
      letter: item.num || "",
      title: item.title || "",
      origin: [item.oj, item.probNum].filter(Boolean).join(" - "),
      url: item.num ? new URL(`#problem/${item.num}`, location.href).toString() : location.href
    }, tableProblemMeta.get(item.num || "")));
  }

  if (tableProblemMeta.size > 0) {
    return Array.from(tableProblemMeta.values()).map((item) => ({
      ...item,
      num: item.letter || "",
      url: item.url || (item.letter ? new URL(`#problem/${item.letter}`, location.href).toString() : location.href)
    }));
  }

  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const problems = [];
  const seen = new Set();

  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    if (!/#problem\//.test(href)) {
      return;
    }

    const absoluteUrl = new URL(href, location.href).toString();
    if (seen.has(absoluteUrl)) {
      return;
    }

    seen.add(absoluteUrl);
    const row = anchor.closest("tr, li, .problem-item, .list-group-item, .nav-item") || anchor;
    const cells = row.tagName?.toLowerCase() === "tr"
      ? Array.from(row.cells).map((cell) => collapseText(cell.innerText || "")).filter(Boolean)
      : [];
    const anchorText = collapseText(anchor.innerText || "");
    const hashLetter = href.match(/#problem\/([^/?#]+)/)?.[1] || "";
    const letter = cells[0] || anchorText.match(/^([A-Z0-9]+)/)?.[1] || hashLetter;
    const title = cells[1] || anchorText.replace(/^([A-Z0-9]+)[.\s-]*/, "") || hashLetter;
    const origin = cells[2] || "";

    problems.push({
      letter,
      title,
      origin,
      url: absoluteUrl
    });
  });

  return problems;
}

function getVjudgeContestProblemTableMeta() {
  const rows = Array.from(document.querySelectorAll("#contest-problems tbody tr"));
  const result = new Map();

  rows.forEach((row) => {
    const letter = collapseText(row.querySelector(".prob-num")?.innerText || "");
    if (!letter) {
      return;
    }

    const titleAnchor = row.querySelector(".prob-title a[href]");
    const originAnchor = row.querySelector(".prob-origin a[href]");
    const title = collapseText(titleAnchor?.innerText || row.querySelector(".prob-title")?.innerText || "");
    const origin = collapseText(originAnchor?.innerText || row.querySelector(".prob-origin")?.innerText || "");
    const contestLink = titleAnchor?.getAttribute("href") || `#problem/${letter}`;
    const problemHref = originAnchor?.getAttribute("href") || "";

    result.set(letter, {
      letter,
      title,
      origin,
      url: contestLink ? new URL(contestLink, location.href).toString() : location.href,
      problemUrl: problemHref ? new URL(problemHref, location.href).toString() : ""
    });
  });

  return result;
}

function mergeVjudgeProblemWithTableMeta(problemEntry, tableMeta) {
  if (!tableMeta) {
    return problemEntry;
  }

  return {
    ...problemEntry,
    letter: problemEntry.letter || tableMeta.letter,
    title: problemEntry.title || tableMeta.title,
    origin: problemEntry.origin || tableMeta.origin,
    url: problemEntry.url || tableMeta.url,
    problemUrl: tableMeta.problemUrl || problemEntry.problemUrl || ""
  };
}

function getVjudgeContestData() {
  const raw = document.querySelector("textarea[name='dataJson']")?.value || "";
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("luogu-downloader: parse VJudge contest data failed", error);
    return null;
  }
}

function getVjudgeCurrentProblemEntry() {
  const currentLetter = getVjudgeCurrentProblemLetter();
  return collectVjudgeContestProblems().find((item) => (item?.num || item?.letter) === currentLetter) || null;
}

function getVjudgeCurrentProblemLetter() {
  const activeNav = document.querySelector("#problem-nav .nav-link.active[num]");
  const activeNum = activeNav?.getAttribute("num") || collapseText(activeNav?.innerText || "");
  if (activeNum) {
    return activeNum;
  }

  return (location.hash || "").match(/^#problem\/([^/?#]+)/)?.[1] || "";
}

function buildVjudgeContestStatusUrl(contestId = getVjudgeContestId()) {
  return contestId ? new URL(`/contest/${contestId}#status`, location.origin).toString() : location.href;
}

function buildVjudgeFilteredStatusHash(problemNum) {
  return `#status//${encodeURIComponent(problemNum)}/1/`;
}

async function ensureVjudgeFilteredStatusPage(problemNum) {
  const expectedHash = buildVjudgeFilteredStatusHash(problemNum);
  if (!isVjudgeFilteredStatusHash(location.hash || "", problemNum)) {
    location.hash = expectedHash;
  }

  await ensureVjudgeStatusTabActivated();
  await waitForValue(() => {
    if (!isVjudgeFilteredStatusHash(location.hash || "", problemNum)) {
      return "";
    }

    const rows = getVjudgeStatusDataRows();
    if (rows.length > 0 || hasVjudgeEmptyStatusIndicator()) {
      return "ready";
    }

    return "";
  }, {
    timeout: 10000,
    interval: 200
  });
}

async function ensureVjudgeStatusTabActivated() {
  if (!/^#status/.test(location.hash || "")) {
    const statusAnchor = Array.from(document.querySelectorAll("a[href]"))
      .find((anchor) => /#status(?:$|\/)/.test(anchor.getAttribute("href") || ""));
    if (statusAnchor) {
      triggerElementClick(statusAnchor);
    }
    location.hash = "#status";
  }

  await waitForValue(() => hasVjudgeStatusTableShell() ? "ready" : "", {
    timeout: 8000,
    interval: 150
  });
}

function hasVjudgeStatusTableShell() {
  return Boolean(
    document.querySelector("#listStatus")
    || document.querySelector("#contest_status")
    || document.querySelector("#contest-status-num")
    || document.querySelector("[id*='status'] table")
  );
}

function hasVjudgeEmptyStatusIndicator() {
  const container = document.querySelector("#listStatus")
    || document.querySelector("#contest_status")
    || document.body;
  const text = collapseText(getNodeText(container) || "");
  return /No submissions|暂无提交|没有提交|没有数据|empty/i.test(text);
}

function detectVjudgeCurrentUsername() {
  const inputValue = document.querySelector("input[name='visitor_username']")?.value
    || document.querySelector("#visitor_username")?.value
    || document.querySelector("input[name='username']")?.value
    || "";
  if (inputValue.trim()) {
    return inputValue.trim();
  }

  const userAnchor = Array.from(document.querySelectorAll("a[href]"))
    .find((anchor) => /\/user\//.test(anchor.getAttribute("href") || ""));
  const anchorText = collapseText(userAnchor?.innerText || "");
  if (anchorText && !/登录|注册/.test(anchorText)) {
    return anchorText;
  }

  const html = document.documentElement?.innerHTML || "";
  const match = html.match(/visitor_username[^\w]+value=["']([^"']+)["']/i)
    || html.match(/"username"\s*:\s*"([^"]+)"/i)
    || html.match(/"userName"\s*:\s*"([^"]+)"/i);
  return match?.[1]?.trim() || "";
}

function isSameVjudgeUsername(left, right) {
  return collapseText(String(left || "")).toLowerCase() === collapseText(String(right || "")).toLowerCase();
}

function collectVjudgeContestStatusRows(currentUsername, problemLetters) {
  const rowNodes = getVjudgeStatusDataRows();

  return rowNodes
    .map((row) => extractVjudgeContestStatusRow(row, currentUsername, problemLetters))
    .filter(Boolean);
}

function findFirstVisibleVjudgeStatusRow() {
  const rowNodes = getVjudgeStatusDataRows();
  for (const row of rowNodes) {
    const parsedRow = extractVjudgeContestStatusRow(row, "", new Set());
    if (!parsedRow) {
      continue;
    }

    return {
      ...parsedRow,
      row
    };
  }

  return null;
}

function getVjudgeStatusDataRows() {
  return Array.from(document.querySelectorAll("#listStatus tbody tr, #contest_status tbody tr, table tbody tr"))
    .filter((row) => row.querySelectorAll("td").length >= 8)
    .filter((row) => {
      const firstCellText = collapseText(row.querySelectorAll("td")[0]?.innerText || "");
      return /^\d{5,}$/.test(firstCellText);
    });
}

function isVjudgeFilteredStatusHash(hash, problemNum) {
  const normalizedHash = String(hash || "");
  return new RegExp(`^#status//${escapeRegExp(String(problemNum || ""))}/1/?$`, "i").test(normalizedHash);
}

function extractVjudgeContestStatusRow(row, currentUsername, problemLetters) {
  const cells = Array.from(row.querySelectorAll("td")).map((cell) => collapseText(cell.innerText || cell.textContent || ""));
  const rowText = collapseText(cells.join(" | ") || row.innerText || "");
  if (!rowText) {
    return null;
  }

  const submissionId = detectVjudgeSubmissionId(row, cells);
  const username = detectVjudgeStatusRowUsername(row, cells, currentUsername);
  const problemNum = detectVjudgeStatusRowProblemNum(row, cells, problemLetters);
  const verdictText = detectVjudgeStatusRowVerdict(cells, rowText);
  const accepted = isAcceptedVerdictText(verdictText || rowText);
  const detailUrls = collectVjudgeSubmissionDetailUrls(row, submissionId);
  const languageLabel = detectVjudgeStatusRowLanguage(cells, rowText);

  if (!username || !problemNum) {
    return null;
  }

  return {
    username,
    problemNum,
    accepted,
    submissionId,
    detailUrls,
    languageLabel,
    rowText
  };
}

function detectVjudgeStatusRowUsername(row, cells, currentUsername) {
  if (cells[1] && !/^\d+$/.test(cells[1])) {
    return cells[1];
  }

  const anchorText = collapseText(row.querySelector("a[href*='/user/']")?.innerText || "");
  if (anchorText) {
    return anchorText;
  }

  if (currentUsername) {
    const matchedCell = cells.find((cell) => isSameVjudgeUsername(cell, currentUsername));
    if (matchedCell) {
      return matchedCell;
    }
  }

  return cells.find((cell) => /^[A-Za-z0-9_.-]{2,}$/.test(cell) && !/Accepted|Wrong|Time|Memory|Runtime|Compile|Running|Pending|分钟|秒前/i.test(cell)) || "";
}

function detectVjudgeStatusRowProblemNum(row, cells, problemLetters) {
  if (cells[2]) {
    const normalizedCell = cells[2].trim();
    if (problemLetters.has(normalizedCell) || /^[A-Z][A-Z0-9]?$/.test(normalizedCell)) {
      return normalizedCell;
    }
  }

  const problemAnchor = Array.from(row.querySelectorAll("a[href]"))
    .find((anchor) => /#problem\//.test(anchor.getAttribute("href") || ""));
  const href = problemAnchor?.getAttribute("href") || "";
  const hrefLetter = href.match(/#problem\/([^/?#]+)/)?.[1] || "";
  if (hrefLetter) {
    return hrefLetter;
  }

  const taggedValue = collapseText(row.querySelector("[class*='prob']")?.innerText || "");
  if (taggedValue && problemLetters.has(taggedValue)) {
    return taggedValue;
  }

  return cells.find((cell) => problemLetters.has(cell)) || "";
}

function detectVjudgeStatusRowVerdict(cells, rowText) {
  if (cells[3]) {
    return cells[3];
  }

  return rowText;
}

function isAcceptedVerdictText(text) {
  const normalized = collapseText(text || "");
  return /Accepted|答案正确|通过|\bAC\b/i.test(normalized)
    && !/Wrong Answer|Runtime Error|Time Limit|Compile Error|Memory Limit|Output Limit|Presentation Error|WA|RE|TLE|MLE|OLE|CE/i.test(normalized);
}

function detectVjudgeSubmissionId(row, cells = []) {
  if (cells[0] && /^\d{5,}$/.test(cells[0])) {
    return cells[0];
  }

  const attributeSources = [
    row.id || "",
    ...row.getAttributeNames().map((name) => row.getAttribute(name) || "")
  ];
  const linkSources = Array.from(row.querySelectorAll("a[href]"))
    .map((anchor) => new URL(anchor.getAttribute("href") || "", location.href).toString());
  const textSources = cells.slice(0, 3);
  const candidates = [...attributeSources, ...linkSources, ...textSources];

  for (const source of candidates) {
    const match = String(source || "").match(/(?:solution|submission|run)[^\d]{0,6}(\d{4,})/i);
    if (match) {
      return match[1];
    }
  }

  const numericCell = cells.find((cell) => /^\d{6,}$/.test(cell));
  return numericCell || "";
}

function collectVjudgeSubmissionDetailUrls(row, submissionId = "") {
  const urls = new Set();

  Array.from(row.querySelectorAll("a[href]"))
    .map((anchor) => anchor.getAttribute("href") || "")
    .filter(Boolean)
    .forEach((href) => {
      if (/^javascript:/i.test(href)) {
        return;
      }

      const absoluteUrl = new URL(href, location.href).toString();
      if (/\/contest\//.test(absoluteUrl) && /#problem\//.test(absoluteUrl)) {
        return;
      }
      if (/\/user\//.test(absoluteUrl) || /\/problem\//.test(absoluteUrl)) {
        return;
      }

      urls.add(absoluteUrl);
    });

  if (submissionId) {
    [
      `/solution/${submissionId}`,
      `/submission/${submissionId}`
    ].forEach((pathname) => {
      urls.add(new URL(pathname, location.origin).toString());
    });
  }

  return Array.from(urls);
}

function detectVjudgeStatusRowLanguage(cells, rowText) {
  if (cells[7]) {
    return cells[7];
  }

  const candidates = [...cells, rowText];
  for (const text of candidates) {
    const language = detectRecordLanguage(text || "");
    if (language?.label && language.label !== "C++") {
      return language.label;
    }
  }

  return "";
}

async function openVjudgeStatusRowSource(row, submissionId = "") {
  const languageCell = row.querySelectorAll("td")[7] || null;
  const clickTargets = [
    ...Array.from(languageCell?.querySelectorAll("a[href], button, span, div") || []),
    languageCell,
    row.querySelectorAll("td")[0],
    row
  ].filter(Boolean);

  for (const target of clickTargets) {
    try {
      triggerElementClick(target);
    } catch (error) {
      // ignore and continue with next target
    }

    const clickedCode = await waitForValue(() => extractInlineVjudgeSubmissionCode(document), {
      timeout: 3000,
      interval: 150
    });
    if (clickedCode) {
      return clickedCode;
    }
  }

  if (submissionId) {
    return fetchVjudgeSubmissionCodeById(submissionId);
  }

  return "";
}

function extractVjudgeSubmissionIdFromUrl(url) {
  return String(url || "").match(/\/(?:solution|submission)\/(\d+)/)?.[1] || "";
}

function extractVjudgeSubmissionCode(rootDocument = document) {
  const selectors = [
    ".cm-content",
    ".CodeMirror-code",
    ".view-lines",
    ".ace_content",
    ".ace_editor",
    ".source-code pre",
    ".source pre",
    "pre code",
    "pre",
    "table"
  ];
  return extractVjudgeSubmissionCodeFromSelectors(rootDocument, selectors, true);
}

function extractInlineVjudgeSubmissionCode(rootDocument = document) {
  const selectors = [
    ".modal .cm-content",
    ".modal .CodeMirror-code",
    ".modal .view-lines",
    ".modal .ace_content",
    ".modal .ace_editor",
    ".modal .source-code pre",
    ".modal .source pre",
    ".modal pre code",
    ".modal pre",
    ".ui-dialog .cm-content",
    ".ui-dialog .CodeMirror-code",
    ".ui-dialog .view-lines",
    ".ui-dialog .ace_content",
    ".ui-dialog .ace_editor",
    ".ui-dialog .source-code pre",
    ".ui-dialog .source pre",
    ".ui-dialog pre code",
    ".ui-dialog pre",
    ".bootbox .cm-content",
    ".bootbox .CodeMirror-code",
    ".bootbox .view-lines",
    ".bootbox .ace_content",
    ".bootbox .ace_editor",
    ".bootbox .source-code pre",
    ".bootbox .source pre",
    ".bootbox pre code",
    ".bootbox pre"
  ];
  return extractVjudgeSubmissionCodeFromSelectors(rootDocument, selectors, false);
}

function extractVjudgeSubmissionCodeFromSelectors(rootDocument, selectors, allowTables) {
  const candidates = [];

  selectors.forEach((selector) => {
    Array.from(rootDocument.querySelectorAll(selector)).forEach((element) => {
      if (!allowTables && element.tagName?.toLowerCase() === "table") {
        return;
      }

      const candidate = extractRecordCodeCandidate(element);
      if (!candidate || !looksLikeSourceCode(candidate)) {
        return;
      }

      candidates.push({
        code: candidate,
        score: scoreRecordCodeCandidate(candidate)
      });
    });
  });

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.code || "";
}

async function fetchVjudgeSubmissionCodeById(submissionId) {
  const candidateUrls = [
    `/solution/data/${submissionId}`,
    `/submission/data/${submissionId}`,
    `/solution/${submissionId}`,
    `/submission/${submissionId}`
  ];

  for (const pathname of candidateUrls) {
    const code = await fetchVjudgeSubmissionCodeByUrl(new URL(pathname, location.origin).toString());
    if (code) {
      return code;
    }
  }

  return "";
}

async function fetchVjudgeSubmissionCodeByUrl(targetUrl) {
  if (!targetUrl) {
    return "";
  }

  try {
    const response = await fetch(targetUrl, {
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) {
      return "";
    }

    const contentType = response.headers.get("content-type") || "";
    if (/json/i.test(contentType)) {
      const payload = await response.json();
      return extractVjudgeSubmissionCodeFromPayload(payload);
    }

    const text = await response.text();
    if (!text.trim()) {
      return "";
    }

    if (/^[\[{]/.test(text.trim())) {
      try {
        return extractVjudgeSubmissionCodeFromPayload(JSON.parse(text));
      } catch (error) {
        // ignore parse failure and continue with HTML/text fallback
      }
    }

    const directCode = extractVjudgeSubmissionCodeFromPayload(text);
    if (directCode) {
      return directCode;
    }

    const parsedDocument = new DOMParser().parseFromString(text, "text/html");
    return extractVjudgeSubmissionCode(parsedDocument);
  } catch (error) {
    console.warn("luogu-downloader: fetch VJudge submission code failed", error);
    return "";
  }
}

function extractVjudgeSubmissionCodeFromPayload(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) {
      return "";
    }

    if (looksLikeVjudgeStatusListing(trimmed)) {
      return "";
    }

    if (/^</.test(trimmed)) {
      const parsedDocument = new DOMParser().parseFromString(trimmed, "text/html");
      return extractVjudgeSubmissionCode(parsedDocument);
    }

    return looksLikeSourceCode(trimmed) ? normalizeSourceCode(trimmed) : "";
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const code = extractVjudgeSubmissionCodeFromPayload(item);
      if (code) {
        return code;
      }
    }
    return "";
  }

  if (typeof payload === "object") {
    const priorityKeys = ["code", "source", "sourceCode", "source_code", "solution", "data", "msg", "value"];
    for (const key of priorityKeys) {
      if (!(key in payload)) {
        continue;
      }

      const code = extractVjudgeSubmissionCodeFromPayload(payload[key]);
      if (code) {
        return code;
      }
    }

    for (const value of Object.values(payload)) {
      const code = extractVjudgeSubmissionCodeFromPayload(value);
      if (code) {
        return code;
      }
    }
  }

  return "";
}

function looksLikeSourceCode(text) {
  const normalized = normalizeSourceCode(text || "");
  if (!normalized || normalized.length < 24) {
    return false;
  }

  if (looksLikeVjudgeStatusListing(normalized)) {
    return false;
  }

  const hasStrongSignal = /(#include\s*[<"]|using\s+namespace\s+std|int\s+main\s*\(|signed\s+main\s*\(|void\s+\w+\s*\(|return\s+\d+\s*;|cin\s*>>|cout\s*<<|scanf\s*\(|printf\s*\(|def\s+\w+\s*\(|print\s*\(|class\s+\w+|public\s+static\s+void\s+main|fn\s+main\s*\(|package\s+main|func\s+main\s*\()/m.test(normalized);
  const symbolHeavy = /[{}();<>\[\]#]/.test(normalized) && normalized.split("\n").length >= 3;
  if (!hasStrongSignal && !symbolHeavy) {
    return false;
  }

  const score = scoreRecordCodeCandidate(normalized);
  return score >= 200;
}

function looksLikeVjudgeStatusListing(text) {
  const normalized = collapseText(text || "");
  if (!normalized) {
    return false;
  }

  if (/\bAccepted\b/.test(normalized) && /\bC\+\+\b/.test(normalized) && /(分钟前|小时前|秒前)/.test(normalized)) {
    return true;
  }

  return /^([A-Za-z0-9_.-]+\s+[A-Z]\s+Accepted\s+\d+)/.test(normalized);
}

function getVjudgeDisplayedProblemTitle() {
  return collapseText(document.querySelector("#problem-title")?.innerText || "");
}

function getVjudgeExpectedDescriptionKey() {
  const activeDescriptionItem = document.querySelector("#prob-descs .list-group-item.active[data-key]");
  const activeKey = activeDescriptionItem?.getAttribute("data-key") || activeDescriptionItem?.dataset?.key || "";
  if (activeKey) {
    return activeKey;
  }

  const problemEntry = getVjudgeCurrentProblemEntry();
  return problemEntry?.enabledDescKeys?.[0] ? String(problemEntry.enabledDescKeys[0]) : "";
}

function buildVjudgeProblemDescriptionUrl(problemEntry, descKey = "") {
  const resolvedDescKey = descKey || (problemEntry?.enabledDescKeys?.[0] ? String(problemEntry.enabledDescKeys[0]) : getVjudgeExpectedDescriptionKey());
  if (!resolvedDescKey) {
    return "";
  }

  const descBrief = Array.isArray(problemEntry?.descBriefs)
    ? problemEntry.descBriefs.find((item) => String(item?.key || "") === resolvedDescKey)
    : null;
  const version = descBrief?.version ? `?${descBrief.version}` : "";
  return new URL(`/problem/description/${resolvedDescKey}${version}`, location.origin).toString();
}

function getVjudgeDescriptionCandidates(problemEntry) {
  const candidates = [];
  const seen = new Set();

  const pushCandidate = (key, priority = 0) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || seen.has(normalizedKey)) {
      return;
    }

    seen.add(normalizedKey);
    candidates.push({ key: normalizedKey, priority });
  };

  pushCandidate(getVjudgeExpectedDescriptionKey(), 100);
  (problemEntry?.enabledDescKeys || []).forEach((key) => pushCandidate(key, 95));

  const descBriefs = Array.isArray(problemEntry?.descBriefs) ? problemEntry.descBriefs : [];
  descBriefs.forEach((brief) => {
    const key = brief?.key;
    if (brief?.mainOfficial) {
      pushCandidate(key, 90);
      return;
    }
    if (brief?.official) {
      pushCandidate(key, 80);
      return;
    }
    if (brief?.lang === "zh") {
      pushCandidate(key, 70);
      return;
    }
    if (brief?.lang === "en") {
      pushCandidate(key, 60);
      return;
    }
    pushCandidate(key, 50);
  });

  return candidates
    .sort((left, right) => right.priority - left.priority)
    .map((item) => item.key);
}

function tryParseVjudgeStatementDocument(html, descriptionUrl) {
  if (!html.trim()) {
    return null;
  }

  const parser = new DOMParser();
  const parsedDocument = parser.parseFromString(html, "text/html");
  const baseElement = parsedDocument.createElement("base");
  baseElement.setAttribute("href", descriptionUrl);
  parsedDocument.head?.prepend(baseElement);
  const root = findVjudgeProblemStatementRoot(parsedDocument) || parsedDocument.body;
  const text = collapseText(getNodeText(root) || getNodeText(parsedDocument.body) || "");
  if (!text) {
    return null;
  }

  return {
    root,
    document: parsedDocument
  };
}

async function fetchVjudgeStatementContextByUrl(descriptionUrl) {
  if (!descriptionUrl) {
    return null;
  }

  try {
    const response = await fetch(descriptionUrl, {
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return tryParseVjudgeStatementDocument(html, descriptionUrl);
  } catch (error) {
    console.warn("luogu-downloader: fetch VJudge statement by URL failed", error);
    return null;
  }
}

async function fetchVjudgeProblemStatementContext(problemEntry) {
  const descriptionKeys = getVjudgeDescriptionCandidates(problemEntry);
  for (const descriptionKey of descriptionKeys) {
    const descriptionUrl = buildVjudgeProblemDescriptionUrl(problemEntry, descriptionKey);
    if (!descriptionUrl) {
      continue;
    }

    const parsed = await fetchVjudgeStatementContextByUrl(descriptionUrl);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function isVjudgeDisplayedProblemSynchronized() {
  const currentLetter = getVjudgeCurrentProblemLetter();
  const problemEntry = getVjudgeCurrentProblemEntry();
  if (!currentLetter || !problemEntry) {
    return true;
  }

  const displayedTitle = getVjudgeDisplayedProblemTitle();
  if (!displayedTitle) {
    return false;
  }

  const normalizedExpectedTitle = collapseText(problemEntry.title || "");
  return displayedTitle.startsWith(`${currentLetter} -`)
    && (!normalizedExpectedTitle || displayedTitle.includes(normalizedExpectedTitle));
}

function isVjudgeStatementFrameSynchronized(iframe) {
  if (!iframe) {
    return false;
  }

  const expectedKey = getVjudgeExpectedDescriptionKey();
  if (!expectedKey) {
    return true;
  }

  const frameSrc = iframe.getAttribute("src") || "";
  return frameSrc.includes(`/problem/description/${expectedKey}`);
}

function findVjudgeProblemStatementFrame() {
  const containerFrames = Array.from(document.querySelectorAll("#frame-description-container iframe"));
  const descriptionFrames = containerFrames.length > 0
    ? containerFrames
    : Array.from(document.querySelectorAll("iframe[src*='/problem/description/'], #contest_problem iframe"));

  if (descriptionFrames.length === 0) {
    return null;
  }

  const expectedKey = getVjudgeExpectedDescriptionKey();
  const visibleFrames = descriptionFrames.filter((iframe) => isVjudgeVisibleFrame(iframe));
  const matchingVisibleFrame = visibleFrames.find((iframe) => doesVjudgeFrameMatchDescriptionKey(iframe, expectedKey));
  if (matchingVisibleFrame) {
    return matchingVisibleFrame;
  }

  const matchingFrame = descriptionFrames.find((iframe) => doesVjudgeFrameMatchDescriptionKey(iframe, expectedKey));
  if (matchingFrame) {
    return matchingFrame;
  }

  if (visibleFrames.length > 0) {
    return visibleFrames[visibleFrames.length - 1];
  }

  return descriptionFrames[descriptionFrames.length - 1] || null;
}

function doesVjudgeFrameMatchDescriptionKey(iframe, expectedKey) {
  if (!iframe) {
    return false;
  }

  if (!expectedKey) {
    return true;
  }

  const frameSrc = iframe.getAttribute("src") || "";
  return frameSrc.includes(`/problem/description/${expectedKey}`);
}

function isVjudgeVisibleFrame(iframe) {
  if (!iframe) {
    return false;
  }

  const style = window.getComputedStyle ? window.getComputedStyle(iframe) : null;
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return false;
  }

  return iframe.offsetParent !== null || iframe.getClientRects().length > 0;
}

function getAccessibleIframeDocument(iframe) {
  if (!iframe) {
    return null;
  }

  try {
    const frameDocument = iframe.contentDocument || iframe.contentWindow?.document || null;
    return frameDocument?.body ? frameDocument : null;
  } catch (error) {
    return null;
  }
}

function findVjudgeProblemStatementContext() {
  const statementFrame = findVjudgeProblemStatementFrame();
  if (!isVjudgeDisplayedProblemSynchronized() || !isVjudgeStatementFrameSynchronized(statementFrame)) {
    return null;
  }

  const frameDocument = getAccessibleIframeDocument(statementFrame);
  const frameText = collapseText(getNodeText(frameDocument?.body) || "");

  if (frameDocument && frameText.length > 40) {
    return {
      root: findVjudgeProblemStatementRoot(frameDocument) || frameDocument.body,
      document: frameDocument
    };
  }

  const pageRoot = findVjudgeProblemStatementRoot(document);
  if (pageRoot) {
    return {
      root: pageRoot,
      document
    };
  }

  return null;
}

function findVjudgeProblemStatementRoot(rootDocument = document) {
  const candidates = [
    rootDocument.querySelector(".markdown-body"),
    rootDocument.querySelector(".problem-statement"),
    rootDocument.querySelector(".md-content"),
    rootDocument.querySelector(".panel-body"),
    rootDocument.querySelector(".content"),
    rootDocument.querySelector("article"),
    rootDocument.querySelector("main"),
    rootDocument.body
  ].filter(Boolean);

  return candidates.find((node) => {
    const text = collapseText(getNodeText(node) || "");
    if (text.length < 40) {
      return false;
    }

    if (rootDocument !== document) {
      return true;
    }

    return /Description|Input|Output|Sample Input|Sample Output|Hint|Note|题目描述|输入|输出/.test(text) && text.length > 120;
  }) || null;
}

function extractVjudgeProblemMarkdownFromText(rawText) {
  const normalizedText = normalizeProblemText(rawText);
  if (!normalizedText) {
    return "";
  }

  const lines = normalizedText.split("\n");
  const firstSectionIndex = lines.findIndex((line) => isVjudgeProblemSectionHeading(line) || isVjudgeProblemSampleHeading(line));
  if (firstSectionIndex < 0) {
    return "";
  }

  const filteredLines = lines
    .slice(firstSectionIndex)
    .filter((line) => !isVjudgeProblemNoiseLine(line));

  const output = [];
  let index = 0;

  while (index < filteredLines.length) {
    const line = filteredLines[index];
    if (!line) {
      index += 1;
      continue;
    }

    if (isVjudgeProblemSectionHeading(line) || isVjudgeProblemSampleHeading(line)) {
      output.push(`## ${line}`, "");
      index += 1;
      continue;
    }

    if (isVjudgeProblemSampleIOHeading(line)) {
      const blockTitle = line;
      const blockLines = [];
      index += 1;

      while (index < filteredLines.length) {
        const current = filteredLines[index];
        if (isVjudgeProblemSectionHeading(current) || isVjudgeProblemSampleHeading(current) || isVjudgeProblemSampleIOHeading(current)) {
          break;
        }

        blockLines.push(current);
        index += 1;
      }

      output.push(`### ${blockTitle}`, "", "```", blockLines.join("\n").trim(), "```", "");
      continue;
    }

    output.push(line);
    index += 1;
  }

  return normalizeMarkdown(output.join("\n")).trim();
}

function extractVjudgeProblemMarkdownFromDom(root) {
  if (!root) {
    return "";
  }

  const blocks = [];
  appendVjudgeDomMarkdownBlocks(root, blocks);
  return normalizeMarkdown(blocks.filter(Boolean).join("\n\n")).trim();
}

function appendVjudgeDomMarkdownBlocks(node, blocks) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const element = node;
  const tag = element.tagName.toLowerCase();
  if (["script", "style", "noscript", "svg", "button", "textarea", "input"].includes(tag)) {
    return;
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Math.min(Number(tag[1]), 6);
    const text = collapseText(getNodeText(element));
    if (text) {
      blocks.push(`${"#".repeat(level)} ${text}`);
    }
    return;
  }

  if (tag === "pre") {
    const code = extractCodeBlock(element);
    if (code) {
      blocks.push(`\`\`\`\n${code}\n\`\`\``);
    }
    return;
  }

  if (tag === "table") {
    const tableMarkdown = convertTableToMarkdown(element).trim();
    if (tableMarkdown) {
      blocks.push(tableMarkdown);
    }
    return;
  }

  if (["p", "li", "blockquote"].includes(tag)) {
    const text = collapseText(getNodeText(element));
    if (text) {
      blocks.push(text);
    }
    return;
  }

  const childElements = Array.from(element.children);
  if (childElements.length === 0) {
    const text = collapseText(getNodeText(element));
    if (text) {
      blocks.push(text);
    }
    return;
  }

  childElements.forEach((child) => appendVjudgeDomMarkdownBlocks(child, blocks));
}

function normalizeVjudgeProblemMarkdown(markdown) {
  const rawLines = preprocessVjudgeMarkdown(markdown)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd());

  const output = [];
  let pendingSampleNumber = 0;
  let nextSampleNumber = 1;
  let currentSection = "";
  let inCodeFence = false;

  rawLines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (output[output.length - 1] !== "") {
        output.push("");
      }
      return;
    }

    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      output.push(trimmed);
      return;
    }

    if (inCodeFence) {
      output.push(trimmed);
      return;
    }

    if (shouldDropVjudgeBodyLine(trimmed)) {
      return;
    }

    const parsedSectionLine = parseVjudgeSectionLine(trimmed);
    if (parsedSectionLine?.heading) {
      currentSection = parsedSectionLine.heading;
      output.push(`## ${parsedSectionLine.heading}`, "");
      if (parsedSectionLine.heading === "输入输出样例") {
        pendingSampleNumber = 0;
        nextSampleNumber = 1;
      }
      if (parsedSectionLine.remainder) {
        output.push(currentSection === "数据范围"
          ? formatVjudgeDataRangeLine(parsedSectionLine.remainder)
          : formatVjudgeNarrativeLine(parsedSectionLine.remainder));
      }
      return;
    }

    if (looksLikeStandaloneDataRangeLine(trimmed)) {
      const remainder = trimmed.replace(/^数据范围[:：]?\s*/i, "").trim();
      currentSection = "数据范围";
      output.push("## 数据范围", "");
      if (remainder) {
        output.push(formatVjudgeDataRangeLine(remainder), "");
      }
      return;
    }

    if (currentSection === "输入输出样例" && /^\d+$/.test(trimmed)) {
      const sampleNumber = Number(trimmed);
      if (Number.isFinite(sampleNumber) && sampleNumber > 0) {
        pendingSampleNumber = sampleNumber;
        nextSampleNumber = sampleNumber;
      }
      return;
    }

    if (/^\*\*Input\*\*$/i.test(trimmed) || /^Sample\s*Input$/i.test(trimmed) || /^输入$/i.test(trimmed)) {
      pendingSampleNumber = nextSampleNumber;
      currentSection = "输入输出样例";
      output.push(`### 输入 #${pendingSampleNumber}`, "");
      return;
    }

    if (/^\*\*Output\*\*$/i.test(trimmed) || /^Sample\s*Output$/i.test(trimmed) || /^输出$/i.test(trimmed)) {
      const sampleNumber = pendingSampleNumber || nextSampleNumber;
      currentSection = "输入输出样例";
      output.push(`### 输出 #${sampleNumber}`, "");
      pendingSampleNumber = 0;
      nextSampleNumber = sampleNumber + 1;
      return;
    }

    output.push(currentSection === "数据范围" ? formatVjudgeDataRangeLine(trimmed) : formatVjudgeNarrativeLine(trimmed));
  });

  return postprocessVjudgeMarkdown(dedupeRepeatedMathSegments(normalizeVjudgeSectionSpacing(normalizeMarkdown(output.join("\n")).trim())));
}

function postprocessVjudgeMarkdown(markdown) {
  let output = String(markdown || "").trim();
  if (!output) {
    return "";
  }

  output = dedupeRepeatedHeaders(output);
  output = normalizeFourGroupNarrative(output);
  output = normalizeFourGroupInputSection(output);
  output = normalizeFourGroupConstraintSection(output);
  output = normalizeVjudgeSubtaskSection(output);
  output = output.replace(/\n{3,}/g, "\n\n").trim();
  return output;
}

function dedupeRepeatedHeaders(markdown) {
  return (markdown || "")
    .replace(/^(##\s+输入格式)\n\n\1\n\n/gm, "$1\n\n")
    .replace(/^(##\s+输出格式)\n\n\1\n\n/gm, "$1\n\n")
    .replace(/^(##\s+提示)\n\n\1\n\n/gm, "$1\n\n")
    .replace(/^(##\s+输入输出样例)\n\n\1\n\n/gm, "$1\n\n");
}

function normalizeFourGroupNarrative(markdown) {
  let output = String(markdown || "");
  output = output.replace(/JOI 中学有\s*4\s*\$N\$[^\n]*名一年级学生/g, "JOI 中学有 $4N$ 名一年级学生");

  ["A", "B", "C", "D"].forEach((groupName) => {
    const pattern = new RegExp(`^-\\s*1 年 \\$${groupName}\\$ 组[:：].*$`, "gm");
    output = output.replace(pattern, `- 1 年 $${groupName}$ 组：有 $N$ 名学生，他们的身高分别为 $${groupName}_1, ${groupName}_2, \\dots, ${groupName}_N$。`);
  });

  return output;
}

function normalizeFourGroupInputSection(markdown) {
  const sectionPattern = /## 输入格式\n\n([\s\S]*?)(?=\n## |$)/;
  const match = String(markdown || "").match(sectionPattern);
  if (!match) {
    return markdown;
  }

  const body = match[1];
  const hasFourGroups = ["A", "B", "C", "D"].every((groupName) => new RegExp(`${groupName}_1|\\$${groupName}\\$`).test(body));
  if (!hasFourGroups) {
    return markdown;
  }

  const replacement = [
    "## 输入格式",
    "",
    "数据按以下格式给出：",
    "",
    "```text",
    "N",
    "A_1 A_2 ... A_N",
    "B_1 B_2 ... B_N",
    "C_1 C_2 ... C_N",
    "D_1 D_2 ... D_N",
    "```"
  ].join("\n");

  return String(markdown || "").replace(sectionPattern, replacement);
}

function normalizeFourGroupConstraintSection(markdown) {
  const sectionPattern = /## 数据范围\n\n([\s\S]*?)(?=\n## |$)/;
  const match = String(markdown || "").match(sectionPattern);
  if (!match) {
    return markdown;
  }

  const body = match[1];
  const hasFourGroups = ["A", "B", "C", "D"].every((groupName) => new RegExp(`${groupName}_i|${groupName}_j|${groupName}_k|${groupName}_l|${groupName} i|${groupName} j|${groupName} k|${groupName} l`).test(body));
  if (!hasFourGroups || !/75000|75\s*,?\s*000/.test(body)) {
    return markdown;
  }

  const replacement = [
    "## 数据范围",
    "",
    "- $1 \\le N \\le 75000$。",
    "- $1 \\le A_i \\le 10^9$（$1 \\le i \\le N$）。",
    "- $1 \\le B_j \\le 10^9$（$1 \\le j \\le N$）。",
    "- $1 \\le C_k \\le 10^9$（$1 \\le k \\le N$）。",
    "- $1 \\le D_l \\le 10^9$（$1 \\le l \\le N$）。",
    "- 所有输入值均为整数。"
  ].join("\n");

  return String(markdown || "").replace(sectionPattern, replacement);
}

function normalizeVjudgeSubtaskSection(markdown) {
  return String(markdown || "")
    .replace(/^\$?(\d+)\.\s*\((\d+)\s*分\)\s*([^$\n]+?)\s*\$?。?$/gm, (_, index, score, content) => {
      const cleanedContent = cleanupVjudgeArtifactLine(content)
        .replace(/\bN\s*=\s*1\s*N\s*=\s*1N\s*=\s*1\b/g, "$N = 1$")
        .replace(/\bN\s*\\le\s*30\s*N\s*\\le\s*30N\s*\\le\s*30\b/g, "$N \\le 30$")
        .replace(/\s{2,}/g, " ")
        .trim();
      return `${index}. （${score} 分）${cleanedContent}`;
    })
    .replace(/^(\d+\. （\d+ 分）)([^\n]*?)\$([^$]+)\$/gm, "$1$2 $$$3$$")
    .replace(/\n{3,}/g, "\n\n");
}

function preprocessVjudgeMarkdown(markdown) {
  return normalizeVjudgeArtifactLines((markdown || "")
    .normalize("NFKC")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\r/g, "")
    .replace(/\b(Problem Statement|Description|Input|Output|Constraints|Note|Explanation)(?=[A-Z])/g, "$1\n")
    .replace(/\s*(#{1,6})\s*(题目描述|输入格式|输出格式|输入输出样例|提示|数据范围)/g, "\n$1 $2\n")
    .replace(/\s*(#{1,6})\s*(Description|Statement|Problem Description|Input|Input Specification|Output|Output Specification|Sample|Examples|Input Output Examples|Hint|Note|Explanation|Constraints|Data Range)/gi, "\n$1 $2\n")
    .replace(/\s*(\*\*Input\*\*)\s*/gi, "\n$1\n")
    .replace(/\s*(\*\*Output\*\*)\s*/gi, "\n$1\n")
    .replace(/(#{1,6}\s*(?:Description|描述|Statement|Problem Description|Input|输入格式|输入|Output|输出格式|输出|Sample|Example|Examples|示例|样例|Hint|Note|Explanation|提示|Constraints|Data Range|数据范围))(?=\S)/gi, "$1\n")
    .replace(/\s*(```[a-zA-Z0-9_-]*)\s*/g, "\n$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function normalizeVjudgeArtifactLines(markdown) {
  return (markdown || "")
    .split("\n")
    .map((line) => cleanupVjudgeArtifactLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanupVjudgeArtifactLine(line) {
  const text = String(line || "");
  if (!text.trim()) {
    return "";
  }

  return normalizeDuplicatedNumericArtifacts(text)
    .replace(/\b([A-Za-z])\s+\1{1,2}\b/g, "$1")
    .replace(/\b([A-Za-z])\s+\1{1,2}([a-z]{2,})\b/g, "$1 $2")
    .replace(/\b(\d)\s+\1{1,2}\b/g, "$1")
    .replace(/\b(\d)\s+\1{1,2}([A-Za-z]{2,})\b/g, "$1 $2")
    .replace(/\b(query|Query|input|Input|output|Output|sample|Sample)\s+\1\b/g, "$1")
    .replace(/(\b\d+\s*\+\s*\d+(?:\s*\+\s*\d+)+(?:\s*=\s*\d+)?)\s+\1\b/g, "$1")
    .replace(/(\b\d+\s*\le\s*[A-Za-z]\s*\le\s*[^\s]+)\s+\1\b/g, "$1")
    .replace(/(\b[A-Za-z]\s*=\s*\([^)]*\))\s+\1\b/g, "$1")
    .replace(/\b([A-Za-z])\s*=\s*\(\s*\)\s*\1\s*=\s*\(\s*\)/g, "$1 = ()")
    .replace(/\b([A-Za-z])\s*=\s*\(([^)]*)\)\s*\1\s*=\s*\(([^)]*)\)/g, "$1 = ($2)")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseVjudgeSectionLine(line) {
  const normalizedLine = collapseText((line || "").normalize("NFKC"));
  if (!normalizedLine) {
    return null;
  }

  const markdownMatch = normalizedLine.match(/^#{1,6}\s*(.+)$/);
  const content = markdownMatch ? markdownMatch[1].trim() : normalizedLine;
  const sectionPrefixes = [
    ["题目描述", /^(?:题目描述|描述|Description|Statement|Problem Description)(?:\s*[:：-])?(.*)$/i],
    ["输入格式", /^(?:输入格式|输入|Input|Input Specification)(?:\s*[:：-])?(.*)$/i],
    ["输出格式", /^(?:输出格式|输出|Output|Output Specification)(?:\s*[:：-])?(.*)$/i],
    ["输入输出样例", /^(?:输入输出样例|样例|示例|Sample|Example|Examples|Input Output Examples)(?:\s*[#:：-]?\s*\d+)?(?:\s*[:：-])?(.*)$/i],
    ["提示", /^(?:说明\/提示|提示|Hint|Note|Explanation)(?:\s*[:：-])?(.*)$/i],
    ["数据范围", /^(?:数据范围|Constraints|Data Range)(?:\s*[:：-])?(.*)$/i]
  ];

  for (const [heading, pattern] of sectionPrefixes) {
    const match = content.match(pattern);
    if (!match) {
      continue;
    }

    const remainder = (match[1] || "").trim();
    if (!remainder && !markdownMatch && canonicalizeVjudgeSectionHeading(content) !== heading) {
      continue;
    }

    return {
      heading,
      remainder
    };
  }

  return null;
}

function canonicalizeVjudgeSectionHeading(heading) {
  const normalized = collapseText((heading || "").normalize("NFKC"));
  if (!normalized) {
    return "";
  }

  const mapping = [
    [/^(Description|Statement|Problem Description|题目描述|描述)$/i, "题目描述"],
    [/^(Input|Input Specification|输入格式|输入)$/i, "输入格式"],
    [/^(Output|Output Specification|输出格式|输出)$/i, "输出格式"],
    [/^(Sample|Example|Examples|Input Output Examples|输入输出样例|样例|示例)$/i, "输入输出样例"],
    [/^(Hint|Note|Explanation|说明\/提示|提示)$/i, "提示"],
    [/^(Constraints|Data Range|数据范围)$/i, "数据范围"]
  ];

  const matched = mapping.find(([pattern]) => pattern.test(normalized));
  return matched ? matched[1] : "";
}

function shouldDropVjudgeBodyLine(line) {
  const normalized = collapseText((line || "").normalize("NFKC"));
  return [
    /^由\s*(ChatGPT|GPT|OpenAI|DeepSeek|LLM).{0,40}翻译$/i,
    /^translation by\s+/i,
    /^本题翻译自\s+/i,
    /^USACO\s*训练章节/i,
    /^Forked from\s+/i,
    /^copy$/i
  ].some((pattern) => pattern.test(normalized));
}

function looksLikeStandaloneDataRangeLine(line) {
  return /^数据范围[:：]?/.test(collapseText((line || "").normalize("NFKC")));
}

function normalizeVjudgeSectionSpacing(markdown) {
  return (markdown || "")
    .replace(/^(##\s+(?:题目描述|输入格式|输出格式|输入输出样例|提示|数据范围))\n+(?=\S)/gm, "$1\n\n")
    .replace(/^(###\s+(?:输入|输出)\s*#\d+)\n+(?=\S)/gm, "$1\n\n")
    .replace(/(```(?:text)?)\n+(?=\S)/g, "$1\n")
    .replace(/([^\n])\n(```)/g, "$1\n\n$2")
    .replace(/(```)\n?(##|###)/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatVjudgeDataRangeLine(line) {
  const normalized = collapseText(cleanupVjudgeArtifactLine((line || "").normalize("NFKC")));
  if (!normalized) {
    return "";
  }

  const prefixMatch = normalized.match(/^(对于\s*100%\s*的测试数据[:：]?)(.*)$/);
  if (!prefixMatch) {
    return formatVjudgeConstraintSentence(normalized);
  }

  const prefix = prefixMatch[1].replace(/100%/g, "$100\\%$");
  const remainder = prefixMatch[2].trim();
  const formattedRemainder = formatVjudgeConstraintSentence(remainder);
  return formattedRemainder ? `${prefix} ${formattedRemainder}` : prefix;
}

function formatVjudgeConstraintSentence(text) {
  const normalized = collapseText(cleanupVjudgeArtifactLine((text || "").normalize("NFKC")));
  if (!normalized) {
    return "";
  }

  const segments = normalized.split(/([，,、；;。])/g);
  return segments.map((segment) => {
    if (!segment) {
      return "";
    }

    if (/^[，,、；;。]$/.test(segment)) {
      return segment;
    }

    return formatSingleVjudgeConstraint(segment);
  }).join("");
}

function formatSingleVjudgeConstraint(text) {
  const normalized = collapseText(text);
  if (!normalized) {
    return "";
  }

  const mathReady = normalized
    .replace(/([0-9]+)\s*[x×]\s*10\s*\^\s*([0-9]+)/gi, "$1 \\times 10^{$2}")
    .replace(/\b([A-Za-z]+)i\b/g, (_, base) => `${base}_i`)
    .replace(/\b([A-Za-z])([0-9]+)\b/g, (_, name, index) => `${name}_${index}`);

  if (/(<=|>=|<|>|≤|≥|=)/.test(mathReady)) {
    return wrapKatexInline(toKatexConstraint(mathReady));
  }

  return formatVjudgeNarrativeLine(mathReady);
}

function formatVjudgeNarrativeLine(line) {
  const normalized = collapseText(cleanupVjudgeArtifactLine((line || "").normalize("NFKC")));
  if (!normalized) {
    return "";
  }

  const segments = normalized.split(/(\$[^$]+\$)/g);
  return segments.map((segment) => {
    if (!segment || /^\$[^$]+\$$/.test(segment)) {
      return segment;
    }

    return formatVjudgePlainTextMath(segment);
  }).join("");
}

function formatVjudgePlainTextMath(text) {
  return normalizeDuplicatedNumericArtifacts(text || "")
    .replace(/\b(Type\s+[12])\s+\1\b/gi, "$1")
    .replace(/\b([A-Za-z])\s+\1{1,2}(?=\s|$)/g, "$1")
    .replace(/\b([pa])i\b/g, (_, name) => `${name}_i`)
    .replace(/第\s*([A-Za-z](?:_[A-Za-z0-9]+)?)\s*个/g, (_, variable) => `第 ${wrapKatexInline(variable)} 个`)
    .replace(/([0-9]+)\s*[x×]\s*10\s*\^\s*([0-9]+)/gi, (_, base, power) => wrapKatexInline(`${base} \\times 10^{${power}}`))
    .replace(/([0-9]+)%/g, (_, value) => wrapKatexInline(`${value}\\%`))
    .replace(/\b([A-Za-z])\s+([A-Za-z]{2,})\s+\1\s+\1{1,2}\b/g, "$1 $2")
    .replace(/\b([A-Za-z](?:_[A-Za-z0-9]+)?(?:\s*,\s*[A-Za-z](?:_[A-Za-z0-9]+)?)+)\b/g, (_, variables) => wrapKatexInline(normalizeKatexVariableList(variables)))
    .replace(/(^|[（(，,:：\s])([A-Za-z](?:_[A-Za-z0-9]+)?)(?=([）),，。:：；;\s]|$))/g, (match, leading, variable) => `${leading}${wrapKatexInline(variable)}`)
    .replace(/\$\$+/g, "$")
    .replace(/\$\s+\$/g, "$");
}

function dedupeRepeatedMathSegments(text) {
  let result = String(text || "");
  const duplicatePatterns = [
    /(\$[^$]{3,}\$)\s+\1/g,
    /(\b\d+\s*\+\s*\d+(?:\s*\+\s*\d+)+(?:\s*=\s*\d+)?)\s+\1/g,
    /(\b[A-Za-z]\s*=\s*\([^)]*\))\s+\1/g
  ];

  duplicatePatterns.forEach((pattern) => {
    while (pattern.test(result)) {
      result = result.replace(pattern, "$1");
    }
  });

  return result;
}

function normalizeDuplicatedNumericArtifacts(text) {
  let result = String(text || "");
  const duplicatePatterns = [
    /(\b\d{1,9})\s+(?:\1){1,}\b/g,
    /(\b\d+(?:\s*,\s*\d+)+)\s+\1\b/g,
    /(\b\d+\b)\s+(\1)(?=[\s,.)])/g,
    /(\b\d+\s*,\s*\d+)\s+(\d+\s*,\s*\d+)\b/g
  ];

  duplicatePatterns.forEach((pattern, index) => {
    let guard = 0;
    while (pattern.test(result) && guard < 20) {
      if (index === 3) {
        result = result.replace(pattern, (match, left, right) => normalizeCommaNumberSequence(left, right));
      } else {
        result = result.replace(pattern, "$1");
      }
      guard += 1;
    }
  });

  return result
    .replace(/(\b\d+)\s*,\s*(\d+)\s+(\1)\s*,\s*(\2)\b/g, "$1, $2")
    .replace(/(\b\d+(?:\s*,\s*\d+)+)\s+(?=\.)/g, "$1")
    .replace(/\s{2,}/g, " ");
}

function normalizeCommaNumberSequence(left, right) {
  const normalizedLeft = collapseText(String(left || "")).replace(/\s*,\s*/g, ",");
  const normalizedRight = collapseText(String(right || "")).replace(/\s*,\s*/g, ",");
  if (normalizedLeft === normalizedRight) {
    return normalizedLeft.replace(/,/g, ", ");
  }

  if (normalizedRight.startsWith(normalizedLeft)) {
    return normalizedRight.replace(/,/g, ", ");
  }

  return normalizedLeft.replace(/,/g, ", ");
}

function normalizeKatexVariableList(variables) {
  return variables
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

function wrapKatexInline(content) {
  const text = (content || "").trim();
  if (!text) {
    return "";
  }

  return `$${text}$`;
}

function replaceVjudgeConstraintMath(text) {
  return (text || "")
    .replace(/([0-9]+)\s*[x×]\s*10\s*\^\s*([0-9]+)/gi, "$1 \\times 10^{$2}")
    .replace(/\b([A-Za-z]+)i\b/g, (_, base) => `${base}_i`)
    .replace(/\b([A-Za-z])([0-9]+)\b/g, (_, name, index) => `${name}_${index}`)
    .replace(/(^|[，,、；;\s])([^，,、；;。]+?(?:<=|≥|>=|<|>|≤|=)[^，,、；;。]+)(?=([，,、；;。]|$))/g, (match, leading, expr) => `${leading}$${toKatexConstraint(expr)}$`)
    .replace(/\$\s+/g, "$")
    .replace(/\s+\$/g, "$");
}

function toKatexConstraint(expression) {
  return collapseText(expression)
    .replace(/<=/g, "\\le")
    .replace(/>=/g, "\\ge")
    .replace(/≤/g, "\\le")
    .replace(/≥/g, "\\ge")
    .replace(/×/g, "\\times")
    .replace(/\b([A-Za-z]+)_i\b/g, (_, name) => `${name}_i`)
    .replace(/\s*(\\le|\\ge|<|>|=)\s*/g, " $1 ")
    .replace(/\s*\\times\s*/g, " \\times ")
    .replace(/,\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isVjudgeProblemSectionHeading(line) {
  return /^(Description|Input|Output|Hint|Note|Explanation|Statement|题目描述|输入格式|输出格式|说明\/提示|提示)$/.test(line);
}

function isVjudgeProblemSampleHeading(line) {
  return /^(Sample|Examples|Input Output Examples|输入输出样例)(?:\s*#\d+)?$/i.test(line);
}

function isVjudgeProblemSampleIOHeading(line) {
  return /^(Sample Input|Sample Output|Input|Output|输入|输出)(?:\s*#\d+)?$/i.test(line);
}

function isVjudgeProblemNoiseLine(line) {
  return /^(Open|Submit|Statistics|Status|Copy|刷新|返回|题目列表|比赛列表|Virtual Judge)$/i.test(line);
}

function collectLuoguRecordListPageData() {
  const recordCandidates = Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => {
      const href = anchor.getAttribute("href") || "";
      if (!href) {
        return null;
      }

      const absoluteUrl = new URL(href, location.href).toString();
      const match = absoluteUrl.match(/^https:\/\/www\.luogu\.com\.cn\/record\/(\d+)(?:[/?#].*)?$/);
      if (!match) {
        return null;
      }

      const container = anchor.closest("tr, li, article, section, .row, .record, .item, div") || anchor;
      const rowText = collapseText(container.innerText || anchor.innerText || "");
      const accepted = /Accepted|答案正确|通过|AC/i.test(rowText) && !/Wrong Answer|Runtime Error|Time Limit|Compile Error|Memory Limit|Output Limit|Unaccepted|WA|RE|TLE|MLE|OLE|CE/i.test(rowText);

      return {
        id: match[1],
        url: absoluteUrl,
        text: rowText,
        accepted
      };
    })
    .filter(Boolean);

  const uniqueCandidates = [];
  const seenUrls = new Set();
  recordCandidates.forEach((item) => {
    if (seenUrls.has(item.url)) {
      return;
    }

    seenUrls.add(item.url);
    uniqueCandidates.push(item);
  });

  const preferred = uniqueCandidates.find((item) => item.accepted) || uniqueCandidates[0] || null;

  return {
    title: document.title || "提交记录列表",
    currentPage: location.href,
    recordUrl: preferred?.url || "",
    recordId: preferred?.id || "",
    foundAccepted: Boolean(preferred?.accepted),
    candidateCount: uniqueCandidates.length
  };
}

function exportLuoguRecordPage() {
  const recordData = collectLuoguRecordSourceData();
  const title = recordData.problemLabel
    ? `${recordData.problemLabel} 提交记录 ${recordData.recordId}`
    : `提交记录 ${recordData.recordId}`;
  const parts = [`# ${title}`, "", `来源：${location.href}`];
  const metadata = [
    recordData.problemLabel ? `题目：${recordData.problemLabel}` : "",
    recordData.problemId ? `题号：${recordData.problemId}` : "",
    recordData.recordId ? `记录 ID：${recordData.recordId}` : "",
    recordData.verdict ? `结果：${recordData.verdict}` : "",
    recordData.languageLabel ? `语言：${recordData.languageLabel}` : ""
  ].filter(Boolean);

  if (metadata.length > 0) {
    parts.push("", "## 基本信息", "");
    metadata.forEach((item) => parts.push(`- ${item}`));
  }

  parts.push("", "## 源代码", "", `\`\`\`${recordData.languageFence}`, recordData.content, "\`\`\`");

  return {
    pageType: "luogu-record",
    filename: `${sanitizeFilename(recordData.filenameBase || title)}.md`,
    markdown: normalizeMarkdown(parts.join("\n"))
  };
}

async function collectLuoguProblemMarkdownData() {
  const title = getFirstText([
    "h1",
    ".main-container h1",
    "main h1"
  ]) || document.title;

  const contentRoot = findProblemContentRoot();
  if (!contentRoot) {
    throw new Error("未找到题目正文区域");
  }

  const metadata = collectProblemMetadata();
  const sectionMarkdown = convertNodeChildrenToMarkdown(contentRoot).trim() || extractProblemMarkdownFromText(contentRoot.innerText || document.body.innerText || "");
  if (!sectionMarkdown) {
    throw new Error("题目正文为空，无法导出");
  }

  const parts = [`# ${title}`, "", `来源：${location.href}`];

  if (metadata.length > 0) {
    parts.push("", "## 基本信息", "");
    metadata.forEach((item) => parts.push(`- ${item}`));
  }

  parts.push("", sectionMarkdown);

  return {
    pageType: "luogu-problem",
    kind: "markdown",
    filename: `${sanitizeFilename(title)}.md`,
    content: normalizeMarkdown(parts.join("\n")),
    title,
    problemId: extractLuoguProblemId(),
    currentUserId: detectCurrentUserId()
  };
}

async function collectLuoguRecordSourceData() {
  const recordId = location.pathname.match(/\/record\/(\d+)/)?.[1] || "";
  const problemInfo = getLuoguRecordProblemInfo();
  const pageText = document.body.innerText || "";
  const language = detectRecordLanguage(pageText);
  const verdict = detectRecordVerdict(pageText);
  const code = await extractLuoguRecordCodeWithRetry();

  if (!code) {
    throw new Error("未找到可导出的源代码，可能当前记录不允许查看源码");
  }

  return {
    pageType: "luogu-record-source",
    kind: "source",
    filename: "std.cpp",
    content: code,
    problemId: problemInfo.id,
    problemLabel: problemInfo.label,
    problemUrl: problemInfo.id ? `https://www.luogu.com.cn/problem/${problemInfo.id}` : "",
    recordId,
    verdict,
    languageLabel: language.label,
    languageFence: language.fence,
    filenameBase: [problemInfo.id || problemInfo.label || "record", recordId, language.extension].filter(Boolean).join("_")
  };
}

async function exportLuoguProblemPage() {
  const problemData = await collectLuoguProblemMarkdownData();

  return {
    pageType: "luogu-problem",
    filename: problemData.filename,
    markdown: problemData.content
  };
}

function getLuoguRecordProblemInfo() {
  const problemAnchor = Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => ({
      anchor,
      href: anchor.getAttribute("href") || ""
    }))
    .find(({ href }) => /\/problem\/[^/?#]+/.test(href));

  if (!problemAnchor) {
    return {
      id: "",
      label: ""
    };
  }

  const absoluteUrl = new URL(problemAnchor.href, location.href).toString();
  const id = absoluteUrl.match(/\/problem\/([^/?#]+)/)?.[1] || "";
  const label = collapseText(problemAnchor.anchor.innerText || "") || id;

  return { id, label };
}

async function extractOfficialProblemMarkdown() {
  const copyButton = findLuoguCopyMarkdownButton();
  if (!copyButton) {
    return "";
  }

  const copiedText = await captureCopiedText(() => triggerElementClick(copyButton), 2000);
  return isLikelyProblemMarkdown(copiedText) ? copiedText.trim() : "";
}

function findLuoguCopyMarkdownButton() {
  const selectors = ["button", "a", "span", "div"];
  const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));

  return candidates.find((element) => {
    const text = collapseText(element.innerText || element.textContent || "");
    if (!/^复制\s*Markdown$/i.test(text)) {
      return false;
    }

    const rect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
    return !rect || (rect.width > 0 && rect.height > 0);
  }) || null;
}

async function captureCopiedText(action, timeout = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;

    const finish = (value = "") => {
      if (settled) {
        return;
      }

      settled = true;
      document.removeEventListener("copy", onCopy, true);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve(value || "");
    };

    const onCopy = (event) => {
      const copied = event.clipboardData?.getData("text/plain")
        || event.clipboardData?.getData("text")
        || "";
      finish(copied);
    };

    document.addEventListener("copy", onCopy, true);

    try {
      action();
    } catch (error) {
      console.warn("luogu-downloader: trigger copy markdown failed", error);
      finish("");
      return;
    }

    timeoutId = setTimeout(async () => {
      if (settled) {
        return;
      }

      const clipboardText = await readClipboardTextSafely();
      finish(clipboardText);
    }, timeout);
  });
}

async function readClipboardTextSafely() {
  try {
    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch (error) {
    return "";
  }

  return "";
}

function triggerElementClick(element) {
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}

function isLikelyProblemMarkdown(text) {
  if (!text) {
    return false;
  }

  return /(题目描述|输入格式|输出格式|样例|说明\/提示|##\s+题目描述|###\s+输入)/.test(text);
}

function extractLuoguProblemId() {
  const pathMatch = location.pathname.match(/\/problem\/([^/?#]+)/);
  if (pathMatch) {
    return pathMatch[1];
  }

  const problemAnchor = Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => new URL(anchor.getAttribute("href") || "", location.href).toString())
    .find((href) => /\/problem\/[^/?#]+/.test(href));

  return problemAnchor?.match(/\/problem\/([^/?#]+)/)?.[1] || "";
}

function detectCurrentUserId() {
  const selectorPriority = [
    "header a[href^='/user/']",
    "header a[href*='/user/']",
    "nav a[href^='/user/']",
    "nav a[href*='/user/']",
    ".nav a[href^='/user/']",
    ".nav a[href*='/user/']",
    "[class*='nav'] a[href^='/user/']",
    "[class*='nav'] a[href*='/user/']",
    "[class*='user'] a[href^='/user/']",
    "[class*='user'] a[href*='/user/']",
    "a[href^='/user/']",
    "a[href*='/user/']"
  ];

  for (const selector of selectorPriority) {
    const anchor = document.querySelector(selector);
    const href = anchor?.getAttribute("href") || "";
    const absoluteHref = href ? new URL(href, location.href).toString() : "";
    const match = absoluteHref.match(/\/user\/(\d+)/);
    if (match) {
      return match[1];
    }
  }

  const scriptDerivedId = extractCurrentUserIdFromPageText();
  if (scriptDerivedId) {
    return scriptDerivedId;
  }

  const storageDerivedId = extractCurrentUserIdFromStorage();
  if (storageDerivedId) {
    return storageDerivedId;
  }

  return "";
}

function extractCurrentUserIdFromPageText() {
  const sources = [];

  Array.from(document.scripts || []).forEach((script) => {
    if (script.textContent) {
      sources.push(script.textContent);
    }
  });

  const html = document.documentElement?.innerHTML || "";
  if (html) {
    sources.push(html);
  }

  const patterns = [
    /"currentUser"\s*:\s*\{[^{}]*?"uid"\s*:\s*(\d+)/i,
    /"user"\s*:\s*\{[^{}]*?"uid"\s*:\s*(\d+)/i,
    /"uid"\s*:\s*(\d+)/i,
    /"userId"\s*:\s*(\d+)/i,
    /\/user\/(\d+)/i
  ];

  for (const source of sources) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) {
        return match[1];
      }
    }
  }

  return "";
}

function extractCurrentUserIdFromStorage() {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) {
        continue;
      }

      const value = localStorage.getItem(key) || "";
      const candidate = `${key}=${value}`;
      const match = candidate.match(/(?:uid|userId|user_id)\D{0,20}(\d{3,})/i);
      if (match) {
        return match[1];
      }
    }
  } catch (error) {
    console.warn("luogu-downloader: localStorage user id detection failed", error);
  }

  return "";
}

function detectRecordVerdict(pageText) {
  const verdictPatterns = [
    /Accepted/,
    /答案正确/,
    /Wrong Answer/,
    /Time Limit Exceeded/,
    /Memory Limit Exceeded/,
    /Output Limit Exceeded/,
    /Runtime Error/,
    /Compile Error/
  ];

  for (const pattern of verdictPatterns) {
    const match = pageText.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return "";
}

function detectRecordLanguage(pageText) {
  const languagePatterns = [
    { pattern: /C\+\+\s*23|GNU\+\+23/i, label: "C++23", fence: "cpp", extension: "cpp" },
    { pattern: /C\+\+\s*20|GNU\+\+20/i, label: "C++20", fence: "cpp", extension: "cpp" },
    { pattern: /C\+\+\s*17|GNU\+\+17/i, label: "C++17", fence: "cpp", extension: "cpp" },
    { pattern: /C\+\+\s*14|GNU\+\+14/i, label: "C++14", fence: "cpp", extension: "cpp" },
    { pattern: /C\+\+|GNU\+\+/i, label: "C++", fence: "cpp", extension: "cpp" },
    { pattern: /Python\s*3/i, label: "Python 3", fence: "python", extension: "py" },
    { pattern: /Python\s*2/i, label: "Python 2", fence: "python", extension: "py" },
    { pattern: /Java(?!Script)/i, label: "Java", fence: "java", extension: "java" },
    { pattern: /JavaScript|Node\.js/i, label: "JavaScript", fence: "javascript", extension: "js" },
    { pattern: /Rust/i, label: "Rust", fence: "rust", extension: "rs" },
    { pattern: /Go/i, label: "Go", fence: "go", extension: "go" },
    { pattern: /Pascal/i, label: "Pascal", fence: "pascal", extension: "pas" }
  ];

  for (const item of languagePatterns) {
    if (item.pattern.test(pageText)) {
      return item;
    }
  }

  return {
    label: "C++",
    fence: "cpp",
    extension: "cpp"
  };
}

function extractLuoguRecordCode() {
  const selectors = [
    ".cm-content",
    ".CodeMirror-code",
    ".view-lines",
    "[class*='source'] pre",
    "[class*='source-code'] pre",
    "[class*='code'] pre",
    "pre code",
    "pre",
    "table"
  ];

  const candidates = [];

  selectors.forEach((selector) => {
    Array.from(document.querySelectorAll(selector)).forEach((element) => {
      const candidate = extractRecordCodeCandidate(element);
      if (!candidate) {
        return;
      }

      candidates.push({
        code: candidate,
        score: scoreRecordCodeCandidate(candidate)
      });
    });
  });

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.code || "";
}

async function extractLuoguRecordCodeWithRetry() {
  const directCode = extractLuoguRecordCode();
  if (directCode) {
    return directCode;
  }

  await activateLuoguRecordSourceTab();

  return waitForValue(() => extractLuoguRecordCode(), {
    timeout: 6000,
    interval: 150
  });
}

async function activateLuoguRecordSourceTab() {
  const tabControl = findLuoguRecordSourceTabControl();
  if (!tabControl) {
    return;
  }

  const active = tabControl.getAttribute("aria-selected") === "true"
    || /active|selected|current/.test(tabControl.className || "")
    || /active|selected|current/.test(tabControl.parentElement?.className || "");

  if (!active) {
    tabControl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    tabControl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    tabControl.click();
  }

  await waitForValue(() => {
    const code = extractLuoguRecordCode();
    return code || "";
  }, {
    timeout: 2500,
    interval: 120,
    allowEmptyResult: true
  });
}

function findLuoguRecordSourceTabControl() {
  const selectors = [
    "[role='tab']",
    "button",
    "a",
    "li",
    "div",
    "span"
  ];

  const elements = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  return elements.find((element) => {
    const text = collapseText(element.innerText || element.textContent || "");
    if (text !== "源代码") {
      return false;
    }

    const rect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
    return !rect || (rect.width > 0 && rect.height > 0);
  }) || null;
}

async function waitForValue(getValue, options = {}) {
  const timeout = options.timeout ?? 3000;
  const interval = options.interval ?? 100;
  const allowEmptyResult = options.allowEmptyResult ?? false;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const value = getValue();
    if (value || allowEmptyResult) {
      if (value) {
        return value;
      }
    }

    await delay(interval);
  }

  return getValue() || "";
}

function delay(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function extractRecordCodeCandidate(element) {
  const tag = element.tagName.toLowerCase();

  if (tag === "table") {
    return extractCodeFromTableElement(element);
  }

  if (tag === "code" && element.parentElement?.tagName?.toLowerCase() === "pre") {
    return normalizeSourceCode(element.innerText || element.textContent || "");
  }

  if (tag === "pre") {
    return normalizeSourceCode(extractCodeBlock(element));
  }

  return normalizeSourceCode(element.innerText || element.textContent || "");
}

function extractCodeFromTableElement(table) {
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) => Array.from(row.children).map((cell) => collapseText(cell.innerText || "")))
    .filter((row) => row.some(Boolean));

  if (!looksLikeCodeTable(rows)) {
    return "";
  }

  const codeLines = rows
    .filter((row) => row.length >= 2 && /^\d+$/.test(row[0]))
    .map((row) => row.slice(1).join(" "));

  return normalizeSourceCode(codeLines.join("\n"));
}

function normalizeSourceCode(text) {
  const lines = (text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split("\n");

  const numberedLineCount = lines.filter((line) => /^\s*\d+\s+/.test(line)).length;
  const stripLineNumbers = numberedLineCount > 0 && numberedLineCount >= Math.ceil(lines.length / 2);
  const normalizedLines = lines.map((line) => {
    const withoutLineNumber = stripLineNumbers ? line.replace(/^\s*\d+\s+/, "") : line;
    return withoutLineNumber.replace(/\s+$/g, "");
  });

  return normalizedLines.join("\n").trim();
}

function scoreRecordCodeCandidate(code) {
  const lines = code.split("\n").filter((line) => line.trim());
  if (lines.length === 0) {
    return 0;
  }

  let score = lines.length * 10 + code.length;

  if (/(#include|using namespace|int main|void solve|signed main|def\s+\w+|class\s+\w+|public static void main|fn\s+main|package\s+main|scanf\(|printf\(|cin\s*>>|cout\s*<<|return\s+)/.test(code)) {
    score += 500;
  }

  if (/[{}();<>\[\]#]/.test(code)) {
    score += 100;
  }

  return score;
}

function exportTiPage() {
  const title = getFirstText(["h1", ".page-header h1", "main h1"]) || document.title;
  const pageMain = document.querySelector("main") || document.body;
  const questionSections = extractTiQuestionSections(pageMain);

  if (questionSections.length > 0) {
    const sections = questionSections
      .map(({ number, container }) => {
        const body = cleanupTiQuestionMarkdown(convertNodeChildrenToMarkdown(container), number);
        const formatted = formatTiQuestionMarkdown(body, number);
        if (!formatted) {
          return "";
        }

        return `## 第 ${number} 题\n\n${formatted}`;
      })
      .filter(Boolean)
      .join("\n\n***\n\n");

    if (sections) {
      return {
        pageType: "ti-problemset",
        filename: `${sanitizeFilename(title)}.md`,
        markdown: normalizeMarkdown(`# ${title}\n\n来源：${location.href}\n\n${sections}`)
      };
    }
  }

  const fallback = cleanupTiPageText(pageMain.innerText || "");
  if (!fallback) {
    throw new Error("未找到可导出的题目内容");
  }

  return {
    pageType: "ti-page",
    filename: `${sanitizeFilename(title)}.md`,
    markdown: normalizeMarkdown(`# ${title}\n\n来源：${location.href}\n\n${fallback}`)
  };
}

function findProblemContentRoot() {
  const candidates = [
    document.querySelector("article"),
    document.querySelector("main article"),
    document.querySelector("main"),
    document.querySelector(".main-container"),
    document.body
  ].filter(Boolean);

  return candidates.find((node) => {
    const text = node.innerText || "";
    return /题目描述|输入格式|输出格式|样例|说明\/提示/.test(text);
  }) || null;
}

function collectProblemMetadata() {
  const metaTexts = [];
  const pageText = document.body.innerText || "";
  const patterns = [
    /题目编号\s*([^\n]+)/,
    /时间限制\s*([^\n]+)/,
    /内存限制\s*([^\n]+)/,
    /难度\s*([^\n]+)/
  ];

  patterns.forEach((pattern) => {
    const match = pageText.match(pattern);
    if (match && match[0]) {
      metaTexts.push(match[0].trim());
    }
  });

  return Array.from(new Set(metaTexts));
}

function extractProblemMarkdownFromText(rawText) {
  const normalizedText = normalizeProblemText(rawText);
  if (!normalizedText) {
    return "";
  }

  const lines = normalizedText.split("\n");
  const firstSectionIndex = lines.findIndex((line) => isProblemSectionHeading(line) || isProblemSampleHeading(line));
  if (firstSectionIndex < 0) {
    return "";
  }

  const filteredLines = lines
    .slice(firstSectionIndex)
    .filter((line) => !isProblemNoiseLine(line));

  const output = [];
  let index = 0;

  while (index < filteredLines.length) {
    const line = filteredLines[index];
    if (!line) {
      index += 1;
      continue;
    }

    if (isProblemSectionHeading(line) || isProblemSampleHeading(line)) {
      output.push(`## ${line}`, "");
      index += 1;
      continue;
    }

    if (isProblemSampleIOHeading(line)) {
      const blockTitle = line;
      const blockLines = [];
      index += 1;

      while (index < filteredLines.length) {
        const current = filteredLines[index];
        if (isProblemSectionHeading(current) || isProblemSampleHeading(current) || isProblemSampleIOHeading(current)) {
          break;
        }

        blockLines.push(current);
        index += 1;
      }

      output.push(`### ${blockTitle}`, "", "```", blockLines.join("\n").trim(), "```", "");
      continue;
    }

    output.push(line);
    index += 1;
  }

  return normalizeMarkdown(output.join("\n")).trim();
}

function normalizeProblemText(text) {
  return (text || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isProblemSectionHeading(line) {
  return /^(题目背景|题目描述|输入格式|输出格式|说明\/提示|提示|样例解释|数据范围|子任务|时空限制)$/.test(line);
}

function isProblemSampleHeading(line) {
  return /^输入输出样例(?:\s*#\d+)?$/.test(line);
}

function isProblemSampleIOHeading(line) {
  return /^(输入|输出)(?:\s*#\d+)?$/.test(line);
}

function isProblemNoiseLine(line) {
  return /^(复制 Markdown|进入 IDE 模式|查看题解|提交记录|题目反馈|加入做题计划|加入个人题单|加入团队题单|保存|广告|Luogu|洛谷)$/.test(line);
}

function findTiProblemBlocks() {
  const selectors = [
    ".problem",
    ".question",
    ".problem-item",
    ".panel",
    ".card",
    "section"
  ];

  const blocks = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));

  return blocks.filter((block) => {
    const text = block.innerText || "";
    return /第\s*\d+\s*题|A\.|B\.|C\.|D\.|查看题目|题目描述/.test(text) && text.length > 80;
  });
}

function extractTiQuestionSections(root) {
  const blockSections = extractTiQuestionSectionsFromProblemBlocks(root);
  if (blockSections.length > 0) {
    return blockSections;
  }

  const headingCandidates = findTiQuestionHeadings(root);

  const sectionsByNumber = new Map();

  headingCandidates.forEach((heading) => {
    const numberMatch = collapseText(heading.innerText || "").match(/^第\s*(\d+)\s*题$/);
    if (!numberMatch) {
      return;
    }

    const number = Number(numberMatch[1]);
    const container = findTiQuestionContainer(heading);
    if (!container) {
      return;
    }

    const text = cleanupTiQuestionMarkdown(convertNodeChildrenToMarkdown(container), number);
    if (!isUsefulTiQuestionText(text)) {
      return;
    }

    const current = sectionsByNumber.get(number);
    if (!current || text.length > current.text.length) {
      sectionsByNumber.set(number, { number, container, text });
    }
  });

  return Array.from(sectionsByNumber.values()).sort((left, right) => left.number - right.number);
}

function extractTiQuestionSectionsFromProblemBlocks(root) {
  const sectionsByNumber = new Map();
  const problemHeadings = Array.from(root.querySelectorAll(".problem-idx")).filter((element) => {
    return isTiQuestionHeading(element);
  });

  problemHeadings.forEach((heading) => {
    const numberMatch = collapseText(heading.innerText || "").match(/^第\s*(\d+)\s*题$/);
    if (!numberMatch) {
      return;
    }

    const number = Number(numberMatch[1]);
    const problemBlock = findDirectTiProblemSibling(heading);
    const container = heading.parentElement || problemBlock;
    if (!problemBlock || !container) {
      return;
    }

    const text = cleanupTiQuestionMarkdown(convertNodeChildrenToMarkdown(container), number);
    if (!isUsefulTiQuestionText(text)) {
      return;
    }

    const current = sectionsByNumber.get(number);
    if (!current || text.length > current.text.length) {
      sectionsByNumber.set(number, { number, container, text });
    }
  });

  return Array.from(sectionsByNumber.values()).sort((left, right) => left.number - right.number);
}

function findTiQuestionContainer(heading) {
  const directProblemSibling = findDirectTiProblemSibling(heading);
  if (directProblemSibling && heading.parentElement) {
    return heading.parentElement;
  }

  let current = heading;
  let bestCandidate = null;

  while (current && current !== document.body) {
    const text = collapseText(current.innerText || "");
    const questionCount = countTiQuestionHeadings(current);

    if (questionCount > 1) {
      break;
    }

    if (text.length > 40) {
      bestCandidate = current;
    }

    current = current.parentElement;
  }

  return bestCandidate;
}

function findTiQuestionHeadings(root) {
  return Array.from(
    root.querySelectorAll(".problem-idx, h1, h2, h3, h4, h5, h6, p, div, span, li, strong")
  ).filter((element) => isTiQuestionHeading(element));
}

function isTiQuestionHeading(element) {
  return /^第\s*\d+\s*题$/.test(collapseText(element?.innerText || ""));
}

function countTiQuestionHeadings(root) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return 0;
  }

  let count = isTiQuestionHeading(root) ? 1 : 0;
  count += findTiQuestionHeadings(root).length;
  return count;
}

function findDirectTiProblemSibling(heading) {
  const parent = heading?.parentElement;
  if (!parent) {
    return null;
  }

  return Array.from(parent.children || []).find((child) => {
    return child !== heading && child.classList?.contains("problem");
  }) || null;
}

function cleanupTiQuestionMarkdown(markdown, number) {
  const headingPattern = new RegExp(`^(?:#+\\s*)?第\\s*${number}\\s*题\\s*`, "i");

  return normalizeMarkdown(
    markdown
      .replace(/\r/g, "")
      .replace(headingPattern, "")
      .replace(/^题目列表\s*/g, "")
      .replace(/\n*登录后即可提交答卷[\s\S]*$/g, "")
      .replace(/\n*2013-20\d{2}[\s\S]*$/g, "")
      .replace(/\n*###\s*题目列表[\s\S]*?(?=第\s*\d+\s*题)/g, "")
      .replace(/(?:^|\n)\s*\d+\.\s*(?=\n\s*-\s*(?:\n|$))/g, "\n")
      .replace(/(?:^|\n)\s*-\s*(?=\n|$)/g, "\n")
      .replace(/\n{2,}(?=A\.\s*)/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/([A-D])\.\s*(.*?)(?=(?:\s+[A-D]\.\s*)|\n本题共|$)/gs, (match, option, text) => {
        const optionText = collapseText(text);
        return optionText ? `\n- ${option}. ${optionText}` : "";
      })
      .replace(/\n*本题共\s*(\d+)\s*分/g, "\n\n本题共 $1 分")
      .trim()
  ).trim();
}

function formatTiQuestionMarkdown(markdown, number) {
  if (!markdown) {
    return "";
  }

  const { content, codeBlocks } = extractCodeBlocks(markdown);
  const normalized = normalizeOptionBoundaries(content);
  const scoreMatch = normalized.match(/本题共\s*(\d+)\s*分/);
  const score = scoreMatch ? `${scoreMatch[1]} 分` : "";
  const contentWithoutScore = normalizeMarkdown(normalized.replace(/\n*本题共\s*\d+\s*分\s*/g, "\n\n")).trim();
  const supplement = extractTiSupplementSections(contentWithoutScore);
  const optionMatches = [...supplement.content.matchAll(/(?:^|\n)-\s*([A-Z])\.\s*([\s\S]*?)(?=(?:\n-\s*[A-Z]\.\s*)|$)/g)];
  const placeholderMatches = [...supplement.content.matchAll(/(?:^|\n)(\d+)\.\s*_{4,}(?=\n|$)/g)];

  let stem = supplement.content;
  let options = [];
  let placeholders = [];

  if (optionMatches.length > 0) {
    const firstOptionIndex = optionMatches[0].index ?? 0;
    stem = supplement.content.slice(0, firstOptionIndex).trim();
    options = optionMatches.map((match) => ({
      label: match[1],
      text: normalizeMarkdown(match[2]).replace(/^[-\s]+/, "").replace(/\n\s*-\s*$/g, "").trim()
    }));
  }

  if (placeholderMatches.length > 0) {
    const firstPlaceholderIndex = placeholderMatches[0].index ?? 0;
    if (firstPlaceholderIndex >= 0 && (options.length === 0 || firstPlaceholderIndex < stem.length)) {
      stem = supplement.content.slice(0, firstPlaceholderIndex).trim();
    }

    placeholders = placeholderMatches.map((match) => ({
      index: match[1],
      text: `${match[1]}. ______`
    }));
  }

  const codePlaceholderPattern = /@@CODE_BLOCK_(\d+)@@/g;
  stem = restoreCodeBlocks(stem, codeBlocks).trim();
  options = options.map((option) => ({
    ...option,
    text: restoreCodeBlocks(option.text, codeBlocks).replace(codePlaceholderPattern, "").trim()
  }));

  const cleanedStem = cleanupTiStemText(stem);
  const questionType = detectTiQuestionType(cleanedStem, options, placeholders);
  const standaloneCodeBlocks = collectStandaloneCodeBlocks(stem);
  const stemText = formatTiStemMarkdown(cleanupTiStemText(stripCodeBlocks(cleanedStem)).trim());
  const lines = [];

  lines.push(...buildTiQuestionMeta(questionType, score));

  if (stemText) {
    lines.push("### 题干", "", polishQuestionText(stemText));
  }

  if (standaloneCodeBlocks.length > 0) {
    lines.push("", "### 代码", "");
    standaloneCodeBlocks.forEach((block) => {
      lines.push(block, "");
    });
    lines.pop();
  }

  if (options.length > 0) {
    lines.push("", "### 选项", "");
    options.forEach((option) => {
      lines.push(`- **${option.label}.** ${cleanupOptionText(option.text)}`);
    });
  }

  if (placeholders.length > 0) {
    lines.push("", "### 作答", "");
    placeholders.forEach((placeholder) => {
      lines.push(`${placeholder.text}`);
    });
  }

  if (supplement.answer) {
    lines.push("", "### 答案", "", formatSupplementBlock(supplement.answer));
  }

  if (supplement.explanation) {
    lines.push("", "### 解析", "", formatSupplementBlock(supplement.explanation));
  }

  if (options.length === 0 && !stem) {
    return "";
  }

  return normalizeTiSectionSpacing(normalizeMarkdown(lines.join("\n")).trim());
}

function buildTiQuestionMeta(questionType, score) {
  const items = [];
  if (questionType) {
    items.push(`题型：${questionType}`);
  }
  if (score) {
    items.push(`分值：${score}`);
  }
  return items.length > 0 ? [`> ${items.join(" | ")}`, ""] : [];
}

function detectTiQuestionType(stem, options, placeholders = []) {
  const normalizedStem = collapseText(stem);
  const normalizedOptions = options.map((option) => collapseText(option.text));

  if (
    options.length === 2 &&
    normalizedOptions.includes("正确") &&
    normalizedOptions.includes("错误")
  ) {
    return "判断题";
  }

  if (/多选|哪些.*正确|选出.*正确|下列.*是.*的有|下列说法.*正确.*有/.test(normalizedStem)) {
    return "多选题";
  }

  if (options.length >= 2) {
    return "单选题";
  }

  if (placeholders.length > 0) {
    return "填空题";
  }

  if (/判断|true|false|正确|错误/.test(normalizedStem)) {
    return "判断题";
  }

  return "未分类";
}

function normalizeOptionBoundaries(text) {
  const placeholders = [];
  const protectedText = text.replace(/```[\s\S]*?```/g, (block) => {
    const token = `@@PROTECTED_BLOCK_${placeholders.length}@@`;
    placeholders.push(block);
    return token;
  });

  const normalized = protectedText
    .replace(/(^|\n)\s*([A-Z])\.\s*/g, "$1- $2. ")
    .replace(/([^\n-])\s+([A-Z])\.\s*(?=\S)/g, "$1\n- $2. ")
    .replace(/(^|\n)([A-Z])\.\s*\n/g, "$1- $2. ")
    .replace(/(^|\n)-\s+([A-Z])\.\s*(?=@@PROTECTED_BLOCK_)/g, "$1- $2. ")
    .replace(/\n{2,}(?=-\s*[A-Z]\.)/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  return placeholders.reduce((current, block, index) => {
    return current.replace(`@@PROTECTED_BLOCK_${index}@@`, block);
  }, normalized);
}

function extractTiSupplementSections(markdown) {
  const markers = ["标准答案", "参考答案", "正确答案", "答案", "解析", "解答", "题解", "说明"];
  let content = markdown;
  const answer = extractNamedSection(content, ["标准答案", "参考答案", "正确答案", "答案"], markers);
  if (answer.value) {
    content = answer.content;
  }

  const explanation = extractNamedSection(content, ["解析", "解答", "题解", "说明"], markers);
  if (explanation.value) {
    content = explanation.content;
  }

  return {
    content: normalizeMarkdown(content).trim(),
    answer: answer.value,
    explanation: explanation.value
  };
}

function extractNamedSection(markdown, labels, allMarkers) {
  const labelPattern = labels.join("|");
  const boundaryPattern = allMarkers.join("|");
  const regex = new RegExp(
    `(?:^|\\n)(?:#+\\s*)?(?:${labelPattern})\\s*[:：]?\\s*([\\s\\S]*?)(?=(?:\\n(?:#+\\s*)?(?:${boundaryPattern}|本题共|第\\s*\\d+\\s*题)\\b)|$)`,
    "i"
  );
  const match = markdown.match(regex);
  if (!match) {
    return { content: markdown, value: "" };
  }

  const value = normalizeMarkdown(match[1]).trim();
  const content = normalizeMarkdown(markdown.replace(match[0], "\n\n")).trim();
  return { content, value };
}

function extractCodeBlocks(markdown) {
  const codeBlocks = [];
  const content = markdown.replace(/```[\s\S]*?```/g, (block) => {
    const token = `@@CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(block.trim());
    return token;
  });

  return { content, codeBlocks };
}

function restoreCodeBlocks(text, codeBlocks) {
  return text.replace(/@@CODE_BLOCK_(\d+)@@/g, (match, index) => codeBlocks[Number(index)] || "");
}

function collectStandaloneCodeBlocks(text) {
  const matches = text.match(/```[\s\S]*?```/g);
  return matches ? matches.map((block) => block.trim()) : [];
}

function stripCodeBlocks(text) {
  return normalizeMarkdown(text.replace(/```[\s\S]*?```/g, "\n\n")).trim();
}

function cleanupOptionText(text) {
  return polishQuestionText(normalizeMarkdown(text)
    .replace(/\n{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function formatTiStemMarkdown(text) {
  return normalizeMarkdown(
    normalizeTiNumberedPrompts(
      normalizeTiImageParagraphs(text)
    )
  ).trim();
}

function cleanupTiStemText(text) {
  const cleaned = normalizeMarkdown(text)
    .replace(/(?:^|\n)#{1,6}\s*(?:题干|题目|题目描述|题干描述)\s*(?=\n|$)/gi, "\n")
    .replace(/(?:^|\n)\s*\d+[.、]\s*(?=\n|$)/g, "\n")
    .replace(/(?:^|\n)\s*[-—]+\s*(?=\n|$)/g, "\n")
    .replace(/(?:^|\n)\s*[·•]\s*(?=\n|$)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalizeFragmentedQuestionText(cleaned);
}

function normalizeTiImageParagraphs(text) {
  return normalizeMarkdown(text)
    .replace(/[ \t]*\n?[ \t]*(!\[[^\]]*\]\([^\)]+\))/g, "\n\n$1")
    .replace(/(!\[[^\]]*\]\([^\)]+\))[ \t]*\n?[ \t]*/g, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeTiNumberedPrompts(text) {
  const normalized = normalizeMarkdown(text)
    .replace(/([：:。；;])\s*(（\d+）)/g, "$1\n\n$2")
    .replace(/(!\[[^\]]*\]\([^\)]+\))\s*(（\d+）)/g, "$1\n\n$2")
    .trim();

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const structured = [];
  paragraphs.forEach((paragraph) => {
    splitTiNumberedParagraph(paragraph).forEach((segment) => {
      structured.push(formatTiNumberedSegment(segment));
    });
  });

  return normalizeMarkdown(structured.join("\n\n")).trim();
}

function splitTiNumberedParagraph(paragraph) {
  const matches = [...paragraph.matchAll(/（(\d+)）/g)];
  if (matches.length === 0) {
    return [paragraph];
  }

  const segments = [];
  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    if (index === 0 && start > 0) {
      const prefix = paragraph.slice(0, start).trim();
      if (prefix) {
        segments.push(prefix);
      }
    }

    const end = index + 1 < matches.length ? (matches[index + 1].index ?? paragraph.length) : paragraph.length;
    const segment = paragraph.slice(start, end).trim();
    if (segment) {
      segments.push(segment);
    }
  });

  return segments;
}

function formatTiNumberedSegment(segment) {
  const match = segment.match(/^（(\d+)）\s*([\s\S]*)$/);
  if (!match) {
    return segment;
  }

  const index = match[1];
  const body = match[2].trim();
  return body ? `${index}. ${body}` : `${index}.`;
}

function normalizeFragmentedQuestionText(text) {
  const paragraphs = normalizeMarkdown(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const merged = paragraphs.map((paragraph) => {
    if (!shouldMergeQuestionParagraph(paragraph)) {
      return paragraph;
    }

    return mergeQuestionParagraphLines(paragraph);
  });

  return normalizeChineseAsciiSpacing(normalizeMarkdown(merged.join("\n\n")).trim());
}

function shouldMergeQuestionParagraph(paragraph) {
  const lines = paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return false;
  }

  return !lines.some((line) => /^(?:[#>|-]|\d+\.\s|```|\|)/.test(line));
}

function mergeQuestionParagraphLines(paragraph) {
  const lines = paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return paragraph.trim();
  }

  let merged = lines[0];

  for (let index = 1; index < lines.length; index += 1) {
    const nextLine = lines[index];
    merged += chooseQuestionLineJoiner(lines[index - 1], nextLine) + nextLine;
  }

  return merged.trim();
}

function chooseQuestionLineJoiner(previousLine, nextLine) {
  const previous = previousLine.trim();
  const next = nextLine.trim();

  if (!previous || !next) {
    return "";
  }

  if (/^[A-Za-z0-9][A-Za-z0-9_.…+-]*$/.test(previous) || /^[A-Za-z0-9][A-Za-z0-9_.…+-]*$/.test(next)) {
    return " ";
  }

  const previousChar = previous.slice(-1);
  const nextChar = next[0];

  if (/[（《“([{]/.test(previousChar) || /[，。！？；：、）》】.,;:!?)}\]]/.test(nextChar)) {
    return "";
  }

  return "";
}

function normalizeChineseAsciiSpacing(text) {
  return normalizeAbnormalPunctuation(normalizeMarkdown(text)
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9][A-Za-z0-9_.…+-]*)(?=[\u4e00-\u9fff])/g, "$1 $2 ")
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9][A-Za-z0-9_.…+-]*)(?=[，。！？；：、])/g, "$1 $2")
    .replace(/(?<=[（《“])\s+/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function formatSupplementBlock(text) {
  if (!text) {
    return "";
  }

  const cleaned = restoreListFormatting(polishQuestionText(text));
  return cleaned.includes("\n") ? cleaned : `- ${cleaned}`;
}

function polishQuestionText(text) {
  return normalizeAbnormalPunctuation(normalizeMarkdown(text)
    .replace(/\s+([，。！？；：、）》])+/g, "$1")
    .replace(/([（《“])\s+/g, "$1")
    .replace(/\s+([）》”])/g, "$1")
    .replace(/\s*\(\s*\)/g, "（ ）")
    .replace(/\s*（\s*）/g, "（ ）")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function normalizeAbnormalPunctuation(text) {
  return normalizeMarkdown(text)
    .replace(/（\s*[。．.!！?？]+/g, "（")
    .replace(/([（《“])\s*([。．.!！?？]+)/g, "$1")
    .replace(/\b\(\s*[。．.!！?？]+/g, "(")
    .replace(/([，。！？；：、,.!?;:]){2,}/g, "$1")
    .replace(/（\s*）\s*[。．]/g, "（ ）")
    .replace(/\(\s*\)\s*[。．]/g, "（ ）")
    .trim();
}

function normalizeTiSectionSpacing(text) {
  return normalizeMarkdown(text)
    .replace(/\n{3,}(?=###\s+)/g, "\n\n")
    .replace(/(^|\n)(###\s+[^\n]+)\n{2,}/g, "$1$2\n\n")
    .replace(/([^\n])\n(###\s+[^\n]+)/g, "$1\n\n$2")
    .replace(/(```[\s\S]*?```)(\n)(###\s+)/g, "$1\n\n$3")
    .replace(/(###\s+[^\n]+)\n{3,}/g, "$1\n\n")
    .trim();
}

function restoreListFormatting(text) {
  return text
    .replace(/(?:^|\n)-\s*([A-Z])\.\s*/g, "\n- **$1.** ")
    .replace(/^\n/, "")
    .trim();
}

function isUsefulTiQuestionText(text) {
  if (!text) {
    return false;
  }

  if (/^第\s*\d+\s*题$/.test(text)) {
    return false;
  }

  return /本题共\s*\d+\s*分|A\.|B\.|正确|错误|```/.test(text) || text.length > 80;
}

function cleanupTiPageText(text) {
  const normalized = collapseText(text)
    .replace(/\r/g, "")
    .replace(/\n*登录后即可提交答卷[\s\S]*$/g, "")
    .replace(/\n*2013-20\d{2}[\s\S]*$/g, "");

  const firstQuestionIndex = normalized.search(/第\s*1\s*题/);
  const body = firstQuestionIndex >= 0 ? normalized.slice(firstQuestionIndex) : normalized;
  const blocks = body
    .split(/(?=第\s*\d+\s*题)/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const uniqueBlocks = new Map();
  blocks.forEach((block) => {
    const match = block.match(/^第\s*(\d+)\s*题/);
    if (!match) {
      return;
    }

    const number = Number(match[1]);
    const cleaned = cleanupTiQuestionMarkdown(block, number);
    if (!isUsefulTiQuestionText(cleaned)) {
      return;
    }

    const current = uniqueBlocks.get(number);
    if (!current || cleaned.length > current.length) {
      uniqueBlocks.set(number, cleaned);
    }
  });

  return Array.from(uniqueBlocks.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([number, block]) => {
      const formatted = formatTiQuestionMarkdown(block, number);
      return formatted ? `## 第 ${number} 题\n\n${formatted}` : "";
    })
    .filter(Boolean)
    .join("\n\n***\n\n");
}

function getFirstText(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const text = element?.innerText?.trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function getFirstTextWithin(root, selectors) {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    const text = getNodeText(element).trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function convertNodeChildrenToMarkdown(root) {
  const rootTag = root?.tagName?.toLowerCase?.() || "";
  const joiner = usesInlineJoin(rootTag) ? "" : "\n";

  return Array.from(root.childNodes)
    .map((node) => convertNodeToMarkdown(node))
    .filter(Boolean)
    .join(joiner)
    .trim();
}

function convertNodeToMarkdown(node, depth = 0) {
  if (!node) {
    return "";
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return collapseText(node.textContent || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node;
  if (shouldSkipElement(element)) {
    return "";
  }

  const tag = element.tagName.toLowerCase();
  const childMarkdown = Array.from(element.childNodes)
    .map((child) => convertNodeToMarkdown(child, depth + 1))
    .filter(Boolean)
    .join(getMarkdownChildJoiner(tag))
    .trim();

  if (/^h[1-6]$/.test(tag)) {
    const level = Math.min(Number(tag[1]), 6);
    const text = collapseText(getNodeText(element) || childMarkdown);
    return text ? `${"#".repeat(level)} ${text}` : "";
  }

  if (tag === "p" || tag === "blockquote") {
    return childMarkdown;
  }

  if (tag === "br") {
    return "  \n";
  }

  if (tag === "pre") {
    const code = extractCodeBlock(element);
    return code ? `\n\`\`\`\n${code}\n\`\`\`\n` : "";
  }

  if (tag === "code") {
    if (element.closest("pre")) {
      return "";
    }

    const code = collapseText(getNodeText(element) || "");
    return code ? ` ${code} ` : "";
  }

  if (tag === "ul" || tag === "ol") {
    if (tag === "ol" && element.classList.contains("questions")) {
      return convertTiQuestionsList(element);
    }

    const items = Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child, index) => {
        const marker = tag === "ol" ? `${index + 1}.` : "-";
        const content = convertNodeChildrenToMarkdown(child).replace(/\n+/g, " ").trim();
        return content ? `${marker} ${content}` : "";
      })
      .filter(Boolean);

    return items.join("\n");
  }

  if (tag === "table") {
    return convertTableToMarkdown(element);
  }

  if (tag === "img") {
    const src = element.getAttribute("src");
    const alt = element.getAttribute("alt") || "image";
    if (!src) {
      return "";
    }

    const baseUrl = element.ownerDocument?.location?.href || location.href;
    return `![${alt}](${new URL(src, baseUrl).href})`;
  }

  if (tag === "a") {
    const href = element.getAttribute("href");
    const text = collapseText(getNodeText(element) || childMarkdown);
    if (!text) {
      return "";
    }

    if (!href || href.startsWith("javascript:")) {
      return text;
    }

    const baseUrl = element.ownerDocument?.location?.href || location.href;
    const absoluteHref = new URL(href, baseUrl).href;
    return `[${text}](${absoluteHref})`;
  }

  if (tag === "hr") {
    return "---";
  }

  return childMarkdown;
}

function convertTiQuestionsList(listElement) {
  const items = Array.from(listElement.children)
    .filter((child) => child.tagName.toLowerCase() === "li")
    .map((child, index) => convertTiQuestionItem(child, index))
    .filter(Boolean);

  return items.join("\n");
}

function convertTiQuestionItem(itemElement, index) {
  const optionLines = extractTiOptionLines(itemElement);
  if (optionLines.length > 0) {
    return optionLines.join("\n");
  }

  const label = collapseText(itemElement.querySelector(".label")?.innerText || `${index + 1}.`);
  const textInputs = itemElement.querySelectorAll("input[type='text'], textarea");
  if (textInputs.length > 0) {
    return `${label} ______`;
  }

  const content = convertNodeChildrenToMarkdown(itemElement)
    .replace(new RegExp(`^${escapeRegExp(label)}\s*`), "")
    .trim();

  return content ? `${label} ${content}`.trim() : label;
}

function extractTiOptionLines(itemElement) {
  const optionElements = Array.from(itemElement.querySelectorAll(".option"));
  return optionElements.map((optionElement) => {
    const label = collapseText(optionElement.querySelector("label")?.innerText || optionElement.innerText || "")
      .match(/^([A-Z])\./)?.[1];
    const marked = optionElement.querySelector(".marked");
    const optionText = marked ? collapseText(marked.innerText || "") : collapseText(optionElement.innerText || "").replace(/^[A-Z]\.\s*/, "");
    return label && optionText ? `${label}. ${optionText}` : "";
  }).filter(Boolean);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function convertTableToMarkdown(table) {
  const sampleBlocks = extractSampleInputOutputBlocks(table);
  if (sampleBlocks) {
    return sampleBlocks;
  }

  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) => Array.from(row.children).map((cell) => collapseText(getNodeText(cell) || "")))
    .filter((row) => row.some(Boolean));

  if (rows.length === 0) {
    return "";
  }

  if (looksLikeCodeTable(rows)) {
    const codeLines = rows
      .filter((row) => row.length >= 2 && /^\d+$/.test(row[0]))
      .map((row) => row.slice(1).join(" "));

    if (codeLines.length > 0) {
      return `\n\`\`\`cpp\n${codeLines.join("\n")}\n\`\`\`\n`;
    }
  }

  const header = rows[0];
  const body = rows.slice(1);
  const separator = header.map(() => "---");
  const lines = [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`);
  return lines.join("\n");
}

function extractSampleInputOutputBlocks(table) {
  const rowElements = Array.from(table.querySelectorAll("tr"));
  if (rowElements.length < 2) {
    return "";
  }

  const firstRowCells = Array.from(rowElements[0].children);
  if (firstRowCells.length !== 2) {
    return "";
  }

  const leftHeader = collapseText(getNodeText(firstRowCells[0]) || "");
  const rightHeader = collapseText(getNodeText(firstRowCells[1]) || "");
  if (!looksLikeSampleInputHeader(leftHeader) || !looksLikeSampleOutputHeader(rightHeader)) {
    return "";
  }

  const leftParts = [];
  const rightParts = [];
  rowElements.slice(1).forEach((row) => {
    const cells = Array.from(row.children);
    if (cells[0]) {
      const text = cleanupSampleCellText(getNodeText(cells[0]) || "");
      if (text) {
        leftParts.push(text);
      }
    }

    if (cells[1]) {
      const text = cleanupSampleCellText(getNodeText(cells[1]) || "");
      if (text) {
        rightParts.push(text);
      }
    }
  });

  if (leftParts.length === 0 && rightParts.length === 0) {
    return "";
  }

  const blocks = [];
  if (leftParts.length > 0) {
    blocks.push("**Input**", "", "```text", leftParts.join("\n\n"), "```", "");
  }
  if (rightParts.length > 0) {
    blocks.push("**Output**", "", "```text", rightParts.join("\n\n"), "```", "");
  }

  return blocks.join("\n").trim();
}

function looksLikeSampleInputHeader(text) {
  return /^(Sample\s*Input|Input|样例输入|输入)(?:\s*copy)?$/i.test(text);
}

function looksLikeSampleOutputHeader(text) {
  return /^(Sample\s*Output|Output|样例输出|输出)(?:\s*copy)?$/i.test(text);
}

function cleanupSampleCellText(text) {
  return (text || "")
    .replace(/\r/g, "")
    .replace(/(^|\n)\s*copy\s*(?=\n|$)/gi, "$1")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeCodeTable(rows) {
  if (rows.length < 2) {
    return false;
  }

  const codeRows = rows.filter((row) => row.length >= 2 && /^\d+$/.test(row[0]));
  return codeRows.length >= Math.max(2, Math.floor(rows.length / 2));
}

function extractCodeBlock(preElement) {
  const codeElement = preElement.querySelector("code");
  const raw = codeElement ? getNodeText(codeElement) : getNodeText(preElement);
  return (raw || "").replace(/\u00a0/g, " ").trimEnd();
}

function shouldSkipElement(element) {
  const tag = element.tagName.toLowerCase();
  if (["script", "style", "noscript", "svg", "button", "textarea", "input"].includes(tag)) {
    return true;
  }

  const text = getNodeText(element).trim();
  if (!text && tag !== "img") {
    return true;
  }

  return /复制 Markdown|进入 IDE 模式|查看题解|提交记录|题目反馈|加入做题计划|加入个人题单|加入团队题单|保存|广告/.test(text);
}

function getMarkdownChildJoiner(tag) {
  if (tag === "pre" || usesInlineJoin(tag)) {
    return "";
  }

  if (["p", "li", "td", "th", "dt", "dd", "figcaption", "summary"].includes(tag)) {
    return "";
  }

  return "\n";
}

function usesInlineJoin(tag) {
  return [
    "a",
    "b",
    "code",
    "em",
    "i",
    "label",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "u"
  ].includes(tag);
}

function getNodeText(node) {
  if (!node) {
    return "";
  }

  return String(node.innerText || node.textContent || "");
}

function collapseText(text) {
  return (text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeMarkdown(markdown) {
  return markdown
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim() + "\n";
}

function sanitizeFilename(name) {
  return (name || "luogu-export")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function downloadMarkdown(content, filename) {
  downloadContent(content, filename, "text/markdown;charset=utf-8");
}

function downloadContent(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function extractVjudgeStructuredDescriptionMarkdown(rootDocument = document, baseUrl = "") {
  const raw = rootDocument?.querySelector("textarea.data-json-container")?.value || "";
  if (!raw) {
    return "";
  }

  try {
    const payload = JSON.parse(raw);
    const sections = Array.isArray(payload?.sections) ? payload.sections : [];
    if (sections.length === 0) {
      return "";
    }

    const lines = [];
    let sampleSectionStarted = false;

    sections.forEach((section) => {
      const title = collapseText(section?.title || "");
      const html = String(section?.value?.content || "").trim();
      if (!title || !html) {
        return;
      }

      const heading = mapVjudgeStructuredSectionHeading(title);
      const bodyMarkdown = convertVjudgeStructuredHtmlToMarkdown(html, baseUrl).trim();
      if (!bodyMarkdown) {
        return;
      }

      if (heading === "输入输出样例") {
        if (!sampleSectionStarted) {
          lines.push(`## ${heading}`, "");
          sampleSectionStarted = true;
        }
      } else {
        lines.push(`## ${heading}`, "");
      }

      if (/^Sample\s+\d+/i.test(title)) {
        lines.push(`### 样例 ${title.match(/\d+/)?.[0] || ""}`.trim(), "");
      }

      lines.push(bodyMarkdown, "");
    });

    return normalizeMarkdown(lines.join("\n")).trim();
  } catch (error) {
    console.warn("luogu-downloader: parse VJudge structured description failed", error);
    return "";
  }
}

function mapVjudgeStructuredSectionHeading(title) {
  const normalized = collapseText(title || "");
  if (/^Problem Statement$/i.test(normalized)) {
    return "题目描述";
  }
  if (/^Constraints$/i.test(normalized)) {
    return "数据范围";
  }
  if (/^Input$/i.test(normalized)) {
    return "输入格式";
  }
  if (/^Output$/i.test(normalized)) {
    return "输出格式";
  }
  if (/^Sample\s+\d+/i.test(normalized)) {
    return "输入输出样例";
  }
  if (/^(Note|Notes|Hint|Explanation)$/i.test(normalized)) {
    return "提示";
  }
  return normalized;
}

function convertVjudgeStructuredHtmlToMarkdown(html, baseUrl = "") {
  const parser = new DOMParser();
  const parsedDocument = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const baseElement = parsedDocument.createElement("base");
  baseElement.setAttribute("href", baseUrl || location.href);
  parsedDocument.head?.prepend(baseElement);
  const markdown = convertNodeChildrenToMarkdown(parsedDocument.body).trim();
  return normalizeVjudgeStructuredTeX(markdown);
}

function normalizeVjudgeStructuredTeX(markdown) {
  return rebuildVjudgeStructuredInputBlocks(String(markdown || "")
    .replace(/\\\(([^\n]+?)\\\)/g, (_, expr) => `$${expr.trim()}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => `$$\n${expr.trim()}\n$$`)
    .replace(/\\mathrm\{([^}]+)\}_([A-Za-z0-9]+)/g, "$1_$2")
    .replace(/\\mathrm\{([^}]+)\}/g, "$1")
    .replace(/\\vdots/g, "...")
    .replace(/\$query_([A-Za-z0-9]+)\$/g, "query_$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function rebuildVjudgeStructuredInputBlocks(markdown) {
  return String(markdown || "")
    .replace(/```\n\$Q\$\nquery_1\nquery_2\n\.\.\.\nquery_Q\n```/g, [
      "```text",
      "Q",
      "query_1",
      "query_2",
      "...",
      "query_Q",
      "```"
    ].join("\n"))
    .replace(/```\n\$1\$ \$X\$\n```/g, [
      "```text",
      "1 X",
      "```"
    ].join("\n"))
    .replace(/```\n\$2\$\n```/g, [
      "```text",
      "2",
      "```"
    ].join("\n"));
}

function formatVjudgeProblemMarkdown(markdown, isStructuredSource = false) {
  const normalized = String(markdown || "").trim();
  if (!normalized) {
    return "";
  }

  return isStructuredSource
    ? postprocessVjudgeMarkdown(normalized)
    : normalizeVjudgeProblemMarkdown(normalized);
}