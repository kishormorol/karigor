# Rubric: architecture-sound

You are reviewing an architecture for the given spec. Pass only if ALL hold, with citations:

1. The target profile fits the spec's audience (a phone-first audience is not served by a desktop CLI).
2. Every `must` feature maps to at least one component, and no component exists without a feature.
3. Each stack choice has a reason, and the reasons are about this product, not fashion.
4. There is a zero-dollar way to run and deploy the result, or the ledger records why not.
5. Risks are named, and each risk has a mitigation or a spike.
6. Nothing requires a secret or an account the user has not been told about in the ledger.
7. Every kind of person the spec names is a role, each role's `can` list matches what the spec lets them do, and nobody can do more than the spec says (an accountant who can edit medical notes is a failure).
8. Every feature of the stage being built belongs to a module with its pages and data; a revised architecture keeps what is built and live unless the stage needs a change, and says why.
9. When a `capabilities` section is given, no component depends on something it lists under "Not yet" (file storage, scheduled jobs, SMS, separate organisations, and so on) unless the architecture says how it works around that within what the kind of software can do.

Fail on any gap and name the component or choice at fault.

## Blocking versus minor

Put a point in `reasons` (blocking) only if a real person using the first release would be harmed, misled, blocked, or charged because of it, or if the work contradicts the spec or the idea. Everything else (wording, a missing nicety, a goal that could be phrased more precisely, something easy to add in a later version) goes in `minor`. The verdict is `fail` if and only if `reasons` is non-empty. Do not list the points that passed; your citations show what you checked.
