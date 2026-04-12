import {
  BlobReader,
  ERR_ENCRYPTED,
  ERR_INVALID_PASSWORD,
  ERR_UNSUPPORTED_ENCRYPTION,
  ZipReader,
} from "https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm";

import {
  analyzeResults,
  buildGradingRow,
  buildMarkdownReport,
  buildResultsCsv,
  createBlankResult,
  deriveStudentName,
  formatNumber,
  getFailedItemLabels,
} from "./core.mjs";

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const numberFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const textDecoder = new TextDecoder();
const COLLECTION_FOLDERS = new Set(["제출파일", "submission", "submissions", "upload", "uploads"]);
const SUPPORTED_ARCHIVE_EXTENSIONS = [".zip"];
const INVALID_PASSWORD_PATTERN = /invalid password|wrong password|password verification failed/i;
const ENCRYPTED_ZIP_PATTERN = /encrypted|password required|missing password|password is required/i;
const UNSUPPORTED_ENCRYPTION_PATTERN = /unsupported encryption/i;

const state = {
  file: null,
  results: [],
  analysis: null,
  markdownReport: "",
};

const elements = {
  zipInput: document.querySelector("#zipInput"),
  zipPassword: document.querySelector("#zipPassword"),
  dropzone: document.querySelector("#dropzone"),
  selectedFileName: document.querySelector("#selectedFileName"),
  gradeButton: document.querySelector("#gradeButton"),
  resetButton: document.querySelector("#resetButton"),
  statusBanner: document.querySelector("#statusBanner"),
  summaryCards: document.querySelector("#summaryCards"),
  distributionList: document.querySelector("#distributionList"),
  summaryResultsTableWrap: document.querySelector("#summaryResultsTableWrap"),
  resultsTableWrap: document.querySelector("#resultsTableWrap"),
  itemStatsTableWrap: document.querySelector("#itemStatsTableWrap"),
  resultCountChip: document.querySelector("#resultCountChip"),
  downloadResults: document.querySelector("#downloadResults"),
  downloadReport: document.querySelector("#downloadReport"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizePath(path) {
  return String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

function basename(path) {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function stripExtension(filename) {
  return String(filename ?? "").replace(/\.[^.]+$/, "");
}

function hasExtension(filename, extension) {
  return String(filename ?? "").toLowerCase().endsWith(extension);
}

function isZipFile(filename) {
  return SUPPORTED_ARCHIVE_EXTENSIONS.some((extension) => hasExtension(filename, extension));
}

function isNotebookFile(filename) {
  return hasExtension(filename, ".ipynb");
}

function isSystemPath(path) {
  return path.includes("__MACOSX") || basename(path).startsWith(".");
}

function commonPrefixLength(segmentLists) {
  if (!segmentLists.length) {
    return 0;
  }

  let index = 0;
  while (true) {
    const token = segmentLists[0][index];
    if (!token) {
      return index;
    }
    if (segmentLists.some((segments) => segments[index] !== token)) {
      return index;
    }
    index += 1;
  }
}

function getStatusType(message) {
  if (message.startsWith("오류")) {
    return "error";
  }
  if (message.startsWith("완료")) {
    return "success";
  }
  return "info";
}

function setStatus(message) {
  elements.statusBanner.textContent = message;
  elements.statusBanner.dataset.state = getStatusType(message);
}

function setBusy(isBusy) {
  elements.gradeButton.disabled = isBusy || !state.file;
  elements.resetButton.disabled = isBusy || (!state.file && !state.results.length);
  elements.zipInput.disabled = isBusy;
  elements.zipPassword.disabled = isBusy;
  elements.downloadResults.disabled = isBusy || !state.results.length;
  elements.downloadReport.disabled = isBusy || !state.results.length;
  document.body.dataset.busy = isBusy ? "true" : "false";
}

function downloadText(filename, content, mimeType) {
  const isCsv = mimeType.startsWith("text/csv");
  const blob = isCsv
    ? new Blob(["\uFEFF", content], { type: mimeType })
    : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getArchivePassword() {
  return elements.zipPassword.value;
}

function getErrorFingerprint(error) {
  return [error?.code, error?.name, error?.message]
    .filter(Boolean)
    .map((value) => String(value))
    .join(" | ");
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error ?? "알 수 없는 오류");
}

function matchesArchiveError(error, constant, pattern) {
  const fingerprint = getErrorFingerprint(error);
  return fingerprint.includes(String(constant)) || pattern.test(fingerprint);
}

function describeArchiveError(error) {
  if (matchesArchiveError(error, ERR_INVALID_PASSWORD, INVALID_PASSWORD_PATTERN)) {
    return "ZIP 비밀번호가 올바르지 않습니다.";
  }
  if (matchesArchiveError(error, ERR_ENCRYPTED, ENCRYPTED_ZIP_PATTERN)) {
    return "암호화된 ZIP입니다. 비밀번호를 입력하세요.";
  }
  if (matchesArchiveError(error, ERR_UNSUPPORTED_ENCRYPTION, UNSUPPORTED_ENCRYPTION_PATTERN)) {
    return "지원되지 않는 ZIP 암호화 방식입니다.";
  }
  return null;
}

function formatArchiveError(error, fallbackPrefix = "압축 해제 실패") {
  return describeArchiveError(error) ?? `${fallbackPrefix}: ${getErrorMessage(error)}`;
}

function buildReadOptions(password) {
  return password ? { password } : undefined;
}

function createArchiveRecord(entry, password) {
  const path = normalizePath(entry.filename);

  return {
    path,
    basename: basename(path),
    encrypted: Boolean(entry.encrypted),
    async readArrayBuffer() {
      return entry.arrayBuffer(buildReadOptions(password));
    },
    async readText() {
      const buffer = await entry.arrayBuffer(buildReadOptions(password));
      return textDecoder.decode(buffer);
    },
  };
}

async function openZipArchiveFromBlob(blob, password) {
  const zipReader = new ZipReader(new BlobReader(blob), buildReadOptions(password));

  try {
    const entries = await zipReader.getEntries();
    return {
      records: entries
        .filter((entry) => !entry.directory)
        .map((entry) => createArchiveRecord(entry, password)),
      async close() {
        await zipReader.close();
      },
    };
  } catch (error) {
    try {
      await zipReader.close();
    } catch {
      // ignore close errors
    }
    throw error;
  }
}

function renderSummary() {
  if (!state.analysis) {
    elements.summaryCards.innerHTML = '<div class="placeholder-card">채점 후 요약 카드가 표시됩니다.</div>';
    elements.distributionList.innerHTML = "";
    return;
  }

  const { summary, bucketCounts } = state.analysis;
  const cards = [
    { label: "응시 인원", value: summary.studentCount, tone: "accent" },
    { label: "총점 평균", value: formatNumber(summary.meanTotal), tone: "neutral" },
    { label: "총점 중앙값", value: formatNumber(summary.medianTotal), tone: "neutral" },
    { label: "최고 / 최저", value: `${formatNumber(summary.maxTotal)} / ${formatNumber(summary.minTotal)}`, tone: "warm" },
    { label: "코드 평균", value: formatNumber(summary.meanCode), tone: "neutral" },
    { label: "출력 평균", value: formatNumber(summary.meanOutput), tone: "neutral" },
  ];

  elements.summaryCards.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card" data-tone="${card.tone}">
          <div class="summary-label">${escapeHtml(card.label)}</div>
          <div class="summary-value">${escapeHtml(card.value)}</div>
        </article>
      `,
    )
    .join("");

  const maxCount = Math.max(1, ...bucketCounts.map((row) => row.count));
  elements.distributionList.innerHTML = bucketCounts
    .filter((row) => row.count > 0)
    .map((row) => {
      const width = `${Math.max(10, (row.count / maxCount) * 100)}%`;
      return `
        <div class="distribution-row">
          <div class="distribution-label">${escapeHtml(row.bucket)}</div>
          <div class="distribution-bar">
            <span style="width:${width}"></span>
          </div>
          <div class="distribution-count">${escapeHtml(String(row.count))}명</div>
        </div>
      `;
    })
    .join("");
}

function getSortedResults() {
  return [...state.results].sort((left, right) => {
    const scoreDelta = (Number(right.total_score) || 0) - (Number(left.total_score) || 0);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return collator.compare(String(left.이름 ?? ""), String(right.이름 ?? ""));
  });
}

function renderSummaryResultsTable() {
  if (!state.results.length) {
    elements.summaryResultsTableWrap.innerHTML =
      '<div class="empty-table">채점 결과가 아직 없습니다.</div>';
    return;
  }

  const rows = getSortedResults();
  elements.summaryResultsTableWrap.innerHTML = `
    <table class="result-table">
      <thead>
        <tr>
          <th>이름</th>
          <th>총점</th>
          <th>코드</th>
          <th>출력</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr class="${row.오류 ? "is-error" : ""}">
                <td><div class="student-name">${escapeHtml(row.이름)}</div></td>
                <td class="score-cell">${escapeHtml(formatNumber(row.total_score))}</td>
                <td>${escapeHtml(formatNumber(row.code_score))}</td>
                <td>${escapeHtml(formatNumber(row.output_score))}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderResultsTable() {
  if (!state.results.length) {
    elements.resultsTableWrap.innerHTML = '<div class="empty-table">채점 결과가 아직 없습니다.</div>';
    elements.resultCountChip.textContent = "0건";
    return;
  }

  const rows = getSortedResults();
  elements.resultCountChip.textContent = `${rows.length}건`;
  elements.resultsTableWrap.innerHTML = `
    <table class="result-table">
      <thead>
        <tr>
          <th>이름</th>
          <th>파일명</th>
          <th>총점</th>
          <th>코드</th>
          <th>출력</th>
          <th>감점 항목</th>
          <th>Trace</th>
          <th>비고</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const failedItems = getFailedItemLabels(row);
            const noteParts = [];
            if (row.selected_notebook) {
              noteParts.push(`선택 노트북: ${row.selected_notebook}`);
            }
            if (row.warning) {
              noteParts.push(`경고: ${row.warning}`);
            }
            if (row.오류) {
              noteParts.push(`오류: ${row.오류}`);
            }

            return `
              <tr class="${row.오류 ? "is-error" : ""}">
                <td>
                  <div class="student-name">${escapeHtml(row.이름)}</div>
                </td>
                <td>${escapeHtml(row.파일명)}</td>
                <td class="score-cell">${escapeHtml(formatNumber(row.total_score))}</td>
                <td>${escapeHtml(formatNumber(row.code_score))}</td>
                <td>${escapeHtml(formatNumber(row.output_score))}</td>
                <td>
                  <div class="tag-list">
                    ${
                      failedItems.length
                        ? failedItems
                            .map((item) => `<span class="tag">${escapeHtml(item)}</span>`)
                            .join("")
                        : '<span class="tag is-pass">감점 없음</span>'
                    }
                  </div>
                </td>
                <td>
                  <div class="trace-block">
                    <strong>Step 13</strong><br />
                    ${escapeHtml(row.step13_tools_called || "(없음)")}
                  </div>
                  <div class="trace-block">
                    <strong>Step 15</strong><br />
                    ${escapeHtml(row.step15_tools_called || "(없음)")}
                  </div>
                </td>
                <td>${escapeHtml(noteParts.join("\n")) || "-"}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderItemStatsTable() {
  if (!state.analysis) {
    elements.itemStatsTableWrap.innerHTML = '<div class="empty-table">감점 통계가 아직 없습니다.</div>';
    return;
  }

  elements.itemStatsTableWrap.innerHTML = `
    <table class="result-table">
      <thead>
        <tr>
          <th>구분</th>
          <th>항목</th>
          <th>배점</th>
          <th>감점자수</th>
          <th>감점비율</th>
          <th>누적감점</th>
        </tr>
      </thead>
      <tbody>
        ${state.analysis.itemStats
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.구분)}</td>
                <td>${escapeHtml(row.항목)}</td>
                <td>${escapeHtml(formatNumber(row.배점))}</td>
                <td>${escapeHtml(String(row.감점자수))}</td>
                <td>${escapeHtml(`${numberFormatter.format(row["감점비율(%)"])}%`)}</td>
                <td>${escapeHtml(formatNumber(row.누적감점))}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAll() {
  renderSummary();
  renderSummaryResultsTable();
  renderResultsTable();
  renderItemStatsTable();
  elements.downloadResults.disabled = !state.results.length;
  elements.downloadReport.disabled = !state.results.length;
}

function resetState() {
  state.file = null;
  state.results = [];
  state.analysis = null;
  state.markdownReport = "";
  elements.zipInput.value = "";
  elements.selectedFileName.textContent = "아직 선택된 파일이 없습니다.";
  setStatus("ZIP 파일을 선택하면 여기에서 진행 상태를 표시합니다.");
  setBusy(false);
  renderAll();
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function toContainerEntry(record, segments) {
  return {
    record,
    segments,
    basename: segments[segments.length - 1] ?? "",
  };
}

function prepareContainers(archiveRecords, uploadedName) {
  const rawEntries = archiveRecords
    .filter((record) => record.path && !isSystemPath(record.path))
    .map((record) => ({
      path: record.path,
      segments: record.path.split("/").filter(Boolean),
      record,
    }));

  if (!rawEntries.length) {
    return [];
  }

  const prefixLength = commonPrefixLength(rawEntries.map((item) => item.segments));
  const normalizedEntries = rawEntries
    .map((item) => {
      let segments = item.segments.slice(prefixLength);
      while (segments.length > 1 && COLLECTION_FOLDERS.has(String(segments[0] ?? "").toLowerCase())) {
        segments = segments.slice(1);
      }
      return toContainerEntry(item.record, segments);
    })
    .filter((item) => item.segments.length > 0);

  const allRootPlainFiles =
    normalizedEntries.length > 0 &&
    normalizedEntries.every((item) => item.segments.length === 1 && !isZipFile(item.basename));

  if (allRootPlainFiles) {
    return [
      {
        key: `rootfiles:${uploadedName}`,
        label: stripExtension(uploadedName),
        items: normalizedEntries.map((item) => ({
          ...item,
          encrypted: item.record.encrypted,
          relativePath: item.basename,
        })),
      },
    ];
  }

  const containers = new Map();
  for (const item of normalizedEntries) {
    let key;
    let label;
    let relativeSegments;

    if (item.segments.length === 1) {
      if (isZipFile(item.basename)) {
        key = `rootzip:${item.basename}`;
        label = stripExtension(item.basename);
        relativeSegments = [item.basename];
      } else {
        key = `rootfiles:${uploadedName}`;
        label = stripExtension(uploadedName);
        relativeSegments = [item.basename];
      }
    } else {
      key = `folder:${item.segments[0]}`;
      label = item.segments[0];
      relativeSegments = item.segments.slice(1);
    }

    if (!containers.has(key)) {
      containers.set(key, { key, label, items: [] });
    }

    containers.get(key).items.push({
      ...item,
      encrypted: item.record.encrypted,
      relativePath: normalizePath(relativeSegments.join("/")) || item.basename,
    });
  }

  return [...containers.values()].sort((left, right) => collator.compare(left.label, right.label));
}

async function selectNotebookRecord(records) {
  const notebookRecords = records.filter((record) => isNotebookFile(record.path));
  if (!notebookRecords.length) {
    return { error: ".ipynb 파일 없음" };
  }

  const parsedCandidates = [];
  const readErrors = [];

  for (const record of notebookRecords) {
    let text;
    try {
      text = await record.readText();
    } catch (error) {
      readErrors.push(`노트북 읽기 실패: ${record.path}: ${formatArchiveError(error, "노트북 읽기 실패")}`);
      continue;
    }

    try {
      parsedCandidates.push({
        path: record.path,
        notebook: JSON.parse(text),
        size: text.length,
      });
    } catch (error) {
      readErrors.push(`노트북 파싱 실패: ${record.path}: ${getErrorMessage(error)}`);
    }
  }

  if (!parsedCandidates.length) {
    return { error: readErrors[0] ?? "노트북 파싱 실패: 알 수 없는 오류" };
  }

  parsedCandidates.sort((left, right) => {
    if (right.size !== left.size) {
      return right.size - left.size;
    }
    return collator.compare(left.path, right.path);
  });

  const selected = parsedCandidates[0];
  const warnings = [];
  if (parsedCandidates.length > 1) {
    warnings.push(`.ipynb ${parsedCandidates.length}개 발견, 가장 큰 파일 사용: ${selected.path}`);
  }

  return {
    notebook: selected.notebook,
    selectedNotebook: selected.path,
    warnings,
  };
}

async function openNestedZipFromRecord(record, password) {
  const buffer = await record.readArrayBuffer();
  const blob = new Blob([buffer], { type: "application/zip" });
  return openZipArchiveFromBlob(blob, password);
}

async function processContainer(container, password) {
  const studentName = deriveStudentName(container.label);
  const nestedZipRecords = container.items
    .filter((item) => isZipFile(item.basename))
    .sort((left, right) => collator.compare(left.relativePath, right.relativePath));

  const warnings = [];

  if (nestedZipRecords.length) {
    const selectedZip = nestedZipRecords[0];
    if (nestedZipRecords.length > 1) {
      warnings.push(`ZIP ${nestedZipRecords.length}개 발견, ${selectedZip.basename} 사용`);
    }
    if (selectedZip.encrypted && password) {
      warnings.push("암호화 ZIP을 공통 비밀번호로 해제");
    }

    let nestedArchive;
    try {
      nestedArchive = await openNestedZipFromRecord(selectedZip.record, password);
      const notebookSelection = await selectNotebookRecord(
        nestedArchive.records
          .filter((record) => record.path && !isSystemPath(record.path))
          .map((record) => ({
            path: record.path,
            readText: () => record.readText(),
          })),
      );

      if (notebookSelection.error) {
        return createBlankResult(studentName, selectedZip.basename, notebookSelection.error);
      }

      warnings.push(...notebookSelection.warnings);
      return buildGradingRow({
        studentName,
        fileName: selectedZip.basename,
        notebook: notebookSelection.notebook,
        selectedNotebook: notebookSelection.selectedNotebook,
        warning: warnings.join(" | "),
      });
    } catch (error) {
      return createBlankResult(studentName, selectedZip.basename, formatArchiveError(error));
    } finally {
      if (nestedArchive) {
        await nestedArchive.close();
      }
    }
  }

  if (container.items.some((item) => item.encrypted) && password) {
    warnings.push("암호화된 노트북 파일을 공통 비밀번호로 해제");
  }

  const directNotebookSelection = await selectNotebookRecord(
    container.items.map((item) => ({
      path: item.relativePath,
      readText: () => item.record.readText(),
    })),
  );

  if (directNotebookSelection.error) {
    return createBlankResult(
      studentName,
      container.label,
      directNotebookSelection.error === ".ipynb 파일 없음"
        ? "zip 파일 없음"
        : directNotebookSelection.error,
    );
  }

  warnings.push("학생 폴더 내부 ZIP이 없어 직접 포함된 .ipynb를 사용");
  warnings.push(...directNotebookSelection.warnings);
  return buildGradingRow({
    studentName,
    fileName: basename(directNotebookSelection.selectedNotebook),
    notebook: directNotebookSelection.notebook,
    selectedNotebook: directNotebookSelection.selectedNotebook,
    warning: warnings.join(" | "),
  });
}

async function gradeUploadedZip(file, password) {
  const topArchive = await openZipArchiveFromBlob(file, password);

  try {
    const containers = prepareContainers(topArchive.records, file.name);
    if (!containers.length) {
      throw new Error("업로드한 ZIP 안에서 채점 가능한 파일을 찾지 못했습니다.");
    }

    const results = [];
    for (const [index, container] of containers.entries()) {
      setStatus(`진행 중: ${index + 1}/${containers.length} - ${container.label}`);
      const result = await processContainer(container, password);
      results.push(result);
      await nextFrame();
    }
    return results;
  } finally {
    await topArchive.close();
  }
}

async function handleGrade() {
  if (!state.file) {
    return;
  }

  const password = getArchivePassword();
  setBusy(true);
  setStatus(`진행 중: ${state.file.name} 분석 준비`);

  try {
    const results = await gradeUploadedZip(state.file, password);
    state.results = results;
    state.analysis = analyzeResults(results);
    state.markdownReport = buildMarkdownReport(results, state.analysis, {
      inputName: state.file.name,
      generatedAt: new Date(),
    });
    renderAll();
    setStatus(`완료: ${results.length}건 채점 및 리포트 생성${password ? " (비밀번호 사용)" : ""}`);
  } catch (error) {
    setStatus(`오류: ${formatArchiveError(error, "채점 실패")}`);
  } finally {
    setBusy(false);
  }
}

function handleFileSelection(file) {
  if (file && !isZipFile(file.name)) {
    state.file = null;
    elements.selectedFileName.textContent = "아직 선택된 파일이 없습니다.";
    state.results = [];
    state.analysis = null;
    state.markdownReport = "";
    renderAll();
    setStatus("오류: ZIP 파일만 업로드할 수 있습니다.");
    setBusy(false);
    return;
  }

  state.file = file;
  elements.selectedFileName.textContent = file
    ? `${file.name} (${numberFormatter.format(file.size / 1024)} KB)`
    : "아직 선택된 파일이 없습니다.";
  state.results = [];
  state.analysis = null;
  state.markdownReport = "";
  renderAll();
  setStatus(
    file
      ? "ZIP 파일이 준비되었습니다. 암호화된 ZIP이면 비밀번호를 입력한 뒤 채점 시작을 누르세요."
      : "ZIP 파일을 선택해주세요.",
  );
  setBusy(false);
  elements.resetButton.disabled = !file;
}

function bindDropzone() {
  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.dataset.dragging = "true";
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.dataset.dragging = "false";
    });
  });

  elements.dropzone.addEventListener("drop", (event) => {
    const [file] = [...(event.dataTransfer?.files ?? [])];
    if (!file) {
      return;
    }
    handleFileSelection(file);
  });
}

elements.zipInput.addEventListener("change", (event) => {
  const [file] = [...(event.target.files ?? [])];
  handleFileSelection(file ?? null);
});

elements.zipPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !elements.gradeButton.disabled) {
    handleGrade();
  }
});

elements.gradeButton.addEventListener("click", handleGrade);
elements.resetButton.addEventListener("click", resetState);
elements.downloadResults.addEventListener("click", () => {
  if (!state.results.length) {
    return;
  }
  downloadText("grading_results.csv", buildResultsCsv(state.results), "text/csv;charset=utf-8");
});
elements.downloadReport.addEventListener("click", () => {
  if (!state.markdownReport) {
    return;
  }
  downloadText("grading_report.md", state.markdownReport, "text/markdown;charset=utf-8");
});

bindDropzone();
resetState();
