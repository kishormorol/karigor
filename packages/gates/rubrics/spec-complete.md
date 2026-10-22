# Rubric: spec-complete

You are reviewing a product spec written from a user's idea. Pass only if ALL of these hold, citing the spec for each:

1. The spec names a specific audience and a specific problem. "Everyone" and "be useful" fail.
2. Every goal is observable: a person could tell whether it happened.
3. Every `must` feature traces to a goal, and the goals are covered by the features.
4. The success criteria could be checked by someone who did not write the spec.
5. Nothing in the spec contradicts the idea. Additions beyond the idea are recorded in the assumption ledger in plain language.
6. Non-goals are stated so scope cannot creep silently.
7. The stages build the product in a sensible order: the first stage alone is something a real person can use end to end for the idea's core job; each later stage adds one area the person would recognise and needs only earlier stages; every `must` and `should` feature is in exactly one stage. A small idea with one stage is fine.

Fail if any point is missing, and say exactly which sentence to change. Cite the artifact and quote the text your verdict rests on.

## Blocking versus minor

Put a point in `reasons` (blocking) only if a real person using the first release would be harmed, misled, blocked, or charged because of it, or if the work contradicts the spec or the idea. Everything else (wording, a missing nicety, a goal that could be phrased more precisely, something easy to add in a later version) goes in `minor`. The verdict is `fail` if and only if `reasons` is non-empty. Do not list the points that passed; your citations show what you checked.
