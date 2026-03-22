console.log("luogu-downloader: content script loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "prepareNavigationAway") {
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

  if (request.action === "collectTiProblemsetPageData") {
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

  if (request.action !== "startScraping") {
    return false;
  }

  try {
    const result = buildMarkdownForCurrentPage();
    downloadMarkdown(result.markdown, result.filename);
    sendResponse({
      status: "success",
      filename: result.filename,
      pageType: result.pageType
    });
  } catch (error) {
    console.error("luogu-downloader: scrape failed", error);
    sendResponse({
      status: "error",
      message: error.message || "抓取失败"
    });
  }

  return true;
});

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

function buildMarkdownForCurrentPage() {
  const url = window.location.href;

  if (location.hostname === "www.luogu.com.cn" && /\/problem\//.test(location.pathname)) {
    return exportLuoguProblemPage();
  }

  if (location.hostname === "ti.luogu.com.cn") {
    return exportTiPage();
  }

  throw new Error(`暂不支持当前页面: ${url}`);
}

function exportLuoguProblemPage() {
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
  const sectionMarkdown = convertNodeChildrenToMarkdown(contentRoot).trim();
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
    filename: `${sanitizeFilename(title)}.md`,
    markdown: normalizeMarkdown(parts.join("\n"))
  };
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
    const text = element?.innerText?.trim();
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
    .join(tag === "pre" || usesInlineJoin(tag) ? "" : "\n")
    .trim();

  if (/^h[1-6]$/.test(tag)) {
    const level = Math.min(Number(tag[1]), 6);
    const text = collapseText(element.innerText || childMarkdown);
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

    const code = collapseText(element.innerText || "");
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
    return src ? `![${alt}](${src})` : "";
  }

  if (tag === "a") {
    const href = element.getAttribute("href");
    const text = collapseText(element.innerText || childMarkdown);
    if (!text) {
      return "";
    }

    if (!href || href.startsWith("javascript:")) {
      return text;
    }

    const absoluteHref = new URL(href, location.href).href;
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
  const rows = Array.from(table.querySelectorAll("tr"))
    .map((row) => Array.from(row.children).map((cell) => collapseText(cell.innerText || "")))
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

function looksLikeCodeTable(rows) {
  if (rows.length < 2) {
    return false;
  }

  const codeRows = rows.filter((row) => row.length >= 2 && /^\d+$/.test(row[0]));
  return codeRows.length >= Math.max(2, Math.floor(rows.length / 2));
}

function extractCodeBlock(preElement) {
  const codeElement = preElement.querySelector("code");
  const raw = codeElement ? codeElement.innerText : preElement.innerText;
  return (raw || "").replace(/\u00a0/g, " ").trimEnd();
}

function shouldSkipElement(element) {
  const tag = element.tagName.toLowerCase();
  if (["script", "style", "noscript", "svg", "button", "textarea", "input"].includes(tag)) {
    return true;
  }

  const text = element.innerText?.trim() || "";
  if (!text && tag !== "img") {
    return true;
  }

  return /复制 Markdown|进入 IDE 模式|查看题解|提交记录|题目反馈|加入做题计划|加入个人题单|加入团队题单|保存|广告/.test(text);
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
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}