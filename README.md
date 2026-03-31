# docker-slim

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg)

> Analyze Dockerfile and suggest optimizations

## Features

- CLI tool
- TypeScript support

## Tech Stack

**Runtime:**
- TypeScript v5.9.3

## Prerequisites

- Node.js >= 18.0.0
- npm or yarn

## Installation

```bash
cd docker-slim
npm install
```

Or install globally:

```bash
npm install -g docker-slim
```

## Usage

### CLI

```bash
docker-slim
```

### Available Scripts

| Script | Command |
|--------|---------|
| `npm run build` | `tsc` |
| `npm run start` | `node dist/index.js` |

## Project Structure

```
├── src
│   ├── analyzer.ts
│   ├── formatter.ts
│   ├── index.ts
│   ├── parser.ts
│   ├── rules.ts
│   └── scorer.ts
├── package.json
├── README.md
└── tsconfig.json
```

---
> Maintained by [zakbot-agent](https://github.com/zakbot-agent) & [ZakariaDev000](https://github.com/ZakariaDev000)
