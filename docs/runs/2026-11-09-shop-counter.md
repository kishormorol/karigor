# A real run: the "Shop counter" starter, 9 November 2026

Karigor built the `shop-counter` starter on a Claude Code login (`--adapter claude-code`, best tier), released on this computer (`--deploy local`). No one answered a question or touched the app's code. The run stopped twice on faults in Karigor itself; each was fixed in Karigor and the run carried on. The app went live at 17:00, three hours after it started.

The idea, as given: *a shop counter for a small grocery. The owner adds products with prices in taka and stock. Two salesmen ring up sales on their phones (cash, bKash or Nagad, with a transaction ID). Each sale lowers stock, cancelling puts it back. Salesmen cannot change prices or see takings. The owner sees daily takings by payment method and products running low. Later: buying from suppliers, and customer credit (baki).*

## What Karigor decided

- **Kind and process:** a web app, built iteratively.
- **Four stages**, built in order. Only stage 1 is built in this run; the owner starts each later stage with `karigor grow`.
  1. **Shop counter:** products, prices and stock, inviting salesmen, sales by cash/bKash/Nagad, cancelling, and a spreadsheet download of products and sales.
  2. Daily takings and low stock, searching sales by transaction ID, and who changed what.
  3. Buying stock from suppliers.
  4. Baki (customer credit) and repayments.
- **Decisions recorded for the owner**, each one correctable: twelve from the spec, 58 by the end. Some of them: the app records bKash/Nagad transaction IDs but does not check them with the provider; it runs on one computer in the shop with phones connecting over the shop's Wi-Fi, so no mobile data is needed; the owner cannot check takings from home; screens start in English, with prices in taka.
- **The plan:** 14 pieces for stage 1, built a few at a time. One more was added for the browser journeys, and two by the fix round at the end.

## What the checks caught

1. **A backup that might never ship (the spec, before any code).** The skeptic refused the first spec. Every sale would be kept on one shop computer, the decision ledger promised a spreadsheet download, but the spec made that download an optional feature in stage 2. "If that computer breaks or is stolen, the owner loses everything." The product owner rewrote it: the download is now a required part of stage 1. The second version passed.
2. **A browser journey that would always fail (the counter screen).** The skeptic refused the first version of the counter screen. Its check for the "not enough stock" message looked for *the* alert on the page, but Next.js always adds a hidden alert of its own, so the check would match two elements (or the wrong one) and stop the release. The developer rewrote the check, and the second version passed.
3. **A browser journey that proved nothing (cancelling a sale).** The skeptic refused the first version of "cancel my own sale". Its journey clicked *the* Cancel button on a page that would show two, and it checked that the stock came back by looking for the text "10" anywhere on the page, which a price or a time would also satisfy. The developer made the journey pick the bill it had just saved and read that product's own stock.

The other pieces passed tests, lint, the diff-matches-spec review and the skeptic first time. In all, 102 checks ran and 8 failed: these three, two runs of the browser journeys and three tries at the release (both described below).

## What the run found in Karigor itself

**1. Journeys that ran out of time were counted as none.** After all 14 pieces were built, the release check failed twice with "no browser journeys ran", and Karigor went back to planning to fix journeys that did exist. The real cause was Karigor's own command runner. The app's 56 journeys (28, each at desktop and phone size) took longer than the 10-minute limit, partly because some of them waited 30 seconds for a menu link that never appeared. When the limit stopped `pnpm`, it exited cleanly, and the runner only treated a stop as a timeout when the process failed, so it counted as a successful run with no report.

Fixed in commit 4925f02: timeouts are judged by the runner's own clock, the whole process group (browser and app server included) is stopped, journeys get 30 minutes, and a timeout is reported as one, naming the slow or stuck journeys. The run was stopped and resumed on the fixed code; the planner's extra piece from the misleading message stayed in its backlog. It turned out to be useful: the developer fixed the helper that opens a menu section and two journeys that depended on it, and the full set then passed in 90 seconds.

