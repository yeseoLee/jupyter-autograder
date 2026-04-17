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

function buildPerfectNotebook() {
  return {
    cells: [
      { cell_type: "markdown", source: "Task Planning Agent" },
      {
        cell_type: "code",
        source: `
temperature = 0.1
max_tokens = 800
chunk_size = 1000
chunk_overlap = 150
embedding_model = "text-embedding-3-small"
embedding_function = emb
retriever = {"k": 4}

def ask_vision_analyst():
    qwen3vl_answer.invoke({"image": "first"})
    qwen3vl_answer.invoke({"image": "fallback"})

@tool
def ask_planner():
    return "ok"

def general_chat():
    general_executor.invoke({"question": "hello"})

supervisor_tools = [
    ask_vision_analyst,
    ask_planner,
    ask_developer,
    check_progress,
    general_chat,
]
supervisor = create_agent(...)
planning_executor = None
        `,
      },
      {
        cell_type: "code",
        source: "# [Step 13]",
        outputs: [
          {
            output_type: "stream",
            text: JSON.stringify([
              { tool_name: "ask_vision_analyst" },
              { tool_name: "ask_planner" },
              { tool_name: "ask_developer" },
              { tool_name: "check_progress" },
            ]),
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
              "text/plain": JSON.stringify([{ tool_name: "general_chat" }]),
            },
          },
        ],
      },
    ],
  };
}

test("gradeNotebook returns full score when all rubric items are satisfied", () => {
  const result = gradeNotebook(buildPerfectNotebook());

  assert.equal(result.total_score, 100);
  assert.equal(result.code_score, 50);
  assert.equal(result.output_score, 50);
  assert.equal(result.temperature, "O");
  assert.equal(result.out_general_branch, "O");
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
    notebook: buildPerfectNotebook(),
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
  assert.equal(deriveStudentName(`${"홍길동_기본 1반.zip".normalize("NFD")}`), nfcName);
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
    notebook: buildPerfectNotebook(),
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
