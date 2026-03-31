/**
 * Scorer — compute a 0-100 score and letter grade
 */

import { AnalysisResult } from './analyzer';
import { Severity } from './rules';

export interface ScoreResult {
  score: number;
  grade: string;
  estimatedSavingsMB: number;
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 15,
  recommended: 7,
  optional: 3,
};

export function computeScore(result: AnalysisResult): ScoreResult {
  let penalty = 0;
  let estimatedSavingsMB = 0;

  for (const f of result.findings) {
    penalty += SEVERITY_WEIGHT[f.severity];
    estimatedSavingsMB += f.estimatedSavingsMB ?? 0;
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));

  let grade: string;
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 65) grade = 'C';
  else if (score >= 50) grade = 'D';
  else grade = 'F';

  return { score, grade, estimatedSavingsMB };
}
