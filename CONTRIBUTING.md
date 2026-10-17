# Contributing to Karigor

Thank you. Karigor is meant to benefit people everywhere, so contributions that make it cheaper, more reliable, or usable in more languages and places are the most welcome of all.

## Principles every change must respect

1. **A zero-dollar path exists.** Nothing may require a paid service. Paid options are upgrades.
2. **Cost is a gate.** Any new model call goes through the budget check and records a cost entry with an idempotency key.
3. **No technical questions to the user.** If a decision needs a human, it goes in the assumption ledger in plain language, not a prompt.
4. **Mistakes are caught by gates, not trust.** New capabilities come with the gate that would catch them failing.
5. **Everything is replayable.** State lives in the event log only. If you add state, add an event and a replay rule, and the crash-replay test must still pass.

## Workflow

- Open an issue or a draft PR early; small PRs merge faster.
- `pnpm test` must pass. Tests run on the mock adapter and cost nothing.
- New role prompts live in `packages/runtime/src/roles/*.md`; rubrics in `packages/gates/rubrics/*.md`. Prompt-only changes are welcome and need no TypeScript.
- Process templates live in `packages/process/templates/*.yaml`; see `docs/templates.md`.
- Keep user-facing text plain. If a non-technical reader would not understand a sentence, rewrite it.

## Commit messages

Short imperative subject, a blank line, then why. Co-author lines are welcome.
