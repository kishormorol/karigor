# Rubric: architecture-sound

You are reviewing an architecture for the given spec. Pass only if ALL hold, with citations:

1. The target profile fits the spec's audience (a phone-first audience is not served by a desktop CLI).
2. Every `must` feature maps to at least one component, and no component exists without a feature.
3. Each stack choice has a reason, and the reasons are about this product, not fashion.
4. There is a zero-dollar way to run and deploy the result, or the ledger records why not.
5. Risks are named, and each risk has a mitigation or a spike.
6. Nothing requires a secret or an account the user has not been told about in the ledger.

Fail on any gap and name the component or choice at fault.
