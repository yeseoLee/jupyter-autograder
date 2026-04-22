import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeResults,
  buildGradingRow,
  buildMarkdownReport,
  buildResultsCsv,
  createBlankResult,
  deriveStudentName,
  extractToolNamesFromTrace,
  getFailedItemLabels,
  gradeNotebook,
  normalizeUnicodeNFC,
} from "../docs/assets/core.mjs";

function buildNotebookFixture({
  temperature = "0",
  maxTokens = "900",
  chunkSize = "1200",
  chunkOverlap = "200",
  retrieverK = "3",
  includeSpecSearch = true,
  includeDevInvoke = true,
  includeGeneralExecutor = true,
  step13Tools = [
    "ask_vision_analyst",
    "ask_planner",
    "ask_developer",
    "check_progress",
  ],
  step15Tools = ["general_chat"],
  extraOutputs = [],
} = {}) {
  const planningTools = includeSpecSearch ? "tools=[spec_search]" : "tools=[]";
  const developerInvokeLine = includeDevInvoke ? '    dev_executor.invoke({"task": "ship"})' : '    return "noop"';
  const generalInvokeLine = includeGeneralExecutor
    ? '    general_executor.invoke({"question": "hello"})'
    : '    return "noop"';

  const code = `
temperature = ${temperature}
max_tokens = ${maxTokens}
chunk_size = ${chunkSize}
chunk_overlap = ${chunkOverlap}
embedding_model = "text-embedding-3-small"
embedding_function = emb
retriever = {"k": ${retrieverK}}

planning_executor = create_agent(
    model="gpt",
    ${planningTools},
)
dev_executor = create_agent(
    model="gpt",
    tools=[],
)

def ask_vision_analyst():
    return "ok"

@tool
def ask_planner():
    return "ok"

def ask_developer():
${developerInvokeLine}

def check_progress():
    return "ok"

def general_chat():
${generalInvokeLine}

supervisor_tools = [
    ask_vision_analyst,
    ask_planner,
    ask_developer,
    check_progress,
    general_chat,
]
supervisor = create_agent(...)
  `;

  return {
    cells: [
      { cell_type: "markdown", source: "Task Planning Agent" },
      { cell_type: "code", source: code },
      {
        cell_type: "code",
        source: "# [Step 13]",
        outputs: [
          {
            output_type: "stream",
            text: JSON.stringify(step13Tools.map((toolName) => ({ tool_name: toolName }))),
          },
        ],
      },
      {
        cell_type: "code",
        source: "# [Step 15]",
        outputs: [
          {
            output_type: "execute_result",
            data: {
              "text/plain": JSON.stringify(step15Tools.map((toolName) => ({ tool_name: toolName }))),
            },
          },
        ],
      },
      ...extraOutputs.map((text, index) => ({
        cell_type: "code",
        source: `# [Extra ${index + 1}]`,
        outputs: [{ output_type: "stream", text }],
      })),
    ],
  };
}

test("gradeNotebook returns full score when all april 2026 rubric items are satisfied", () => {
  const result = gradeNotebook(buildNotebookFixture());

  assert.equal(result.total_score, 100);
  assert.equal(result.code_score, 50);
  assert.equal(result.output_score, 50);
  assert.equal(result.temperature, "O");
  assert.equal(result.max_tokens, "O");
  assert.equal(result.spec_search_tool, "O");
  assert.equal(result.dev_invoke, "O");
  assert.equal(result.irrelevant_output_deduction, "없음");
  assert.match(result.step13_tools_called, /ask_planner/);
});

test("extractToolNamesFromTrace falls back to regex when JSON parse fails", () => {
  const trace = 'prefix {"tool_name": "ask_developer"}\n{"tool_name": "check_progress"} suffix';
  assert.deepEqual(extractToolNamesFromTrace(trace), ["ask_developer", "check_progress"]);
});

test("analyzeResults summarizes failed items for blank rows", () => {
  const success = buildGradingRow({
    studentName: "홍길동",
    fileName: "hong.zip",
    notebook: buildNotebookFixture(),
  });
  const failure = createBlankResult("김학생", "kim.zip", "zip 파일 없음");

  const analysis = analyzeResults([success, failure]);
  const failedItems = getFailedItemLabels(failure);

  assert.equal(analysis.summary.studentCount, 2);
  assert.equal(analysis.bucketCounts.find((row) => row.bucket === "100점")?.count, 1);
  assert.equal(analysis.bucketCounts.find((row) => row.bucket === "0점대")?.count, 1);
  assert.ok(failedItems.length > 5);
  assert.equal(analysis.deductionRows[1].감점합계_기준표계산, 100);
});

test("unicode helpers normalize macOS-style NFD Korean text to NFC", () => {
  const nfcName = "홍길동";
  const nfdName = nfcName.normalize("NFD");
  const nfcPath = "제출파일/홍길동_기본 1반/홍길동.ipynb";
  const nfdPath = nfcPath.normalize("NFD");

  assert.notEqual(nfdName, nfcName);
  assert.notEqual(nfdPath, nfcPath);
  assert.equal(normalizeUnicodeNFC(nfdName), nfcName);
  assert.equal(deriveStudentName("홍길동_기본 1반.zip".normalize("NFD")), nfcName);
});

