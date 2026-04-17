export const ITEM_SPECS = [
  { col: "temperature", label: "temperature = 0.1", points: 2.5, group: "코드" },
  { col: "max_tokens", label: "max_tokens = 800", points: 2.5, group: "코드" },
  { col: "chunk_size", label: "chunk_size = 1000", points: 5, group: "코드" },
  { col: "chunk_overlap", label: "chunk_overlap = 150", points: 5, group: "코드" },
  {
    col: "embedding_model",
    label: 'embedding_model = "text-embedding-3-small"',
    points: 5,
    group: "코드",
  },
  { col: "embedding_function", label: "embedding_function = emb", points: 5, group: "코드" },
  { col: "retriever_k", label: "retriever k = 4", points: 5, group: "코드" },
  {
    col: "qwen_invoke_1st",
    label: "ask_vision_analyst 내 qwen3vl_answer.invoke (첫 번째)",
    points: 5,
    group: "코드",
  },
  {
    col: "qwen_invoke_fallback",
    label: "ask_vision_analyst 내 qwen3vl_answer.invoke (fallback)",
    points: 5,
    group: "코드",
  },
  {
    col: "general_executor",
    label: "general_chat 내 general_executor.invoke",
    points: 5,
    group: "코드",
  },
  {
    col: "supervisor_tools",
    label: "supervisor_tools에 5개 도구 모두 포함",
    points: 5,
    group: "코드",
  },
  {
    col: "out_vision_analyst",
    label: "Step 13 trace에 ask_vision_analyst 호출 여부",
    points: 10,
    group: "출력",
  },
  {
    col: "out_planner",
    label: "Step 13 trace에 ask_planner 호출 여부",
    points: 10,
    group: "출력",
  },
  {
    col: "out_developer",
    label: "Step 13 trace에 ask_developer 호출 여부",
    points: 10,
    group: "출력",
  },
  {
    col: "out_progress",
    label: "Step 13 trace에 check_progress 호출 여부",
    points: 10,
    group: "출력",
  },
  {
    col: "out_general_branch",
    label: "Step 15 trace에 general_chat 호출 여부",
    points: 10,
    group: "출력",
  },
];

export const FIXED_COLUMNS = [
  "이름",
  "파일명",
  "total_score",
  "code_score",
  "output_score",
  "temperature",
  "max_tokens",
  "chunk_size",
  "chunk_overlap",
  "embedding_model",
  "embedding_function",
  "retriever_k",
  "qwen_invoke_1st",
  "qwen_invoke_fallback",
  "general_executor",
  "supervisor_tools",
  "out_vision_analyst",
  "out_planner",
  "out_developer",
  "out_progress",
  "out_general_branch",
  "step13_tools_called",
  "step15_tools_called",
];

export const BUCKET_ORDER = [
  "100점",
  "90점대",
  "80점대",
  "70점대",
  "60점대",
  "50점대",
  "40점대",
  "30점대",
  "20점대",
  "10점대",
  "0점대",
];

