# Contributing to pr-risk-scanner

Thanks for considering a contribution. `pr-risk-scanner` stays intentionally fast, deterministic, and 100% offline.

## Core Design Constraints

Before opening a pull request, keep these non-negotiable constraints in mind:

1. **No network calls or LLM APIs:** All analysis must run locally using deterministic static analysis.
2. **Read-only scanning:** The scanner must never modify files or git state in the target repository.
3. **Explainable heuristics:** Every finding must include a `ruleId`, `evidence`, and location (`file:line` when applicable). Do not label heuristics as confirmed security vulnerabilities.
4. **Backward compatibility:** Preserve existing CLI flags and `pr-risk.config.json` fields.

## Local Setup

```bash
git clone https://github.com/AYUSH-PANDEY023/pr-risk-scanner.git
cd pr-risk-scanner
npm install
npm run typecheck
npm test
npm run build
```

## Pull Request Checklist

- Add unit or integration tests in `tests/` for every new rule, flag, or bug fix.
- Update `README.md` and `pr-risk.schema.json` when adding configuration fields.
- Keep commits focused and run `npm run typecheck && npm test && npm run build` before pushing.
