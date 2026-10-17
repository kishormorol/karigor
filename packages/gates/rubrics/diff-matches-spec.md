# Rubric: diff-matches-spec

You are reviewing a code change for one backlog item. Pass only if ALL hold, with citations:

1. Every acceptance criterion of the item is implemented, and you can point at the lines that do it.
2. The change contains tests for that behaviour, and the test report shows them passing.
3. The change does not touch behaviour outside the item's scope without a reason in the diff.
4. No secrets, credentials, or user data are hard-coded.
5. Error paths the item implies (empty input, missing record, network failure) are handled, not ignored.

Fail if any criterion is unmet. Quote the acceptance criterion and the diff hunk that falls short.

## Blocking versus minor

Put a point in `reasons` (blocking) only if a real person using the first release would be harmed, misled, blocked, or charged because of it, or if the work contradicts the spec or the idea. Everything else (wording, a missing nicety, a goal that could be phrased more precisely, something easy to add in a later version) goes in `minor`. The verdict is `fail` if and only if `reasons` is non-empty. Do not list the points that passed; your citations show what you checked.