const TRUE_SET = new Set(["1", "true", "yes", "y", "pass", "ok", "o", "t"]);
const FALSE_SET = new Set(["0", "false", "no", "n", "fail", "x", "", "f", "none", "nan"]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTextValue(value) {
  if (Array.isArray(value)) {
    return value.join("");
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

function roundNumber(value, digits = 2) {
  if (!isFiniteNumber(value)) {
    return 0;
  }
  return Number(value.toFixed(digits));
}

function toCheckMark(passed) {
  return passed ? "O" : "X";
}

function extractFunctionSlice(code, functionName, boundaryMarkers) {
  const start = code.search(new RegExp(`def\\s+${escapeRegex(functionName)}\\b`));
  if (start === -1) {
    return "";
  }

  const slice = code.slice(start);
  let end = slice.length;
  for (const marker of boundaryMarkers) {
    const index = slice.indexOf(marker);
    if (index !== -1 && index < end) {
      end = index;
    }
  }
  return slice.slice(0, end);
}

function extractSupervisorToolsBlock(code) {
  const start = code.search(/supervisor_tools\s*=\s*\[/);
  if (start === -1) {
    return "";
  }

  const slice = code.slice(start);
  const marker = slice.search(/supervisor\s*=\s*create_agent/);
  if (marker === -1) {
    return slice;
  }
  return slice.slice(0, marker);
}

function outputToText(output) {
  const outputType = output?.output_type ?? "";
  if (outputType === "stream") {
    return normalizeTextValue(output?.text);
  }
  if (outputType === "execute_result" || outputType === "display_data") {
    return normalizeTextValue(output?.data?.["text/plain"]);
  }
  if (outputType === "error") {
    return normalizeTextValue(output?.traceback);
  }
  return "";
}

function markdownEscape(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function rowsToMarkdownTable(rows, columns) {
  if (!rows.length) {
    return "_데이터 없음_";
  }
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${columns.map((column) => markdownEscape(row[column])).join(" | ")} |`)
    .join("\n");
  return [header, divider, body].join("\n");
}

export function normalizeBoolLike(value) {
  if (value == null || (typeof value === "number" && Number.isNaN(value))) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (TRUE_SET.has(normalized)) {
    return true;
  }
  if (FALSE_SET.has(normalized)) {
    return false;
  }
  return value;
}

export function isItemPassed(value) {
  const normalized = normalizeBoolLike(value);
  if (typeof normalized === "boolean") {
    return normalized;
  }
  if (typeof normalized === "number") {
    return normalized > 0;
  }
  return false;
}

export function totalScoreBucket(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) {
    return "미분류";
  }
  if (numeric >= 100) {
    return "100점";
  }
  const tens = Math.max(0, Math.floor(numeric / 10) * 10);
  return `${tens}점대`;
}

export function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  if (Math.abs(numeric - Math.trunc(numeric)) < 1e-9) {
    return String(Math.trunc(numeric));
  }
  return numeric.toFixed(1);
}

export function deriveStudentName(rawName) {
  return String(rawName ?? "")
    .replace(/\.[^.]+$/, "")
    .split("_")[0]
    .trim();
}

export function createBlankResult(studentName, fileName, errorMessage = "") {
  const row = {
    이름: studentName,
    파일명: fileName,
    total_score: 0,
    code_score: 0,
    output_score: 0,
    step13_tools_called: "(없음)",
    step15_tools_called: "(없음)",
    selected_notebook: "",
    warning: "",
    오류: errorMessage,
  };

  for (const spec of ITEM_SPECS) {
    row[spec.col] = "";
  }

  return row;
}

export function getCellOutput(notebook, stepMarker) {
  const cells = Array.isArray(notebook?.cells) ? notebook.cells : [];
  const stepMatch = /Step\s*(\d+)/i.exec(stepMarker);
  const matcher = stepMatch
    ? new RegExp(`#.*Step\\s*${stepMatch[1]}\\b`, "i")
    : new RegExp(escapeRegex(stepMarker), "i");

  for (const cell of cells) {
    if (cell?.cell_type !== "code") {
      continue;
    }
    const source = normalizeTextValue(cell?.source);
    if (!matcher.test(source)) {
      continue;
    }
    const texts = (Array.isArray(cell?.outputs) ? cell.outputs : [])
      .map((output) => outputToText(output))
      .filter(Boolean);
    return texts.join("\n").trim();
  }

  return "";
}

export function extractToolNamesFromTrace(traceText) {
  const text = String(traceText ?? "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");

  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (item && typeof item === "object" ? item.tool_name : ""))
          .filter(Boolean);
      }
    } catch {
      // fall through
    }
  }

  return [...text.matchAll(/"tool_name"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
}

export function gradeNotebook(notebook) {
  if (!Array.isArray(notebook?.cells)) {
    throw new Error("노트북 형식이 올바르지 않습니다.");
  }

  const firstMarkdownCells = notebook.cells
    .filter((cell) => cell?.cell_type === "markdown")
    .slice(0, 5);

  for (const cell of firstMarkdownCells) {
    const source = normalizeTextValue(cell?.source);
    if (source.includes("가전제품") || source.includes("스마트홈 연동")) {
      throw new Error("다른 과제 제출 (가전제품/스마트홈 버전) — 채점 제외");
    }
  }

  const code = notebook.cells
    .filter((cell) => cell?.cell_type === "code")
    .map((cell) => normalizeTextValue(cell?.source))
    .join("\n");

  const checkTemperature = /temperature\s*=\s*0\.1/.test(code);
  const checkMaxTokens = /max_tokens\s*=\s*800/.test(code);
  const checkChunkSize = /chunk_size\s*=\s*1000/.test(code);
  const checkChunkOverlap = /chunk_overlap\s*=\s*150/.test(code);
  const checkEmbeddingModel = code.includes("text-embedding-3-small");
  const checkEmbeddingFunction = /embedding_function\s*=\s*emb/.test(code);
  const checkRetrieverK = /["']k["']\s*:\s*4/.test(code);

  const visionFnCode = extractFunctionSlice(code, "ask_vision_analyst", ["\n@tool", "\nplanning_executor"]);
  const qwenInvokes = visionFnCode.match(/qwen3vl_answer\.invoke\s*\(/g) ?? [];
  const checkQwenInvokeFirst = qwenInvokes.length >= 1;
  const checkQwenInvokeFallback = qwenInvokes.length >= 2;

  const generalFnCode = extractFunctionSlice(code, "general_chat", ["\n@tool", "\nsupervisor_tools"]);
  const checkGeneralExecutor = /general_executor\.invoke\s*\(/.test(generalFnCode);

  const supervisorToolsBlock = extractSupervisorToolsBlock(code);
  const requiredTools = [
    "ask_vision_analyst",
    "ask_planner",
    "ask_developer",
    "check_progress",
    "general_chat",
  ];
  const checkSupervisorTools = requiredTools.every((tool) => supervisorToolsBlock.includes(tool));

  const codeChecks = {
    temperature: [checkTemperature, 2.5],
    max_tokens: [checkMaxTokens, 2.5],
    chunk_size: [checkChunkSize, 5],
    chunk_overlap: [checkChunkOverlap, 5],
    embedding_model: [checkEmbeddingModel, 5],
    embedding_function: [checkEmbeddingFunction, 5],
    retriever_k: [checkRetrieverK, 5],
    qwen_invoke_1st: [checkQwenInvokeFirst, 5],
    qwen_invoke_fallback: [checkQwenInvokeFallback, 5],
    general_executor: [checkGeneralExecutor, 5],
    supervisor_tools: [checkSupervisorTools, 5],
  };

  const codeScore = Object.values(codeChecks).reduce(
    (sum, [passed, points]) => sum + (passed ? points : 0),
    0,
  );

  let traceOutput = "";
  for (const marker of ["# [Step 13]"]) {
    const output = getCellOutput(notebook, marker);
    if (output.includes('"tool_name"')) {
      traceOutput = output;
      break;
    }
  }

  const calledTools = extractToolNamesFromTrace(traceOutput);
  const step15Output = getCellOutput(notebook, "# [Step 15]");
  const step15Tools = extractToolNamesFromTrace(step15Output);
  const outputChecks = {
    out_vision_analyst: [calledTools.includes("ask_vision_analyst"), 10],
    out_planner: [calledTools.includes("ask_planner"), 10],
    out_developer: [calledTools.includes("ask_developer"), 10],
    out_progress: [calledTools.includes("check_progress"), 10],
    out_general_branch: [step15Tools.includes("general_chat"), 10],
  };

  const outputScore = Object.values(outputChecks).reduce(
    (sum, [passed, points]) => sum + (passed ? points : 0),
    0,
  );

  const totalScore = codeScore + outputScore;
  const result = {
    total_score: totalScore,
    code_score: codeScore,
    output_score: outputScore,
    step13_tools_called: calledTools.length ? calledTools.join(", ") : "(없음)",
    step15_tools_called: step15Tools.length ? step15Tools.join(", ") : "(없음)",
  };

  for (const [column, [passed]] of Object.entries({ ...codeChecks, ...outputChecks })) {
    result[column] = toCheckMark(passed);
  }

  return result;
}

export function buildGradingRow({
  studentName,
  fileName,
  notebook,
  selectedNotebook = "",
  warning = "",
}) {
  const row = {
    이름: studentName,
    파일명: fileName,
    selected_notebook: selectedNotebook,
    warning,
    오류: "",
  };
  return { ...row, ...gradeNotebook(notebook) };
}

export function getFailedItemLabels(row) {
  return ITEM_SPECS.filter((spec) => !isItemPassed(row?.[spec.col])).map((spec) => spec.label);
}

export function buildDeductionRows(results) {
  return results.map((row) => {
    const failedItems = [];
    let deductedPoints = 0;

    for (const spec of ITEM_SPECS) {
      if (!isItemPassed(row?.[spec.col])) {
        failedItems.push(`${spec.label} (-${formatNumber(spec.points)}점)`);
        deductedPoints += spec.points;
      }
    }

    return {
      이름: row?.이름 ?? "",
      파일명: row?.파일명 ?? "",
      total_score: Number(row?.total_score) || 0,
      code_score: Number(row?.code_score) || 0,
      output_score: Number(row?.output_score) || 0,
      감점합계_기준표계산: deductedPoints,
      감점항목: failedItems.length ? failedItems.join("; ") : "없음",
      총점구간: totalScoreBucket(row?.total_score),
    };
  });
}

export function buildItemStats(results) {
  return ITEM_SPECS.map((spec) => {
    const failCount = results.filter((row) => !isItemPassed(row?.[spec.col])).length;
    const failRate = results.length ? (failCount / results.length) * 100 : 0;
    return {
      구분: spec.group,
      항목: spec.label,
      배점: spec.points,
      감점자수: failCount,
      "감점비율(%)": roundNumber(failRate, 1),
      누적감점: roundNumber(failCount * spec.points, 1),
    };
  }).sort((left, right) => {
    if (left.구분 !== right.구분) {
      return left.구분.localeCompare(right.구분, "ko");
    }
    if (right.감점자수 !== left.감점자수) {
      return right.감점자수 - left.감점자수;
    }
    return right.배점 - left.배점;
  });
}

export function analyzeResults(results) {
  const deductionRows = buildDeductionRows(results);
  const itemStats = buildItemStats(results);
  const scores = results.map((row) => Number(row?.total_score) || 0).sort((a, b) => a - b);
  const count = scores.length;
  const mean = count ? scores.reduce((sum, value) => sum + value, 0) / count : 0;
  const median =
    count === 0
      ? 0
      : count % 2 === 1
        ? scores[(count - 1) / 2]
        : (scores[count / 2 - 1] + scores[count / 2]) / 2;

  const bucketCounts = BUCKET_ORDER.map((bucket) => ({
    bucket,
    count: deductionRows.filter((row) => row.총점구간 === bucket).length,
  }));

  const bucketSections = BUCKET_ORDER.flatMap((bucket) => {
    const subset = deductionRows
      .filter((row) => row.총점구간 === bucket)
      .sort((left, right) => {
        const scoreDelta = (Number(right.total_score) || 0) - (Number(left.total_score) || 0);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return String(left.이름 ?? "").localeCompare(String(right.이름 ?? ""), "ko");
      });

    if (!subset.length) {
      return [];
    }

    return {
      bucket,
      entries: subset.map((row) => ({
        name: row.이름,
        totalScore: row.total_score,
        deductionText: row.감점항목,
      })),
    };
  });

  return {
    summary: {
      studentCount: count,
      meanTotal: roundNumber(mean),
      medianTotal: roundNumber(median),
      minTotal: count ? roundNumber(scores[0]) : 0,
      maxTotal: count ? roundNumber(scores[scores.length - 1]) : 0,
      meanCode: roundNumber(
        count
          ? results.reduce((sum, row) => sum + (Number(row?.code_score) || 0), 0) / count
          : 0,
      ),
      meanOutput: roundNumber(
        count
          ? results.reduce((sum, row) => sum + (Number(row?.output_score) || 0), 0) / count
          : 0,
      ),
    },
    deductionRows,
    itemStats,
    topDeductionItems: itemStats.slice(0, 10),
    bucketCounts,
    bucketSections,
  };
}

export function toCsv(rows, columns) {
  const escapeCell = (value) => {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((column) => escapeCell(row[column])).join(","));
  return `${[header, ...lines].join("\r\n")}\r\n`;
}

export function buildResultsCsv(results) {
  return toCsv(results, FIXED_COLUMNS);
}

export function buildMarkdownReport(results, analysis, meta = {}) {
  const generatedAt = meta.generatedAt ?? new Date();
  const inputName = meta.inputName ?? "uploaded.zip";
  const { summary, bucketCounts, itemStats, topDeductionItems, bucketSections } = analysis;

  const summaryRows = [
    { 지표: "응시 인원", 값: summary.studentCount },
    { 지표: "총점 평균", 값: summary.meanTotal },
    { 지표: "총점 중앙값", 값: summary.medianTotal },
    { 지표: "총점 최고점", 값: summary.maxTotal },
    { 지표: "총점 최저점", 값: summary.minTotal },
    { 지표: "코드 점수 평균", 값: summary.meanCode },
    { 지표: "출력 점수 평균", 값: summary.meanOutput },
  ];

  const bucketRows = bucketCounts.filter((row) => row.count > 0).map((row) => ({
    총점구간: row.bucket,
    인원수: row.count,
  }));

  const reportLines = [
    "# 채점 결과 통계 리포트",
    "",
    `- 생성 시각: ${generatedAt.toLocaleString("ko-KR")}`,
    `- 입력 ZIP: \`${inputName}\``,
    `- 채점 대상 수: ${results.length}`,
    "",
    "## 1. 요약",
    "",
    rowsToMarkdownTable(summaryRows, ["지표", "값"]),
    "",
    "## 2. 총점 구간별 인원수",
    "",
    rowsToMarkdownTable(bucketRows, ["총점구간", "인원수"]),
    "",
    "## 3. 감점 항목 빈도",
    "",
    rowsToMarkdownTable(itemStats, ["구분", "항목", "배점", "감점자수", "감점비율(%)", "누적감점"]),
    "",
    "## 4. 가장 많이 감점된 항목 Top 10",
    "",
    rowsToMarkdownTable(topDeductionItems, [
      "구분",
      "항목",
      "배점",
      "감점자수",
      "감점비율(%)",
      "누적감점",
    ]),
    "",
    "## 5. 총점 구간별 명단 및 감점 항목",
    "",
  ];

  if (!bucketSections.length) {
    reportLines.push("_데이터 없음_");
  } else {
    for (const section of bucketSections) {
      reportLines.push(`### ${section.bucket}`);
      reportLines.push("");
      for (const entry of section.entries) {
        reportLines.push(`- ${entry.name} (${formatNumber(entry.totalScore)}점): ${entry.deductionText}`);
      }
      reportLines.push("");
    }
  }

  reportLines.push("## 6. 해석 가이드");
  reportLines.push("");
  reportLines.push("- `감점항목`은 기준표 기준으로 충족되지 않은 항목을 나열합니다.");
  reportLines.push("- 업로드 구조가 예외적인 경우 `warning` 또는 `오류` 컬럼을 함께 확인하세요.");
  reportLines.push("- 웹 버전은 `.zip` 업로드만 지원합니다.");

  return `${reportLines.join("\n")}\n`;
}