test("grading rows, csv, and markdown report serialize Korean names and paths in NFC", () => {
  const nfcName = "홍길동";
  const nfcZip = "홍길동_기본 1반.zip";
  const nfcPath = "제출파일/홍길동_기본 1반/홍길동.ipynb";
  const nfdName = nfcName.normalize("NFD");
  const nfdZip = nfcZip.normalize("NFD");
  const nfdPath = nfcPath.normalize("NFD");

  const row = buildGradingRow({
    studentName: nfdName,
    fileName: nfdZip,
    notebook: buildNotebookFixture(),
    selectedNotebook: nfdPath,
    warning: `선택 노트북: ${nfdPath}`,
  });

  assert.equal(row.이름, nfcName);
  assert.equal(row.파일명, nfcZip);
  assert.equal(row.selected_notebook, nfcPath);
  assert.equal(row.warning, `선택 노트북: ${nfcPath}`);

  const csv = buildResultsCsv([row]);
  assert.match(csv, /홍길동_기본 1반\.zip/);
  assert.ok(!csv.includes(nfdName));
  assert.ok(!csv.includes(nfdZip));

  const analysis = analyzeResults([row, createBlankResult("김학생", "kim.zip", "zip 파일 없음")]);
  const report = buildMarkdownReport([row], analyzeResults([row]), {
    inputName: "전체제출_홍길동.zip".normalize("NFD"),
  });
  assert.match(report, /전체제출_홍길동\.zip/);
  assert.ok(!report.includes("전체제출_홍길동.zip".normalize("NFD")));
  assert.equal(analysis.summary.studentCount, 2);
});

test("old rubric values fail under the new april 2026 checks", () => {
  const result = gradeNotebook(
    buildNotebookFixture({
      temperature: "0.1",
      maxTokens: "800",
      chunkSize: "1000",
      chunkOverlap: "150",
      retrieverK: "4",
    }),
  );

  assert.equal(result.temperature, "X");
  assert.equal(result.max_tokens, "X");
  assert.equal(result.chunk_size, "X");
  assert.equal(result.chunk_overlap, "X");
  assert.equal(result.retriever_k, "X");
  assert.equal(result.code_score, 30);
  assert.equal(result.total_score, 80);
});

test("missing planning spec_search marks spec_search_tool as failed", () => {
  const result = gradeNotebook(buildNotebookFixture({ includeSpecSearch: false }));

  assert.equal(result.spec_search_tool, "X");
  assert.equal(result.code_score, 45);
});

test("missing ask_developer dev_executor.invoke marks dev_invoke as failed", () => {
  const result = gradeNotebook(buildNotebookFixture({ includeDevInvoke: false }));

  assert.equal(result.dev_invoke, "X");
  assert.equal(result.code_score, 45);
});

test("irrelevant output keywords apply -30 deduction and clamp total score at zero", () => {
  const fullScoreResult = gradeNotebook(
    buildNotebookFixture({
      extraOutputs: ["translation helper output"],
    }),
  );
  assert.equal(fullScoreResult.irrelevant_output_deduction, "-30 ('translation')");
  assert.equal(fullScoreResult.total_score, 70);

  const zeroClampedResult = gradeNotebook(
    buildNotebookFixture({
      temperature: "0.1",
      maxTokens: "800",
      chunkSize: "1000",
      chunkOverlap: "150",
      retrieverK: "4",
      includeSpecSearch: false,
      includeDevInvoke: false,
      includeGeneralExecutor: false,
      step13Tools: [],
      step15Tools: [],
      extraOutputs: ["STT transcript"],
    }),
  );
  assert.equal(zeroClampedResult.irrelevant_output_deduction, "-30 ('STT')");
  assert.equal(zeroClampedResult.total_score, 0);
});

test("results csv uses new columns and removes qwen columns", () => {
  const row = buildGradingRow({
    studentName: "홍길동",
    fileName: "hong.zip",
    notebook: buildNotebookFixture({ extraOutputs: ["translation helper output"] }),
  });

  const header = buildResultsCsv([row]).split("\r\n")[0];
  assert.match(header, /irrelevant_output_deduction/);
  assert.match(header, /spec_search_tool/);
  assert.match(header, /dev_invoke/);
  assert.doesNotMatch(header, /qwen_invoke_1st/);
  assert.doesNotMatch(header, /qwen_invoke_fallback/);
});

test("markdown report includes irrelevant output deduction text and adjusted totals", () => {
  const row = buildGradingRow({
    studentName: "홍길동",
    fileName: "hong.zip",
    notebook: buildNotebookFixture({ extraOutputs: ["translation helper output"] }),
  });
  const report = buildMarkdownReport([row], analyzeResults([row]));

  assert.match(report, /총점 평균/);
  assert.match(report, /70/);
  assert.match(report, /주제 외 출력 감점 \(-30 \('translation'\)\)/);
});
