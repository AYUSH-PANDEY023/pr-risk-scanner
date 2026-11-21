# pr-risk-scanner

[![CI](https://github.com/AYUSH-PANDEY023/pr-risk-scanner/actions/workflows/ci.yml/badge.svg)](https://github.com/AYUSH-PANDEY023/pr-risk-scanner/actions/workflows/ci.yml)

Local-first Node.js CLI that scores pull request risk (`0–100`) using git diff analysis, TypeScript/JavaScript AST inspection (`ts-morph`), and copy-paste detection (`jscpd`). Runs 100% offline with zero external APIs, zero LLM dependencies, and zero network calls.

<p><img src="./assets/demo.png" alt="pr-risk-scanner terminal output" width="100%" /></p>

## Problem Statement

Large pull requests—especially refactors or AI-assisted diffs—bury high-risk changes inside hundreds of lines of noise. Reviewers waste time figuring out where to focus, while cloud PR bots demand repo tokens, external APIs, or paid LLM keys.

`pr-risk-scanner` gives teams a fast, deterministic, explainable triage report locally or in CI before a human opens the first file.

## Features

- **100% offline & deterministic:** Identical diffs always produce identical scores with zero network traffic.
- **Diff-hunk aware AST analysis:** Parses only changed JS/TS files and flags oversized functions, high cyclomatic complexity, deep nesting, oversized classes, empty `catch {}` blocks, unhandled `.then()` chains, and dangerous dynamic execution patterns touched in the diff.
- **Sensitive path & config awareness:** Segment-aware matching for `/auth`, `/payments`, `/migrations` (avoiding false positives like `/author`), plus tracking for `package.json`, lockfiles, `.env*`, `tsconfig.json`, and `.github/workflows/*`.
- **Testing signals:** Flags production code diffs missing test updates as well as deleted test files.
- **Scoped duplication checks:** Uses `jscpd` (`v4`) and reports only clones involving files modified in the current PR.
- **Transparent false-positive control:** Supports `ignoreFiles`, `disabledRules`, `suppressions`, and inline `// pr-risk-ignore <rule> -- <reason>` comments—and always surfaces suppressed findings in reports.
- **CI & GitHub ready:** Supports colored terminal tables, `--markdown`, `--json`, `--sarif` (v2.1.0), `--github-summary`, `--ci` exit codes, and a reusable read-only `action.yml`.

## Installation

> Note: `pr-risk-scanner` is currently installed directly from GitHub.

### Direct from GitHub

```bash
npm install -g github:AYUSH-PANDEY023/pr-risk-scanner
```

### Local Clone

```bash
git clone https://github.com/AYUSH-PANDEY023/pr-risk-scanner.git
cd pr-risk-scanner
npm install
npm run build
npm link
```

Requires Node.js `>=18`.

## Quick Start

Run from inside any git repository on a feature branch:

```bash
pr-risk-scanner
```

Generate a starter config file with JSON Schema autocomplete:

```bash
pr-risk-scanner --init
```

### CLI Options

| Flag | Description | Default |
| --- | --- | --- |
| `-b, --base <branch>` | Base branch or ref to diff against (falls back to `origin/<branch>`) | `main` |
| `-c, --config <path>` | Path to a custom JSON config file | `pr-risk.config.json` |
| `--staged` | Scan staged changes (`git diff --cached`) instead of branch diff | `false` |
| `--max-fn-lines <n>` | Line threshold for flagging large functions via `ts-morph` | `50` |
| `--threshold <n>` | Score (`0–100`) at or above which `--ci` exits with code `1` | `70` |
| `--ci` | CI mode: exit `1` when risk score meets or exceeds threshold | `false` |
| `--markdown` | Output GitHub-flavored Markdown report for PR comments | `false` |
| `--json` | Output machine-readable JSON report | `false` |
| `--sarif` | Output SARIF v2.1.0 report for GitHub Code Scanning | `false` |
| `--github-summary` | Append Markdown report to `$GITHUB_STEP_SUMMARY` | `false` |
| `--install-missing` | Auto-run `npm install` for imported packages missing from `package.json` (opt-in) | `false` |
| `--init` | Generate a starter `pr-risk.config.json` in the current directory | `false` |

### Exit Codes

- `0`: Scan succeeded (and score `< threshold` when `--ci` is enabled).
- `1`: `--ci` gate failed (`score >= threshold`).
- `2`: Runtime or configuration error (invalid git ref, malformed JSON config, invalid CLI flag).

## Example Outputs

### JSON Report (`--json`)

```json
{
  "toolVersion": "1.2.0",
  "branch": "feat/checkout-retry",
  "baseRef": "main",
  "score": 60,
  "level": "high",
  "signals": [
    { "key": "filesChanged", "label": "Files changed", "observed": "9 files", "points": 6, "maxPoints": 10, "severity": "medium" },
    { "key": "linesChanged", "label": "Lines changed", "observed": "1000 lines", "points": 15, "maxPoints": 15, "severity": "critical" }
  ],
  "topRisks": [
    {
      "ruleId": "large-function",
      "severity": "high",
      "category": "largeFunctions",
      "location": "src/panelHub.ts:7",
      "file": "src/panelHub.ts",
      "line": 7,
      "points": 2,
      "message": "registerHubRoutes is 156 lines long (limit 50)",
      "evidence": "AST span lines 7-162 (156 lines)"
    }
  ],
  "suppressed": [],
  "reviewFocus": [
    { "priority": "P1", "area": "Missing test coverage", "detail": "Request unit/integration tests covering failure branches." }
  ]
}
```

### Markdown Report (`--markdown`)

```markdown
## PR Risk Report — 60/100 (HIGH)

Branch: `feat/checkout-retry` → `main`

| Signal | Observed | Points | Status |
| --- | --- | ---: | --- |
| Files changed | 9 files | 6/10 | **MEDIUM** |
| Lines changed | 1000 lines | 15/15 | **CRITICAL** |
```

## Scoring Methodology

The score (`0–100`) is a **deterministic review-prioritization heuristic**—it does **not** represent a statistical probability of bugs.

Default weights sum to `100` across eight categories (all customizable in `pr-risk.config.json`):

| Category | Default Weight | What It Evaluates |
| --- | ---: | --- |
| Files changed | 10 | Non-ignored files in `base...HEAD` |
| Lines changed | 15 | Insertions + deletions (excluding lockfiles/build output) |
| Testing signals | 15 | Missing test updates on `>=15` lines of production code + deleted test files |
| Critical paths | 20 | Segment-aware matches for `/auth`, `/payments`, `/migrations` |
| Duplicate code | 8 | `jscpd` (`v4`) clones involving at least one changed file |
| Large functions | 12 | Diff-hunk-aware `ts-morph` functions/methods exceeding `maxFunctionLines` |
| Complexity & risky patterns | 12 | `high-complexity`, `deep-nesting`, `large-class`, `empty-catch`, `unhandled-promise`, `unsafe-eval`, `unsafe-function`, `unsafe-exec`, `dangerous-html` |
| Deps & config changes | 8 | `package.json`, lockfiles, `.github/workflows/*`, `.env*`, `tsconfig*.json`, Docker/build configs |

Default severity bands (configurable via `severityThresholds`): `0–29` **LOW**, `30–59` **MEDIUM**, `60–79` **HIGH**, `80–100` **CRITICAL**.

## Configuration Reference

Drop a `pr-risk.config.json` (or `.pr-riskrc.json`) at your repository root. Schema validation is provided via `pr-risk.schema.json`.

```json
{
  "$schema": "./pr-risk.schema.json",
  "baseBranch": "main",
  "failThreshold": 70,
  "severityThresholds": { "medium": 30, "high": 60, "critical": 80 },
  "criticalPaths": ["/auth", "/payments", "/migrations"],
  "maxFunctionLines": 50,
  "maxCyclomaticComplexity": 12,
  "maxNestingDepth": 4,
  "maxClassLines": 250,
  "maxClassMethods": 15,
  "disabledRules": [],
  "suppressions": [
    { "rule": "large-function", "file": "src/legacy/", "reason": "Scheduled for refactor" }
  ],
  "weights": {
    "filesChanged": 10,
    "linesChanged": 15,
    "missingTests": 15,
    "criticalPaths": 20,
    "duplicateCode": 8,
    "largeFunctions": 12,
    "riskyPatterns": 12,
    "dependencyAndConfig": 8
  }
}
```

### Inline Suppressions

Suppress a specific heuristic line with a documented reason:

```ts
// pr-risk-ignore unsafe-eval -- sandboxed math expression evaluator
const result = eval(compiledFormula);
```

Suppressed findings are never silently dropped; they are listed in the **Suppressed Findings** section of terminal, Markdown, and JSON reports.

## GitHub Actions Integration

### Reusable Action (Read-Only by Default)

```yaml
name: PR Risk Check
on: [pull_request]

permissions:
  contents: read

jobs:
  risk-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: AYUSH-PANDEY023/pr-risk-scanner@v1.2.0
        with:
          base: ${{ github.base_ref }}
          threshold: '75'
          ci: 'true'
          write-summary: 'true'
```

### Optional PR Comment & SARIF Upload

Keep write permissions isolated to the reporting step:

```yaml
- run: pr-risk-scanner --base ${{ github.base_ref }} --markdown > risk-report.md
- run: gh pr comment ${{ github.event.pull_request.number }} --body-file risk-report.md
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Benchmarks

Run the reproducible local benchmark script on your own machine after building:

```bash
npm run build
npm run benchmark
```

The script creates temporary synthetic git repositories of 20, 150, and 500 TypeScript files and measures end-to-end `scanRepo()` wall-clock time on your hardware.

## Architecture Overview

```text
src/
├── cli.ts                  # Commander CLI, exit codes, --init, --github-summary
├── index.ts                # Public scanRepo() orchestration API
├── config.ts               # Local JSON config loader + strict validator
├── git.ts                  # simple-git diff summary, name-status, and -U0 hunk parser
├── analyzers/
│   ├── diffMetrics.ts      # Churn, test delta, deleted tests, critical paths, config changes
│   ├── astAnalyzer.ts      # Hunk-aware ts-morph AST complexity, nesting, class & pattern checks
│   └── duplicateAnalyzer.ts# jscpd v4 clone detection scoped to changed PR files
├── suppression.ts          # Inline + config suppression engine with full audit trail
├── scoring.ts              # Deterministic 0-100 scoring, evidence & review focus generator
└── reporter.ts             # Colored ANSI table, GitHub Markdown, and SARIF v2.1.0 formatters
```

## Limitations & Security Model

- **Heuristic, not formal verification:** AST pattern rules are heuristic indicators for human reviewers, not confirmed vulnerabilities or a replacement for SAST/typechecking/tests.
- **Language scope:** Git diff size, critical paths, config changes, and `jscpd` work across languages; AST complexity and pattern checks apply to JS/TS files (`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`).
- **Shallow clones:** GitHub Actions should checkout with `fetch-depth: 0` (or fetch the base branch) so `base...HEAD` merge-base history is available.
- **Read-only & safe:** The scanner never executes code from the analyzed repository. See [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and our [issue templates](./.github/ISSUE_TEMPLATE).

## License

[MIT](./LICENSE)
