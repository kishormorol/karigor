# Rubric: diff-matches-spec

You are reviewing a code change for one backlog item. Pass only if ALL hold, with citations:

1. Every acceptance criterion of the item is implemented, and you can point at the lines that do it.
2. The change contains tests for that behaviour, and the test report shows them passing.
3. The change does not touch behaviour outside the item's scope without a reason in the diff.
4. No secrets, credentials, or user data are hard-coded.
5. Error paths the item implies (empty input, missing record, network failure) are handled, not ignored.

Fail if any criterion is unmet. Quote the acceptance criterion and the diff hunk that falls short.
