# pr-risk-scanner

Offline Node.js CLI that scores pull request risk (`0–100`) from local git diffs, AST function sizing, and copy-paste detection. Zero external API calls, zero API keys.

## What It Checks

| Signal | Max Points | Method |
| --- | ---: | --- |
| Files changed | 15 | `simple-git` branch diff vs base (`main`) |
| Lines changed | 20 | Insertions + deletions (excluding lockfiles/build output) |
| Missing test updates | 15 | Flags production code diffs with zero test file changes |
| Critical path touches | 25 | Segment-aware matching for `/auth`, `/payments`, `/migrations` |
| Duplicate code | 10 | `jscpd` (`v4`) clone detection scoped to changed files |
| Large functions | 15 | `ts-morph` AST scan across changed JS/TS files |

## Setup

```bash
npm install
npm run build
npm test
```

Link globally if you want to run `pr-risk-scanner` inside any local repository:

```bash
npm link
```

## Usage

Run from inside any git repository on a feature branch:

```bash
pr-risk-scanner
```

Common flags:

```bash
# Compare against a different base branch
pr-risk-scanner --base develop

# Scan staged changes before committing
pr-risk-scanner --staged

# Fail CI if risk score >= 65
pr-risk-scanner --ci --threshold 65

# Emit machine-readable JSON
pr-risk-scanner --json

# Use a custom local config file
pr-risk-scanner --config ./pr-risk.config.json
```

## Configuration

Drop a `pr-risk.config.json` (or `.pr-riskrc.json`) at your repo root. See `pr-risk.config.example.json` for all fields:

```json
{
  "baseBranch": "main",
  "failThreshold": 70,
  "criticalPaths": ["/auth", "/payments", "/migrations"],
  "maxFunctionLines": 50,
  "duplicateMinLines": 6,
  "duplicateMinTokens": 50
}
```
