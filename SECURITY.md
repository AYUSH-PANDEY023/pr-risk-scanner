# Security Policy

## Security Model

`pr-risk-scanner` is designed for safe execution in local developer environments and CI pipelines:

- **No untrusted code execution:** The scanner parses TypeScript and JavaScript files statically via `ts-morph` and tokenizes files via `jscpd`. It never executes, imports, or evaluates code from the scanned repository.
- **Read-only operation:** The scanner only reads git diffs and source files (except when `--init` or `--github-summary` is explicitly requested).
- **Zero network access:** No telemetry, no external API calls, and no credentials are required.

## Reporting a Vulnerability

If you discover a security issue (for example, git argument injection or path traversal), please open a private security advisory on GitHub at:

https://github.com/AYUSH-PANDEY023/pr-risk-scanner/security/advisories/new
