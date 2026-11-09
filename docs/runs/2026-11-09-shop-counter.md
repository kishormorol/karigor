# A real run: the "Shop counter" starter, 9 November 2026

Karigor built the `shop-counter` starter on a Claude Code login (`--adapter claude-code`, best tier), released on this computer (`--deploy local`). No one answered a question or touched the code. This record was written while the run was still building; the result is added at the end once it finishes.

The idea, as given: *a shop counter for a small grocery. The owner adds products with prices in taka and stock. Two salesmen ring up sales on their phones (cash, bKash or Nagad, with a transaction ID). Each sale lowers stock, cancelling puts it back. Salesmen cannot change prices or see takings. The owner sees daily takings by payment method and products running low. Later: buying from suppliers, and customer credit (baki).*

## What Karigor decided

- **Kind and process:** a web app, built iteratively.
- **Four stages**, built in order. Only stage 1 is built in this run; the owner starts each later stage with `karigor grow`.
  1. **Shop counter:** products, prices and stock, inviting salesmen, sales by cash/bKash/Nagad, cancelling, and a spreadsheet download of products and sales.
  2. Daily takings and low stock, searching sales by transaction ID, and who changed what.
  3. Buying stock from suppliers.
  4. Baki (customer credit) and repayments.
- **Twelve decisions recorded for the owner**, each one correctable. Some of them: the app records bKash/Nagad transaction IDs but does not check them with the provider; it runs on one computer in the shop with phones connecting over the shop's Wi-Fi, so no mobile data is needed; the owner cannot check takings from home; screens start in English, with prices in taka.
- **The plan:** 14 pieces for stage 1, built a few at a time.

## What the checks caught

1. **A backup that might never ship (the spec, before any code).** The skeptic refused the first spec. Every sale would be kept on one shop computer, the decision ledger promised a spreadsheet download, but the spec made that download an optional feature in stage 2. "If that computer breaks or is stolen, the owner loses everything." The product owner rewrote it: the download is now a required part of stage 1. The second version passed.
2. **A browser journey that would always fail (the counter screen).** The skeptic refused the first version of the counter screen. Its check for the "not enough stock" message looked for *the* alert on the page, but Next.js always adds a hidden alert of its own, so the check would match two elements (or the wrong one) and stop the release. The developer rewrote the check, and the second version passed.

The other pieces passed tests, lint, the diff-matches-spec review and the skeptic first time.

## What the run found in Karigor itself

After all 14 pieces were built, the release check failed twice with "no browser journeys ran", and Karigor went back to planning to fix journeys that did exist. The real cause was Karigor's own command runner. The app's 56 journeys (28, each at desktop and phone size) took longer than the 10-minute limit, partly because some of them waited 30 seconds for a menu link that never appeared. When the limit stopped `pnpm`, it exited cleanly, and the runner only treated a stop as a timeout when the process failed, so it counted as a successful run with no report.

Fixed in commit 4925f02: timeouts are judged by the runner's own clock, the whole process group (browser and app server included) is stopped, journeys get 30 minutes, and a timeout is reported as one, naming the slow or stuck journeys. The run was stopped and resumed on the fixed code; the planner's extra piece from the misleading message stays in its backlog.

## Progress and cost when this was written

| | |
|---|---|
| Started | 14:02 (EST) |
| Spec, design, plan | done by about 14:15, one retry on the spec |
| Built and checked | 9 of 14 pieces by 15:00 (about 6 minutes each, all four checks included) |
| Model calls | 42 |
| Cost | Nothing extra on the Claude subscription. The same calls would cost about USD 19 on the pay-per-token API (22.2M tokens in, 0.29M out, mostly cached context). |

## Result

*(Added when the run finishes: the browser journeys, the release, and what the app does once it is live.)*
