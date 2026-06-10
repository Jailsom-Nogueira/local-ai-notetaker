---
description: Multi-phase planning for non-trivial features. Use when asked to "plan this", "break this down", or anything that touches 3+ files / a new API route / a change to the recording or transcription flow.
---

# Skill: planning

Use this skill when the task is non-trivial — a new feature, a refactor with side effects, or anything that crosses browser UI ↔ Node route handlers ↔ local binaries (ffmpeg/whisper-cli). **Don't use it** for one-line fixes or pure copy edits.

**Activation:** "Follow the planning skill for X" or invoke this when you sense the task is bigger than one file.

This is a **planning skill**. It produces a plan. It does NOT commit, push, or run the optional OpenAI review.

## Phase 1 — Read before thinking

Always do this first, in order:

1. **`AGENTS.md`** (root) — this project's rule book and non-negotiable invariants. Skim every header, especially the local-first and security sections.
2. **The actual files** the task touches. Don't infer from names; open them.
3. **What depends on those files.** Search `src/`. If you change a server helper in `src/lib/server.ts`, which route handlers import it? If you change recording state in `src/app/page.tsx`, what UI depends on it?

Most plans go wrong because the planner skipped step 3.

## Phase 2 — Impact analysis

Write this out **before** sketching tasks:

```markdown
### Upstream (what we depend on)
- Server helpers / config we read (src/lib/server.ts): ...
- Local binaries / model paths involved (ffmpeg, whisper-cli, model): ...
- Browser APIs already in use (MediaRecorder, WebAudio): ...

### Downstream (what depends on what we'll change)
- Route handlers or components importing the symbols we'll modify: ...
- Client/server boundary risks (does a client component now pull server-only code?): ...

### Privacy & security consequences
- Does this touch audio, transcripts, or review JSON leaving the host? (Default answer must be NO.)
- New filesystem-facing ids to validate against the recording-id pattern?
- New uploads to validate (source, language, presence, size, format)?

### UX consequences
- New user-visible surfaces: ...
- Loading / empty / error states needed: ...
- Desktop + tablet + mobile: anything tricky?
```

If you can't fill any of these in, you don't know enough yet — go back to Phase 1.

## Phase 3 — Task breakdown

Group tasks by layer, in dependency order:

```markdown
### Plan: <feature name>

#### 1. Server / route handlers
- [ ] Changes to src/app/api/.../route.ts (Node runtime required for fs/binaries)
- [ ] Validation: recording-id pattern, upload checks, error messages that leak nothing
- [ ] src/lib/server.ts helper changes

#### 2. UI (src/app/page.tsx and siblings)
- [ ] Component changes (existing) — link to affected file(s)
- [ ] New components — sketch shape (props, states)
- [ ] Recording-state transitions kept simple and visible
- [ ] PT/ES UI labels if user-facing copy is added

#### 3. Verification
- [ ] `npm run check` passes (publication + fonts + tests + typecheck + lint + build)
- [ ] If deps changed: `npm audit --audit-level=moderate`
- [ ] Manual flow: <click path>, with fake or real microphone media

#### 4. Docs
- [ ] AGENTS.md / docs update if a new convention or env var emerges
- [ ] Keep guardrail files in sync if invariants change
```

## Phase 4 — Show the plan, wait

Present the plan in chat. Stop. Do not start coding. Iteration on a plan is 10× cheaper than iteration on code.

## What not to do in a plan

- ❌ Don't list "create file X" with no rationale. Say *why* — what consumes it, what state it owns.
- ❌ Don't propose cloud sync, hosted storage, analytics, auth, or a database — these are forbidden by AGENTS.md unless the user explicitly asks.
- ❌ Don't propose new dependencies casually. List trade-offs and ask.
- ❌ Don't include "audit AGENTS.md" as a step. Just follow it.
- ❌ Don't include 30-item task graphs. If it's that big, break it into multiple sequential plans.

## When to skip the skill

If the user says "just do it" or the task is one file, skip to implementation. Use judgment.
