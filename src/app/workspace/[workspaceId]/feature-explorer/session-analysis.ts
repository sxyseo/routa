import type { Locale } from "@/i18n";

import type { AggregatedSelectionSession, FeatureDetail } from "./types";

export interface BuildSessionAnalysisPromptInput {
  locale: Locale;
  workspaceId: string;
  repoName?: string;
  repoPath?: string;
  branch?: string;
  featureDetail: FeatureDetail | null;
  selectedFilePaths: string[];
  sessions: AggregatedSelectionSession[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function uniquePreserveOrder(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function isNoiseChangedFileEntry(entry: string): boolean {
  const value = entry.trim();
  if (!value) return true;

  return value.startsWith("fatal:")
    || value.startsWith("index ")
    || value.startsWith("@@")
    || value.startsWith("---")
    || value.startsWith("+++")
    || value.includes("Operation not permitted")
    || value.includes("Permission denied")
    || value.includes("No such file or directory");
}

export function sanitizeChangedFiles(entries: string[]): string[] {
  return uniqueSorted(entries.filter((entry) => !isNoiseChangedFileEntry(entry)));
}

function formatOrderedList(items: string[], emptyFallback: string): string {
  if (items.length === 0) {
    return `- ${emptyFallback}`;
  }

  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function formatBulletList(items: string[], emptyFallback: string): string {
  if (items.length === 0) {
    return `- ${emptyFallback}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function buildSessionBlocks(locale: Locale, sessions: AggregatedSelectionSession[]): string {
  const noChangedFiles = locale === "zh" ? "未捕获到可信的 changed files" : "No trustworthy changed files captured";
  const noPrompts = locale === "zh" ? "没有额外提示词历史" : "No additional prompt history";
  const noTools = locale === "zh" ? "没有工具历史" : "No tool history";

  return sessions.map((session, index) => {
    const changedFiles = sanitizeChangedFiles(session.changedFiles);
    const promptHistory = uniquePreserveOrder(session.promptHistory);
    const toolNames = uniqueSorted(session.toolNames);
    const diagnostics = session.diagnostics;
    const readFiles = diagnostics?.readFiles ?? [];
    const repeatedReadFiles = diagnostics?.repeatedReadFiles ?? [];
    const repeatedCommands = diagnostics?.repeatedCommands ?? [];
    const failedTools = diagnostics?.failedTools ?? [];
    const toolCallBreakdown = diagnostics
      ? Object.entries(diagnostics.toolCallsByName)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([toolName, count]) => `${toolName}: ${count}`)
      : [];

    return [
      `## Session ${index + 1}`,
      `- Provider: ${session.provider}`,
      `- Session ID: ${session.sessionId}`,
      `- Updated At: ${session.updatedAt}`,
      session.resumeCommand ? `- Resume Command: ${session.resumeCommand}` : "",
      `- Prompt Snippet: ${session.promptSnippet || (locale === "zh" ? "无" : "None")}`,
      diagnostics ? `- Tool Calls: ${diagnostics.toolCallCount}` : "",
      diagnostics ? `- Failed Tool Calls: ${diagnostics.failedToolCallCount}` : "",
      locale === "zh" ? "### Prompt History" : "### Prompt History",
      formatOrderedList(promptHistory, noPrompts),
      locale === "zh" ? "### Tool Names" : "### Tool Names",
      formatBulletList(toolNames, noTools),
      locale === "zh" ? "### Tool Call Breakdown" : "### Tool Call Breakdown",
      formatBulletList(toolCallBreakdown, noTools),
      locale === "zh" ? "### Changed Files" : "### Changed Files",
      formatBulletList(changedFiles, noChangedFiles),
      locale === "zh" ? "### Read Files" : "### Read Files",
      formatBulletList(readFiles, locale === "zh" ? "没有可信的读取文件记录" : "No trustworthy read-file evidence"),
      locale === "zh" ? "### Repeated Reads" : "### Repeated Reads",
      formatBulletList(repeatedReadFiles, locale === "zh" ? "没有发现重复读取" : "No repeated reads detected"),
      locale === "zh" ? "### Repeated Commands" : "### Repeated Commands",
      formatBulletList(repeatedCommands, locale === "zh" ? "没有发现重复命令" : "No repeated commands detected"),
      locale === "zh" ? "### Failed Tools" : "### Failed Tools",
      formatBulletList(
        failedTools.map((failure) =>
          `${failure.toolName}${failure.command ? ` | ${failure.command}` : ""} | ${failure.message}`),
        locale === "zh" ? "没有发现失败工具调用" : "No failed tool calls detected",
      ),
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

export function buildSessionAnalysisPrompt({
  locale,
  workspaceId,
  repoName,
  repoPath,
  branch,
  featureDetail,
  selectedFilePaths,
  sessions,
}: BuildSessionAnalysisPromptInput): string {
  const files = uniqueSorted(selectedFilePaths);
  const featureName = featureDetail?.name ?? (locale === "zh" ? "未命名 Feature" : "Unnamed feature");
  const featureSummary = featureDetail?.summary?.trim()
    || (locale === "zh" ? "无摘要" : "No summary");
  const transcriptHint = sessions
    .map((session) => `~/.codex/sessions/**/${session.sessionId}*.jsonl`)
    .join("\n");

  if (locale === "zh") {
    return [
      "请对这些与文件相关的历史编码会话做一次只读复盘，目标是帮用户下次更快地把任务说清楚、减少来回探索。",
      "",
      "你的任务：",
      "1. 基于下面的会话证据，总结这些会话在这个文件/功能上的共同模式。",
      "2. 找出拖慢过程的输入问题，例如目标不清、缺上下文、范围太大、没有先给验收标准、没有先给入口文件等。",
      "3. 明确区分“证据支持”的判断和“你的推断”。每条结论尽量引用具体 session ID。",
      "4. 给出更好的用户输入建议，重点是下一次应该怎样一句话开场、怎样补上下文、怎样限定范围。",
      "5. 产出 2 到 4 个可直接复用的提示词模板，偏向这个文件/这个 feature 的真实场景。",
      "6. 如果现有摘要不够，你可以继续自行读取这些 session 对应的 transcript JSONL 做深挖。",
      "",
      "输出格式：",
      "## 结论",
      "## 反复出现的问题",
      "## 更快的输入方式",
      "## 可直接复用的提示词模板",
      "## 还缺什么上下文",
      "## 证据与推断边界",
      "",
      "上下文：",
      `- Workspace: ${workspaceId}`,
      `- Repository: ${repoName || "unknown"}`,
      `- Repo Path: ${repoPath || "unknown"}`,
      `- Branch: ${branch || "unknown"}`,
      `- Feature: ${featureName}`,
      `- Feature Summary: ${featureSummary}`,
      `- Selected Files: ${files.length}`,
      `- Selected Sessions: ${sessions.length}`,
      "",
      "### Selected Files",
      formatBulletList(files, "无"),
      "",
      "### Transcript Hints",
      formatBulletList(uniqueSorted(transcriptHint ? transcriptHint.split("\n") : []), "无"),
      "",
      "### Session Evidence",
      buildSessionBlocks(locale, sessions),
      "",
      "重点：不要给泛泛而谈的 prompt engineering 建议，要尽量贴合这里的文件、feature、会话历史和真实摩擦点。",
    ].join("\n");
  }

  return [
    "Run a read-only retrospective on these file-linked coding sessions. The goal is to help the user phrase future requests better and reduce iteration time.",
    "",
    "Your tasks:",
    "1. Summarize the recurring patterns across the sessions for this file or feature.",
    "2. Identify what slowed the work down: vague goals, missing context, unclear scope, missing acceptance criteria, missing entry files, or late constraint changes.",
    "3. Distinguish clearly between evidence-backed conclusions and your own inference. Cite concrete session IDs when possible.",
    "4. Recommend better user inputs for next time: how to open the request, what context to include up front, and how to constrain the scope.",
    "5. Produce 2 to 4 reusable prompt templates tailored to this file or feature, not generic prompt-engineering advice.",
    "6. If the summaries below are insufficient, you may inspect the matching transcript JSONL files directly.",
    "",
    "Output format:",
    "## Conclusion",
    "## Repeated Friction",
    "## Faster Input Strategy",
    "## Reusable Prompt Templates",
    "## Missing Context",
    "## Evidence vs Inference",
    "",
    "Context:",
    `- Workspace: ${workspaceId}`,
    `- Repository: ${repoName || "unknown"}`,
    `- Repo Path: ${repoPath || "unknown"}`,
    `- Branch: ${branch || "unknown"}`,
    `- Feature: ${featureName}`,
    `- Feature Summary: ${featureSummary}`,
    `- Selected Files: ${files.length}`,
    `- Selected Sessions: ${sessions.length}`,
    "",
    "### Selected Files",
    formatBulletList(files, "None"),
    "",
    "### Transcript Hints",
    formatBulletList(uniqueSorted(transcriptHint ? transcriptHint.split("\n") : []), "None"),
    "",
    "### Session Evidence",
    buildSessionBlocks(locale, sessions),
    "",
    "Important: avoid generic advice. Tie recommendations to the actual files, feature context, session evidence, and observed workflow friction.",
  ].join("\n");
}
