---
description: UI/UX review of changes — accessibility, responsive layout, interaction patterns, loading/empty/error states. Review-only.
---

# Skill: design-review

Review the **UI/UX quality** of a set of changes. **Review-only** — don't auto-fix unless asked.

**Activation:** "Run design-review on these changes" / "Is this accessible?" / "Check this UI"

Different from `code-review-auto`:
- `code-review-auto` → fixes lint/type/standards/privacy drift across any file type
- `design-review` → human-judgment on UI quality; produces a verdict, not a patch

## Scope selection

- Files provided → review those
- Otherwise → review the current diff (ask: staged or unstaged?)

**Gate**: if there are no UI files (`.tsx`, `.css`) in scope, report `"No UI files in scope — skipping design review."` and stop.

## Review rubric

### 1. Accessibility & interaction

- **Keyboard**: Tab/Shift+Tab in logical order; Enter/Space activates; Escape closes overlays; no keyboard traps.
- **Focus**: overlays manage focus on open + restore on close; `:focus-visible` rings preserved (don't blanket `outline: none`).
- **Screen reader**: icon-only buttons (e.g. record/stop/delete) have `aria-label`; form fields have associated labels; headings descend logically.
- **Touch targets**: ≥ 44×44 px for primary controls (record, stop, source/language selectors).
- **Loading feedback**: every async action (record start/stop, transcribe, review, delete) shows a disabled/spinning state.

### 2. Responsive & layout

- No horizontal scroll at 320 / 375 / 768 / 1024 px.
- Recording controls, history list, and detail view all reflow sensibly on mobile.
- Spacing/sizing consistent; avoid magic pixel values where a shared token/value exists.

### 3. UX patterns

- All three of {loading, empty, error} states present and useful — especially for the history list and transcription/review results.
- Error messages are human-readable and never leak absolute paths, secrets, or raw transcript bodies.
- Recording state (idle / recording / transcribing / reviewing / error) is always visible and unambiguous.
- The optional OpenAI review is clearly marked as the one action that sends transcript text off-device.
- Images use `next/image` with explicit dimensions to prevent layout shift.

### 4. Copy & localization

- User-facing copy is clear. Localized PT/ES labels, where present, stay consistent with existing ones (per AGENTS.md, code/docs stay English; UI copy may include PT/ES).
- No leftover debug strings.

### 5. State clarity

- Selected source, selected language, current recording id, and errors are easy to reason about and reflected in the UI.

## Output format

```markdown
## Design Review: <scope>

### UI files reviewed
- `src/app/page.tsx`
- ...

### Findings

#### Critical (will break a11y or leak data in the UI)
- **[a11y]** Overlay traps keyboard — page.tsx:42
- **[privacy]** Error toast prints absolute file path — page.tsx:210

#### High (visible UX issue)
- **[ux]** No loading state while transcribing — page.tsx:78

#### Medium
- **[ux]** Empty history shows nothing instead of a hint — page.tsx:55
- **[i18n]** New label has EN only, missing PT/ES

#### Low / Style
- **[naming]** ...

### Verdict

APPROVE | NEEDS FIXES (count: critical=N, high=N, medium=N)
```

## When verdict is NEEDS FIXES

Don't auto-apply. Hand the report back and let the user decide what to fix now vs later. If they say "fix them all", switch to the `code-review-auto` skill.
