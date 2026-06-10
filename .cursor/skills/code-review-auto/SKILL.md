---
description: Iterative review-and-fix loop on a defined scope. Use when asked to "review and fix everything", "clean this up", or "make this green".
---

# Skill: code-review-auto

Iterative loop: review → apply focused fixes → re-review → repeat until clean (or max loops). Different from `design-review` (review-only, UX-focused) — this one **also fixes** what it finds.

**Activation:** "Run code-review-auto on this PR / file / diff"

## Constraints (read before acting)

- **Do not** commit, push, or amend unless explicitly asked.
- **Do not** rename symbols with naive find/replace — it breaks dynamic references and string literals. If a real rename is needed, ask first.
- **Stay in scope.** Don't drive-by-refactor unrelated files.
- Treat `AGENTS.md` invariants as your checklist (local-first, no secrets, validated ids/uploads, clean client/server boundaries, strict TS no `any`).

## Scope selection

Pick **one** scope at the start and stick to it:

- Specific file(s) provided
- Staged diff (`git diff --cached`)
- Unstaged diff (`git diff`)

If unspecified, ask which.

## The loop

```
MAX_LOOPS = 5

for i in 1..MAX_LOOPS:
  1. Run `npm run lint` and `npm run typecheck`
  2. Read the changed files; classify findings by severity
  3. Apply minimal fixes (one finding → one focused edit)
  4. Re-run lint + typecheck on touched files
  5. If new errors appeared OR findings remain → continue
     Else → exit
```

Stop early if zero actionable findings remain, or only architectural/ambiguous findings remain (those need a human call).

## Severity buckets

- **Critical**: type error, lint error, runtime crash, or a privacy/security breach — secret in client code, missing recording-id validation (path traversal), unvalidated upload before ffmpeg/whisper-cli, audio/transcript/review data leaving the host, server-only code imported into a client component.
- **High**: missing error handling, error messages that leak secrets/absolute paths/raw transcripts, `console.log` with sensitive data, transcript text not framed as untrusted in a prompt.
- **Medium**: missing loading/empty/error state, file growing too large (split constants/types/helpers), missing PT/ES label where user-facing copy exists.
- **Low / Style**: naming inconsistency, comment wording, import ordering.

Fix Critical and High in the same iteration. Medium and Low can be batched.

## Fix rules

- One finding → one minimal fix. Don't bundle.
- After substantive fixes, re-run typecheck/lint on the touched scope.
- If a fix needs a new file (e.g. extracting `types.ts`), add it to the next loop's review set.
- Don't fix lint warnings that pre-existed in untouched files. Stay in scope.

## Final report

```markdown
## Auto-Fix Review: <scope>

### Summary
- Loops executed: N
- Fixes applied: Y
- Skipped (need a human call): Z
- Status: CLEAN | PARTIALLY FIXED | NEEDS MANUAL REVIEW

### Skipped findings
- <File:Line> — <description> — <why I didn't auto-fix it>

### Verification
- npm run lint:      0 errors
- npm run typecheck: 0 errors
- (full `npm run check` / build skipped unless asked)
```

After the report, the user decides whether to commit + push.
