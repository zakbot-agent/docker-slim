/**
 * Rules engine — all Dockerfile optimization rules
 */

import { ParsedDockerfile, DockerInstruction } from './parser';

export type Severity = 'critical' | 'recommended' | 'optional';

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  suggestion: string;
  line?: number;
  estimatedSavingsMB?: number;
}

export interface RuleResult {
  findings: Finding[];
  passed: boolean;
}

type RuleFn = (parsed: ParsedDockerfile, dockerignoreExists: boolean) => RuleResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRunCommands(parsed: ParsedDockerfile): DockerInstruction[] {
  return parsed.allInstructions.filter(i => i.instruction === 'RUN');
}

function imageIsSlimOrAlpine(image: string): boolean {
  const lower = image.toLowerCase();
  return lower.includes('alpine') || lower.includes('slim') || lower.includes('distroless') || lower.includes('scratch');
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const ruleAlpineSlim: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  for (const stage of parsed.stages) {
    if (!imageIsSlimOrAlpine(stage.baseImage)) {
      findings.push({
        rule: 'base-image-slim',
        severity: 'critical',
        message: `Stage "${stage.name || stage.baseImage}" uses full image: ${stage.baseImage}`,
        suggestion: `Use an alpine or slim variant (e.g., ${stage.baseImage}-alpine or ${stage.baseImage}-slim)`,
        line: stage.fromLine,
        estimatedSavingsMB: 400,
      });
    }
  }
  return { findings, passed: findings.length === 0 };
};

const ruleMultiStage: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  if (parsed.stages.length < 2) {
    findings.push({
      rule: 'multi-stage',
      severity: 'critical',
      message: 'No multi-stage build detected',
      suggestion: 'Use multi-stage builds to separate build and runtime, reducing final image size significantly',
      estimatedSavingsMB: 500,
    });
  }
  return { findings, passed: findings.length === 0 };
};

const ruleCombineRun: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  for (const stage of parsed.stages) {
    const runs = stage.instructions.filter(i => i.instruction === 'RUN');
    // Find consecutive RUN instructions
    let consecutive = 0;
    for (let i = 0; i < stage.instructions.length; i++) {
      if (stage.instructions[i].instruction === 'RUN') {
        consecutive++;
        if (consecutive >= 3) {
          findings.push({
            rule: 'combine-run',
            severity: 'recommended',
            message: `Stage "${stage.name || stage.baseImage}" has ${runs.length} RUN instructions (${consecutive}+ consecutive)`,
            suggestion: 'Combine consecutive RUN commands with && to reduce layers',
            line: stage.instructions[i].line,
            estimatedSavingsMB: 10,
          });
          break;
        }
      } else {
        consecutive = 0;
      }
    }
  }
  return { findings, passed: findings.length === 0 };
};

const ruleAptCleanup: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  const runs = getRunCommands(parsed);
  for (const run of runs) {
    const args = run.arguments;
    if ((args.includes('apt-get install') || args.includes('apt install')) &&
        !args.includes('rm -rf /var/lib/apt/lists') && !args.includes('apt-get clean')) {
      findings.push({
        rule: 'apt-cleanup',
        severity: 'critical',
        message: 'apt-get install without cleanup',
        suggestion: 'Add "rm -rf /var/lib/apt/lists/*" at the end of the RUN command',
        line: run.line,
        estimatedSavingsMB: 100,
      });
    }
  }
  return { findings, passed: findings.length === 0 };
};

const ruleNoCacheFlag: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  const runs = getRunCommands(parsed);
  for (const run of runs) {
    const args = run.arguments;
    if (args.includes('apt-get install') && !args.includes('--no-install-recommends')) {
      findings.push({
        rule: 'no-install-recommends',
        severity: 'recommended',
        message: 'apt-get install without --no-install-recommends',
        suggestion: 'Use "apt-get install --no-install-recommends" to skip optional packages',
        line: run.line,
        estimatedSavingsMB: 50,
      });
    }
    if (args.includes('apk add') && !args.includes('--no-cache')) {
      findings.push({
        rule: 'apk-no-cache',
        severity: 'recommended',
        message: 'apk add without --no-cache flag',
        suggestion: 'Use "apk add --no-cache" to avoid caching the index',
        line: run.line,
        estimatedSavingsMB: 10,
      });
    }
  }
  return { findings, passed: findings.length === 0 };
};

const ruleDockerignore: RuleFn = (_parsed, dockerignoreExists) => {
  const findings: Finding[] = [];
  if (!dockerignoreExists) {
    findings.push({
      rule: 'dockerignore',
      severity: 'critical',
      message: 'No .dockerignore file found',
      suggestion: 'Create a .dockerignore to exclude node_modules, .git, dist, etc.',
      estimatedSavingsMB: 200,
    });
  }
  return { findings, passed: findings.length === 0 };
};

const ruleCopyVsAdd: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  const adds = parsed.allInstructions.filter(i => i.instruction === 'ADD');
  for (const add of adds) {
    // ADD is fine for tar extraction and URLs
    if (!add.arguments.includes('.tar') && !add.arguments.includes('http')) {
      findings.push({
        rule: 'copy-vs-add',
        severity: 'recommended',
        message: `Using ADD instead of COPY on line ${add.line}`,
        suggestion: 'Use COPY instead of ADD unless you need tar extraction or URL fetching',
        line: add.line,
      });
    }
  }
  return { findings, passed: findings.length === 0 };
};

