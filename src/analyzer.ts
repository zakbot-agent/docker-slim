/**
 * Analyzer — runs all rules against a parsed Dockerfile
 */

import { ParsedDockerfile } from './parser';
import { ALL_RULES, Finding } from './rules';

export interface AnalysisResult {
  findings: Finding[];
  passed: string[];
  totalRules: number;
}

export function analyze(parsed: ParsedDockerfile, dockerignoreExists: boolean): AnalysisResult {
  const findings: Finding[] = [];
  const passed: string[] = [];

  for (const rule of ALL_RULES) {
    const result = rule.fn(parsed, dockerignoreExists);
    if (result.passed) {
      passed.push(rule.name);
    }
    findings.push(...result.findings);
  }

  return {
    findings,
    passed,
    totalRules: ALL_RULES.length,
  };
}
