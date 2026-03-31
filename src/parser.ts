/**
 * Dockerfile Parser — zero dependencies
 * Parses a Dockerfile into structured instructions.
 */

export interface DockerInstruction {
  line: number;
  instruction: string;
  arguments: string;
  raw: string;
}

export interface DockerStage {
  name: string | null;
  baseImage: string;
  instructions: DockerInstruction[];
  fromLine: number;
}

export interface ParsedDockerfile {
  stages: DockerStage[];
  allInstructions: DockerInstruction[];
  raw: string;
}

export function parseDockerfile(content: string): ParsedDockerfile {
  const lines = content.split('\n');
  const allInstructions: DockerInstruction[] = [];
  const stages: DockerStage[] = [];
  let currentStage: DockerStage | null = null;

  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    const lineNum = i + 1;

    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    // Handle line continuations
    while (line.trimEnd().endsWith('\\') && i + 1 < lines.length) {
      i++;
      line = line.trimEnd().slice(0, -1) + ' ' + lines[i].trim();
    }

    const trimmed = line.trim();
    const match = trimmed.match(/^(\S+)\s*(.*)/s);
    if (!match) {
      i++;
      continue;
    }

    const instruction = match[1].toUpperCase();
    const args = match[2] || '';

    const parsed: DockerInstruction = {
      line: lineNum,
      instruction,
      arguments: args,
      raw: trimmed,
    };

    allInstructions.push(parsed);

    if (instruction === 'FROM') {
      const fromMatch = args.match(/^(\S+)(?:\s+[Aa][Ss]\s+(\S+))?/);
      currentStage = {
        name: fromMatch?.[2] || null,
        baseImage: fromMatch?.[1] || args,
        instructions: [parsed],
        fromLine: lineNum,
      };
      stages.push(currentStage);
    } else if (currentStage) {
      currentStage.instructions.push(parsed);
    }

    i++;
  }

  return { stages, allInstructions, raw: content };
}