**2. An app that fixed its own port could not be released.** The architect decided the app should start with `next start -H 0.0.0.0 -p 3917`, so phones on the shop Wi-Fi could reach it. Karigor starts every preview on a port it picks, so the preview never answered. Karigor waited 90 seconds, said only "the preview failed:" with nothing after it, and tried the same thing twice more before stopping.

Fixed in commit 7808392. A release that starts on another port is told so within seconds ("the app started on port 3917, not on the port it was given"). The stack guides say the port is Karigor's to choose, and that a plain `next start` already listens on the whole network. New web apps carry a test that fails while the piece is being built if the start command fixes a port. For this run, `karigor fix` took the failed release as its work: two small pieces (the start command, and links that follow the running port), then the release.

**3. A build finished by a fix round was not counted as built.** After that release the stage list still showed "Shop counter" as not built, and `karigor grow` refused with "the first version is not built yet". Fixed: when every piece of a build is done and only its release failed, the fix round's release marks it built (the same for a later stage).

**4. A decision that no longer matched the plan.** Decision a8 still tells the owner that the first version includes daily reports. The skeptic's first refusal led the product owner to move features between stages, and reports ended up in stage 2. The live app has no takings report. The spec check now fails when a decision promises for the first version something the stages put later, and the product owner is told to correct such a decision when it moves a feature. This project's a8 is still wrong until the owner corrects it (`karigor correct`) or stage 2 is built.

## Progress and cost part-way, at 15:00

| | |
|---|---|
| Started | 14:02 (EST) |
| Spec, design, plan | done by about 14:15, one retry on the spec |
| Built and checked | 9 of 14 pieces by 15:00 (about 6 minutes each, all four checks included) |
| Model calls | 42 |
| Cost | Nothing extra on the Claude subscription. The same calls would cost about USD 19 on the pay-per-token API (11.1M tokens in, 0.29M out, mostly cached context). |

## Result

The app is live on this computer (`karigor serve p-mw9mo954-68f9 --port 3917`), release `r1-07e0feb`.

| | |
|---|---|
| Pieces built | 17: 14 planned, 1 for the browser journeys, 2 in the fix round |
| Unit tests | 21 test files |
| Browser journeys | 33, each at desktop and phone size; all 66 runs passed before release |
| Wall-clock time | 14:02 to 17:00 (EST), including two stops for the Karigor fixes above |
| Model calls | 77 |
| Cost | Nothing extra on the Claude subscription. About USD 35 on the pay-per-token API (21.0M tokens in, 0.48M out, mostly cached context). |

Checked by hand in a browser after release, as the owner:

- The one-time owner link from `karigor admin-link` opens a "choose a password" page and signs in.
- Adding a product (Miniket rice, sold by the kg, ৳72.50, 20 in stock) shows it in Products and on the Counter.
- Two taps on the Counter make a bill of ৳145. Choosing bKash asks for the transaction ID. Saving gives "Bill #1 saved" and the stock drops to 18.
- Sales lists the bill with its method, transaction ID and total. Dates and times are the shop's (Bangladesh time).
- People shows the shop address on the Wi-Fi (`http://192.168.1.206:3917`), and the app answers there.
- A download address opened without signing in is sent to the sign-in page.

Not checked by hand: a salesman's own sign-in on a phone, cancelling a sale, and the downloaded files. The journeys cover all three.

A correction: this record first gave 41.9M tokens in (and 22.2M at 15:00). Karigor's meter was adding cached tokens to a count that already included them, so both were doubled; the figures above are the corrected ones. The dollar figures were never affected.

One fault seen: on a short desktop window the bar holding the total and the Save sale button covers the bill's lines, so the quantity field is half hidden until the page is scrolled. It is a layout fault, not a wrong number, and is the kind of thing `karigor feedback` or pointing at the app is for.
