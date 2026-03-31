/**
 * Formatter — colored CLI output and JSON output
 */

import { AnalysisResult } from './analyzer';
import { ScoreResult } from './scorer';
import { Finding, Severity } from './rules';

// ---------------------------------------------------------------------------
// ANSI colors (zero deps)
// ---------------------------------------------------------------------------
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';
const BG_BLUE = '\x1b[44m';

function severityColor(s: Severity): string {
  switch (s) {
    case 'critical': return RED;
    case 'recommended': return YELLOW;
    case 'optional': return CYAN;
  }
}

function severityIcon(s: Severity): string {
  switch (s) {
    case 'critical': return `${RED}[CRITICAL]${RESET}`;
    case 'recommended': return `${YELLOW}[RECOMMENDED]${RESET}`;
    case 'optional': return `${CYAN}[OPTIONAL]${RESET}`;
  }
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return GREEN;
    case 'B': return GREEN;
    case 'C': return YELLOW;
    case 'D': return YELLOW;
    default: return RED;
  }
}

function bar(score: number): string {
  const width = 30;
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color = score >= 80 ? GREEN : score >= 50 ? YELLOW : RED;
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------
export function formatJSON(
  analysis: AnalysisResult,
  scoreResult: ScoreResult,
  filePath: string
): string {
  return JSON.stringify({
    file: filePath,
    score: scoreResult.score,
    grade: scoreResult.grade,
    estimatedSavingsMB: scoreResult.estimatedSavingsMB,
    findings: analysis.findings,
    passedRules: analysis.passed,
    totalRules: analysis.totalRules,
  }, null, 2);
}

// ---------------------------------------------------------------------------
// CLI colored output
// ---------------------------------------------------------------------------
export function formatCLI(
  analysis: AnalysisResult,
  scoreResult: ScoreResult,
  filePath: string,
  optimizedDockerfile: string | null
): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(`${BOLD}${BLUE}  DOCKER-SLIM${RESET}  ${DIM}Dockerfile Analyzer${RESET}`);
  lines.push(`${DIM}  ${'─'.repeat(50)}${RESET}`);
  lines.push(`  ${DIM}File:${RESET} ${filePath}`);
  lines.push('');

  // Score
  lines.push(`  ${BOLD}Score:${RESET} ${bar(scoreResult.score)} ${BOLD}${gradeColor(scoreResult.grade)}${scoreResult.score}/100 (${scoreResult.grade})${RESET}`);
  if (scoreResult.estimatedSavingsMB > 0) {
    lines.push(`  ${DIM}Estimated potential savings:${RESET} ${BOLD}~${scoreResult.estimatedSavingsMB} MB${RESET}`);
  }
  lines.push('');

  // Findings
  if (analysis.findings.length > 0) {
    lines.push(`  ${BOLD}${RED}Issues Found (${analysis.findings.length})${RESET}`);
    lines.push(`  ${DIM}${'─'.repeat(50)}${RESET}`);

    // Sort: critical first, then recommended, then optional
    const sorted = [...analysis.findings].sort((a, b) => {
      const order: Record<Severity, number> = { critical: 0, recommended: 1, optional: 2 };
      return order[a.severity] - order[b.severity];
    });

    for (const f of sorted) {
      const lineRef = f.line ? ` ${DIM}(line ${f.line})${RESET}` : '';
      lines.push(`  ${severityIcon(f.severity)} ${f.message}${lineRef}`);
      lines.push(`    ${DIM}→${RESET} ${f.suggestion}`);
      if (f.estimatedSavingsMB) {
        lines.push(`    ${DIM}  (~${f.estimatedSavingsMB} MB savings)${RESET}`);
      }
      lines.push('');
    }
  }

  // Passed rules
  if (analysis.passed.length > 0) {
    lines.push(`  ${BOLD}${GREEN}Passed Checks (${analysis.passed.length})${RESET}`);
    lines.push(`  ${DIM}${'─'.repeat(50)}${RESET}`);
    for (const p of analysis.passed) {
      lines.push(`  ${GREEN}✓${RESET} ${p}`);
    }
    lines.push('');
  }

  // Optimized Dockerfile
  if (optimizedDockerfile && analysis.findings.length > 0) {
    lines.push(`  ${BOLD}${CYAN}Optimized Dockerfile Suggestion${RESET}`);
    lines.push(`  ${DIM}${'─'.repeat(50)}${RESET}`);
    for (const l of optimizedDockerfile.split('\n')) {
      lines.push(`  ${DIM}│${RESET} ${l}`);
    }
    lines.push('');
  }

  // Summary
  lines.push(`  ${DIM}${'─'.repeat(50)}${RESET}`);
  lines.push(`  ${analysis.totalRules} rules checked | ${GREEN}${analysis.passed.length} passed${RESET} | ${RED}${analysis.findings.length} issues${RESET}`);
  lines.push('');

  return lines.join('\n');
}
