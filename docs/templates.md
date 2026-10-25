# Writing a process template

A process template is a YAML file in `packages/process/templates/`. It tells the kernel which phases exist, which roles run in each, which gates guard each transition, and what to do on failure. The selector agent reads `fitsWhen` to choose between templates for a given idea.

```yaml
name: linear                      # must match the file name
description: One sentence.
fitsWhen: |
  Plain-language criteria the selector uses.
initialPhase: specify
limits:
  projectFailures: 15             # total failed gates + failed workers before the project stops
phases:
  specify:
    roles: [product-owner]        # producing roles, run once on entering the phase
    budgetWeight: 1               # share of the project budget
    transitions:
      - to: design
        gates: [spec-complete, skeptic-review]
        onFail:                   # walked by the failing gate's count (each gate has its own)
          - { action: retry, times: 2 }
          - { action: sendBack, phase: specify, times: 1 }
          - { action: stop }      # last rung must be stop or sendBack
  build:
    loop:                         # a sprint phase
      itemRoles: [developer]      # run once per backlog item
      itemGates: [tests-pass, lint-clean, diff-matches-spec, skeptic-review]
      onItemFail:                 # walked by the item's fail count
        - { action: retry, times: 2 }
        - { action: shrink, times: 1 }
        - { action: park }        # last rung must be park
      itemsPerSprint: 3           # 0 means all ready items at once
    transitions:
      - to: done
        gates: [build-succeeds, security-scan-clean]
  done:
    terminal: true
```

## Roles

Producing roles: `product-owner`, `architect`, `planner`, `developer`, `releaser`. The `selector` runs before the first phase. `reviewer` and `skeptic` are never listed as roles; they are invoked by the judged gates.

## Gates

Mechanical (code, evidence from the sandbox): `schema-valid`, `budget-ok`, `tests-pass`, `lint-clean`, `security-scan-clean`, `build-succeeds`, `preview-healthy`, `rollback-verified`.

Judged (a reviewer or skeptic with a rubric, must cite): `spec-complete`, `architecture-sound`, `diff-matches-spec`, `skeptic-review`.

## Failure ladders

A ladder is walked by a fail count. Rungs with `times` absorb that many failures in order; the final rung absorbs the rest. A phase ladder counts each exit gate on its own: if the security scan fails twice and is fixed, a later journey failure starts at the first rung instead of stopping the phase. A gate that keeps failing still reaches `stop`, and `limits.projectFailures` caps the total. A role that cannot produce valid work counts against the phase as a whole.

- Phase ladders may use `retry`, `sendBack`, `stop`.
- Item ladders may use `retry`, `shrink`, `park`. `shrink` re-invokes the planner to split the item; `park` sets it aside with a plain-language reason and the project continues.

The loader validates every template: all phases reachable, a terminal phase reachable, gate and role names known, ladder actions of the right kind. A bad template fails at load time with the reason.