const ruleNotRoot: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  // Check the last stage (runtime)
  const lastStage = parsed.stages[parsed.stages.length - 1];
  if (lastStage) {
    const hasUser = lastStage.instructions.some(i => i.instruction === 'USER');
    if (!hasUser) {
      findings.push({
        rule: 'non-root-user',
        severity: 'critical',
        message: 'Container runs as root (no USER instruction in final stage)',
        suggestion: 'Add a USER instruction to run as a non-root user for security',
      });
    }
  }
  return { findings, passed: findings.length === 0 };
};

const ruleLayerOrdering: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  for (const stage of parsed.stages) {
    const copies = stage.instructions.filter(i => i.instruction === 'COPY' && !i.arguments.includes('--from'));
    let foundFullCopy = false;
    let foundDepCopyAfter = false;
    for (const copy of copies) {
      const args = copy.arguments.toLowerCase();
      // "COPY . ." or "COPY ./ ./" is a full copy
      if (args.match(/^\.\s+\./) || args.match(/^\.\/\s+\.\//)) {
        foundFullCopy = true;
      }
      // package.json / lock files after full copy is wrong ordering
      if (foundFullCopy && (args.includes('package.json') || args.includes('lock'))) {
        foundDepCopyAfter = true;
      }
    }
    // Check if deps are copied before source
    if (!foundFullCopy && copies.length > 0) continue;
    if (foundDepCopyAfter) {
      findings.push({
        rule: 'layer-ordering',
        severity: 'recommended',
        message: `Stage "${stage.name || stage.baseImage}": dependency files copied after source`,
        suggestion: 'Copy package.json/lock files first, install deps, then copy source for better cache',
        estimatedSavingsMB: 0,
      });
    }
  }
  return { findings, passed: findings.length === 0 };
};

const ruleNpmCi: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  const runs = getRunCommands(parsed);
  for (const run of runs) {
    if (run.arguments.includes('npm install') && !run.arguments.includes('npm install -g') &&
        !run.arguments.includes('pnpm install')) {
      findings.push({
        rule: 'npm-ci',
        severity: 'recommended',
        message: 'Using "npm install" instead of "npm ci"',
        suggestion: 'Use "npm ci" for deterministic, faster installs in Docker builds',
        line: run.line,
      });
    }
  }
  return { findings, passed: findings.length === 0 };
};

const rulePruneDevDeps: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  // Only relevant if single stage or if final stage has npm install
  if (parsed.stages.length < 2) {
    const runs = getRunCommands(parsed);
    const hasNpmInstall = runs.some(r =>
      r.arguments.includes('npm install') || r.arguments.includes('npm ci') ||
      r.arguments.includes('yarn install') || r.arguments.includes('pnpm install')
    );
    const hasPrune = runs.some(r =>
      r.arguments.includes('npm prune --production') || r.arguments.includes('--omit=dev') ||
      r.arguments.includes('npm prune --omit=dev')
    );
    if (hasNpmInstall && !hasPrune) {
      findings.push({
        rule: 'prune-devdeps',
        severity: 'recommended',
        message: 'devDependencies not pruned in single-stage build',
        suggestion: 'Add "npm prune --omit=dev" or use multi-stage build to exclude devDependencies',
        estimatedSavingsMB: 100,
      });
    }
  }
  return { findings, passed: findings.length === 0 };
};

const ruleNodeModulesInCopy: RuleFn = (parsed) => {
  const findings: Finding[] = [];
  const copies = parsed.allInstructions.filter(i => i.instruction === 'COPY' && !i.arguments.includes('--from'));
  for (const copy of copies) {
    if (copy.arguments.includes('node_modules')) {
      findings.push({
        rule: 'node-modules-copy',
        severity: 'critical',
        message: 'Copying node_modules directly into the image',
        suggestion: 'Never copy node_modules. Install dependencies inside the container instead.',
        line: copy.line,
        estimatedSavingsMB: 200,
      });
    }
  }
  return { findings, passed: findings.length === 0 };
};

// ---------------------------------------------------------------------------
// Export all rules
// ---------------------------------------------------------------------------

export const ALL_RULES: { name: string; fn: RuleFn }[] = [
  { name: 'base-image-slim', fn: ruleAlpineSlim },
  { name: 'multi-stage', fn: ruleMultiStage },
  { name: 'combine-run', fn: ruleCombineRun },
  { name: 'apt-cleanup', fn: ruleAptCleanup },
  { name: 'no-cache-flag', fn: ruleNoCacheFlag },
  { name: 'dockerignore', fn: ruleDockerignore },
  { name: 'copy-vs-add', fn: ruleCopyVsAdd },
  { name: 'non-root-user', fn: ruleNotRoot },
  { name: 'layer-ordering', fn: ruleLayerOrdering },
  { name: 'npm-ci', fn: ruleNpmCi },
  { name: 'prune-devdeps', fn: rulePruneDevDeps },
  { name: 'node-modules-copy', fn: ruleNodeModulesInCopy },
];
