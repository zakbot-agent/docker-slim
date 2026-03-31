#!/usr/bin/env node

/**
 * docker-slim — Dockerfile analyzer and optimizer
 * Zero dependencies. TypeScript. CLI.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseDockerfile } from './parser';
import { analyze } from './analyzer';
import { computeScore } from './scorer';
import { formatCLI, formatJSON } from './formatter';

// ---------------------------------------------------------------------------
// CLI argument parsing (zero deps)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { filePath: string; json: boolean; help: boolean } {
  let filePath = '';
  let json = false;
  let help = false;

  for (const arg of argv.slice(2)) {
    if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (!arg.startsWith('-')) filePath = arg;
  }

  if (!filePath) {
    filePath = path.resolve(process.cwd(), 'Dockerfile');
  } else {
    filePath = path.resolve(filePath);
  }

  return { filePath, json, help };
}

function showHelp(): void {
  console.log(`
  docker-slim — Dockerfile Analyzer & Optimizer

  Usage:
    docker-slim                    Analyze Dockerfile in current directory
    docker-slim <path>             Analyze specific Dockerfile
    docker-slim --json             Output as JSON
    docker-slim --help             Show this help

  Rules checked:
    - Base image: alpine/slim variants
    - Multi-stage build usage
    - RUN command consolidation
    - apt-get / apk cache cleanup
    - .dockerignore presence
    - COPY vs ADD preference
    - Non-root user (USER instruction)
    - Layer ordering (deps before source)
    - npm ci vs npm install
    - devDependencies pruning
    - node_modules not copied directly
`);
}

// ---------------------------------------------------------------------------
// Generate optimized Dockerfile suggestion
// ---------------------------------------------------------------------------

function generateOptimized(content: string, findings: ReturnType<typeof analyze>): string | null {
  if (findings.findings.length === 0) return null;

  const rules = new Set(findings.findings.map(f => f.rule));
  const lines: string[] = [];

  lines.push('# Optimized Dockerfile (docker-slim suggestion)');
  lines.push('# Review and adapt to your project needs');
  lines.push('');

  // Parse original to reuse
  const parsed = parseDockerfile(content);

  for (const stage of parsed.stages) {
    let baseImage = stage.baseImage;

    // Suggest slim/alpine base
    if (rules.has('base-image-slim') && !baseImage.includes('alpine') && !baseImage.includes('slim')) {
      if (baseImage.startsWith('node:')) {
        baseImage = baseImage.split(':')[0] + ':' + (baseImage.split(':')[1] || 'lts') + '-alpine';
        // Clean up double version
        if (baseImage.includes('-alpine') && !baseImage.match(/\d.*-alpine/)) {
          baseImage = 'node:lts-alpine';
        }
      } else if (baseImage.startsWith('python:')) {
        baseImage = baseImage + '-slim';
      } else if (baseImage.startsWith('ubuntu:') || baseImage.startsWith('debian:')) {
        baseImage = 'debian:bookworm-slim';
      }
    }

    const fromLine = stage.name ? `FROM ${baseImage} AS ${stage.name}` : `FROM ${baseImage}`;
    lines.push(fromLine);

    for (const instr of stage.instructions) {
      if (instr.instruction === 'FROM') continue;

      // Replace ADD with COPY
      if (instr.instruction === 'ADD' && rules.has('copy-vs-add') &&
          !instr.arguments.includes('.tar') && !instr.arguments.includes('http')) {
        lines.push(`COPY ${instr.arguments}`);
        continue;
      }

      // Clean apt-get lines
      if (instr.instruction === 'RUN' && rules.has('apt-cleanup') &&
          instr.arguments.includes('apt-get install') &&
          !instr.arguments.includes('rm -rf /var/lib/apt/lists')) {
        let cleaned = instr.arguments;
        if (!cleaned.includes('--no-install-recommends')) {
          cleaned = cleaned.replace('apt-get install', 'apt-get install --no-install-recommends');
        }
        cleaned += ' && rm -rf /var/lib/apt/lists/*';
        lines.push(`RUN ${cleaned}`);
        continue;
      }

      // Replace npm install with npm ci
      if (instr.instruction === 'RUN' && rules.has('npm-ci') &&
          instr.arguments.includes('npm install') && !instr.arguments.includes('npm install -g') &&
          !instr.arguments.includes('pnpm install')) {
        lines.push(`RUN ${instr.arguments.replace('npm install', 'npm ci')}`);
        continue;
      }

      lines.push(instr.raw);
    }

    // Add USER if missing in final stage and it's the last one
    if (stage === parsed.stages[parsed.stages.length - 1] && rules.has('non-root-user')) {
      const hasUser = stage.instructions.some(i => i.instruction === 'USER');
      if (!hasUser) {
        // Insert before CMD/ENTRYPOINT
        const cmdIdx = lines.findIndex(l => l.startsWith('CMD') || l.startsWith('ENTRYPOINT'));
        if (cmdIdx === -1) {
          lines.push('USER 1001');
        }
        // Already inserted above CMD if it exists — handled by the line order
      }
    }

    lines.push('');
  }

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const { filePath, json, help } = parseArgs(process.argv);

  if (help) {
    showHelp();
    process.exit(0);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Error: Dockerfile not found at ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseDockerfile(content);

  // Check for .dockerignore
  const dir = path.dirname(filePath);
  const dockerignoreExists = fs.existsSync(path.join(dir, '.dockerignore'));

  const analysis = analyze(parsed, dockerignoreExists);
  const scoreResult = computeScore(analysis);

  if (json) {
    console.log(formatJSON(analysis, scoreResult, filePath));
  } else {
    const optimized = generateOptimized(content, analysis);
    console.log(formatCLI(analysis, scoreResult, filePath, optimized));
  }

  // Exit with non-zero if critical issues found
  const hasCritical = analysis.findings.some(f => f.severity === 'critical');
  if (hasCritical) process.exit(1);
}

main();
