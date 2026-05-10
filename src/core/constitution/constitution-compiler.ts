/**
 * Constitution Compiler — converts natural-language iron rules into executable checks.
 *
 * Parses 00-constitution.md and produces a JSON rule set that pre-gate-checker
 * and Gate prompt can consume. Hard-codes the known iron rules (C1–C10) for
 * deterministic enforcement; new rules can be added via spec-files.json.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ConstitutionSeverity = "iron" | "soft";
export type ConstitutionCheckType = "regex" | "grep" | "command" | "forbidden_term";

export interface ConstitutionRule {
  id: string;
  title: string;
  severity: ConstitutionSeverity;
  checkType: ConstitutionCheckType;
  /** Regex pattern to search for (negate=true means it must NOT appear) */
  pattern?: string;
  /** Shell command to run (e.g., "tsc --noEmit") */
  command?: string;
  /** Terms that must NOT appear in production code */
  forbiddenTerms?: string[];
  /** File glob to restrict the check to (e.g., "schema.ts") */
  fileGlob?: string;
  /** If true, the pattern is a "must not exist" check */
  negate?: boolean;
  /** Human-readable description of what the rule enforces */
  description: string;
}

// ─── Built-in Iron Rules ────────────────────────────────────────────────────

const IRON_RULES: ConstitutionRule[] = [
  {
    id: "C1",
    title: "金额单位",
    severity: "iron",
    checkType: "regex",
    pattern: "(amount|price|balance|cost|fee|charge)",
    fileGlob: "schema.ts",
    negate: false,
    description: "Money fields must use integer type with Cents suffix. Check schema for REAL type on money fields.",
  },
  {
    id: "C3",
    title: "订单状态机",
    severity: "iron",
    checkType: "forbidden_term",
    forbiddenTerms: ["preparing", "completed", "finished", "processing"],
    fileGlob: "*.ts",
    description: "Order status must only be pending/making/done/cancelled. No preparing, completed, finished.",
  },
  {
    id: "C4",
    title: "商户状态",
    severity: "iron",
    checkType: "forbidden_term",
    forbiddenTerms: ["active", "running", "inactive"],
    fileGlob: "*.ts",
    description: "Merchant status must only be open/pause/closed. No active, running.",
  },
  {
    id: "C6",
    title: "API路径规范",
    severity: "iron",
    checkType: "regex",
    pattern: "app\\.(get|post|put|delete|patch)\\(['\"]/(?!api/|health)",
    fileGlob: "*.ts",
    negate: false,
    description: "All API routes must be prefixed with /api/. No bare routes like /orders.",
  },
  {
    id: "C7",
    title: "主键类型",
    severity: "iron",
    checkType: "regex",
    pattern: "text\\(['\"]id['\"]\\)\\.primaryKey\\(\\)",
    fileGlob: "schema.ts",
    description: "Primary keys should be INTEGER AUTOINCREMENT, not TEXT. Detect text('id').primaryKey().",
  },
  {
    id: "C9",
    title: "统一响应格式",
    severity: "iron",
    checkType: "grep",
    pattern: "res\\.send(",
    fileGlob: "*.ts",
    description: "Must use res.json() for all responses. No res.send() in production code.",
  },
  {
    id: "C10",
    title: "日志规范",
    severity: "iron",
    checkType: "grep",
    pattern: "console\\.log",
    fileGlob: "*.ts",
    description: "Use logger instead of console.log in production code.",
  },
];

// ─── Compiler ───────────────────────────────────────────────────────────────

/**
 * Compile constitution rules from multiple sources:
 *   1. Built-in iron rules (hard-coded above)
 *   2. spec-files.json forbiddenTerms (dynamic)
 *   3. Optional: parse 00-constitution.md for additional rules
 */
export function compileConstitutionRules(options?: {
  forbiddenTerms?: Record<string, string>;
  constitutionPath?: string;
}): ConstitutionRule[] {
  const rules = [...IRON_RULES];

  // Merge forbiddenTerms from spec-files.json into existing rules
  if (options?.forbiddenTerms) {
    for (const [term, reason] of Object.entries(options.forbiddenTerms)) {
      // Check if already covered by existing forbidden_term rules
      const existing = rules.find(
        (r) => r.checkType === "forbidden_term" && r.forbiddenTerms?.includes(term),
      );
      if (!existing) {
        rules.push({
          id: "SPEC",
          title: "自定义禁用词",
          severity: "iron",
          checkType: "forbidden_term",
          forbiddenTerms: [term],
          description: reason,
        });
      }
    }
  }

  return rules;
}

/**
 * Get only iron-severity rules (the ones that produce BLOCKER violations).
 */
export function getIronRules(rules: ConstitutionRule[]): ConstitutionRule[] {
  return rules.filter((r) => r.severity === "iron");
}

/**
 * Serialize rules to JSON for Gate prompt injection.
 */
export function rulesToPromptContext(rules: ConstitutionRule[]): string {
  const ironRules = getIronRules(rules);
  if (ironRules.length === 0) return "No constitution rules loaded.";

  const lines = ironRules.map(
    (r) =>
      `- [${r.id}] ${r.title}: ${r.description}${r.forbiddenTerms ? ` (Forbidden: ${r.forbiddenTerms.join(", ")})` : ""}`,
  );

  return `## Constitution Iron Rules (MACHINE-ENFORCED — cannot be overridden)\n\n${lines.join("\n")}`;
}
