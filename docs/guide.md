# Building an app with Karigor

This guide takes you from an idea to an app you can use, then shows how to change it, keep it running and put it online. You type a few commands; Karigor does the rest and never asks a technical question.

## 1. Before you start (once)

You need [Node.js](https://nodejs.org) 22 or newer, git, and [Claude Code](https://claude.com/claude-code) installed and signed in. Claude Code builds the app under your own login, so there is no API key and, on a subscription, nothing extra to pay.

```sh
git clone https://github.com/kishormorol/karigor
cd karigor
npm install -g pnpm        # if you do not have it
pnpm install && pnpm build
alias karigor="node $PWD/packages/cli/dist/bin.js"   # add this line to ~/.zshrc or ~/.bashrc to keep it
```

No Claude Code? Use a free local model with `--adapter ollama`, or an API key with `--adapter claude` (see the [README](../README.md#build-for-real)). To watch the whole process without any model or cost, add `--adapter demo` to any command.

## 2. Describe your app

The idea is the only thing Karigor needs, and it shapes everything that follows. Write it as you would explain it to a person who will build it for you. Say:

- **who uses it**, and what each kind of person may see or do;
- **what it keeps track of** (orders, students, products, payments...);
- **the jobs it must do**, in the words you use at work;
- **local details** that matter: currency, language, payment methods, phone or computer.

Weak: `A grocery app`

Strong:

```
A shop counter for my small grocery in Dhaka. Only I sign in, on my phone.
I add products sold by piece, kg, gram, litre, packet or dozen, with a price and how many I have.
At the counter I enter what a customer bought; it adds up the total in taka, I choose cash or bKash,
and the stock goes down. A home page shows today's total, split into cash and bKash, and the
products running low. I can cancel a sale I entered by mistake, and the stock goes back.
```

For a bigger system, name every kind of person and what each may and may not do:

```
A system for my small clinic in Mirpur. The receptionist registers patients and books visits with
our three doctors. Each doctor sees their own visits for the day and writes notes and prescriptions;
the receptionist must not read the notes. The accountant takes payments in cash or bKash, prints a
receipt, and sees what is still owed. I, the owner, see each day's visits and takings by doctor,
with a chart for the month, and I add or remove staff.
```

Karigor plans the whole product, then splits it into **stages** in the order they are built. Stage 1 is the smallest version someone can use end to end (for the clinic: register a patient and book a visit). Each later stage adds one area you would recognise ("Billing", "The owner's dashboard"). The first build makes stage 1; you add the rest with `karigor grow` (step 6). A small idea is just one stage.

## 3. Start the build

```sh
karigor new "your idea here" --run --port 3300
```

`--port` chooses the address the app gets on your computer (here http://localhost:3300); give each app its own. Karigor prints the project's id (like `p-mvin1bja-92f2`) — keep it, every other command needs it.

What happens next, with no input from you:

1. It writes a specification and splits it into stages, with every assumption it made recorded.
2. It designs the system: the kinds of people who use it, what each may do, and its parts.
3. It splits stage 1 into small pieces (at most 15).
4. A developer builds each piece in a real code repository, with tests and browser journeys (a person's job, done in a real browser at phone and desktop size). A reviewer and a skeptic check it, and nothing goes forward unless the tests, lint, build and security scan pass.
5. Before release, every journey runs again on a brand-new database. Then it starts a preview, checks it works, checks it can roll back, and only then makes it live.

A stage usually takes a few hours. You can close nothing and leave it running; to see where it is from another terminal:

```sh
karigor status <id>       # where it stands, in plain words
karigor explain <id>      # the story so far
karigor cost <id>         # what it has used
```

**If it stops.** Every step is saved, so nothing is lost:

| What you see | What to do |
|---|---|
| It paused because your Claude usage limit ran out | `karigor resume <id> --wait` tries again every 30 minutes until it can carry on. The chat UI and `karigor serve` do this on their own |
| Your computer slept, the terminal closed, or it crashed | `karigor resume <id>` |
| `status` says it is waiting for a setting | `karigor setup <id>` (step 4) |
| It stopped with pieces of work set aside ("parked") | `karigor reopen <id>`, then `karigor resume <id>` |

## 4. Give it what only you can provide

Some apps need things only you can choose or own: the owner's email, a passcode, a key for an email service, a database account. Karigor makes its own secrets (like signing keys) itself, and asks you for the rest in plain words:

```sh
karigor setup <id>
```

It hides what you type, stores values only where the app runs, never in the project's records, and rebuilds the live app with them. `karigor status <id>` lists anything still missing.

## 5. Open and use it

```sh
karigor serve <id> --port 3300
```

Then open http://localhost:3300. Leave `serve` running: it keeps the app up and fixes problems on its own (step 8). It remembers the port the app went live on, so after the first time `karigor serve <id>` is enough.

Your data stays on your computer, in `~/.karigor/projects/<id>/data/`, and survives every new release.

**Signing in the first time.** Make yourself the first admin:

```sh
karigor admin-link <id> you@example.com "Your name"
```

Open the link it prints and choose your password. Then open **People** in the app to add the people who work with you, each with their role; the app gives you a one-time link to send each of them (by WhatsApp, SMS or email). Nobody needs an email service. Run `admin-link` again any time you need a new link for yourself.

(Apps built before 22 October 2026 have their own sign-in instead; their `README.md` says how it works.)

**Try everything.** Use it as you would on a busy day, on your phone too: enter real-looking data, make mistakes on purpose, undo things. Write down whatever is wrong, confusing or missing.

## 6. Build the next part

When you have tried stage 1, build the next stage on top of the live app:

```sh
karigor grow <id>          # the next stage, then it stops so you can try it
karigor grow <id> --all    # every remaining stage, one after another
```

`karigor status <id>` lists the stages: built, being built, later. Each stage revises the design, plans its own pieces, builds and checks them, and releases a new version; your data stays. Feedback you sent since the last release is taken on by the stage too. In the chat UI the same thing is the **Build the next part** button. `serve` never starts a stage by itself: stages are your call.

## 7. Change it

Tell Karigor in your own words, one thing per message:

```sh
karigor feedback <id> "On the sales list, tapping anywhere on a sale should open it, not just the time."
karigor feedback <id> "Add a page that shows each month's total, with cash and bKash separately."
```

If `serve` is running, a fix round starts within its check interval (10 minutes; change it with `--every`). Otherwise start one now with `karigor fix <id>`. A fix round builds the changes with the same checks as the first build and releases a new version; your data stays.

To change a decision Karigor made for you (they are listed in `karigor status` with ids like `a3`):

```sh
karigor correct <id> a3 "Prices should allow paisa, like 62.50."
```

Other tools:

- `karigor dismiss <id> <workItemId> --reason "..."` closes a request or problem report you no longer want.
- `karigor park <id> <itemId>` sets a piece of work aside; `karigor unpark` puts it back.
- `karigor kit <id>` gives an app built on an older template the current look (a fix round then restyles its pages).

## 8. Keep it running

`karigor serve <id> --port <n>` is the whole of operations on your computer. It runs the live app, watches its output and health, checks its libraries for security problems each day, and turns anything wrong into a fix round with a new release. It stops when you close it or restart the computer; run it again to continue.

## 9. Put it online

For a public address, use Vercel's free tier. You need a free Vercel account and, so the data survives on the internet, a free [Turso](https://turso.tech) database:

```sh
karigor new "..." --deploy vercel --run
karigor setup <id>                             # it asks for the database address and token
karigor watch <id> --every 15                  # checks the live site and fixes problems
```

Karigor uses the Vercel CLI's own login (`vercel login`), or a token in `VERCEL_TOKEN`.

## 10. What to expect

Karigor builds web apps that work on phones and computers, from a single-person tool to a system with several roles: sign-in for many people with roles and permissions, invitations by link, an activity log, forms, searchable and sortable lists, records with money and stock, dashboards with charts, and CSV export for spreadsheets. Each stage is at most 15 pieces of work, complete and tested end to end, including in a real browser for each kind of user.

Not yet supported: file uploads (photos, documents), scheduled jobs (a reminder every morning), SMS, and one installation serving several separate organisations. Karigor will work around them or leave them out and say so. Tips:

- Name each kind of person and what they may and may not see; the design plans for them from the start.
- Try each stage before building the next; your feedback goes into the next stage.
- Keep extras for feedback after the stages are built.

## Command summary

| Command | What it does |
|---|---|
| `karigor new "<idea>" --run` | Start a new app and build it |
| `karigor status <id>` | Where it stands |
| `karigor resume <id> [--wait]` | Continue after a pause, limit or crash; `--wait` keeps retrying through usage limits |
| `karigor setup <id>` | Give settings only you can provide |
| `karigor serve <id> --port <n>` | Run it on this computer and keep it healthy |
| `karigor feedback <id> "<text>"` | Ask for a change or report a problem |
| `karigor fix <id>` | Start a fix round now |
| `karigor grow <id> [--all]` | Build the next stage (or every remaining one) |
| `karigor admin-link <id> <email> ["name"]` | A one-time link to set your admin password |
| `karigor correct <id> <decisionId> "<text>"` | Change a decision made for you |
| `karigor reopen <id>` | Bring parked work back after a stop |
| `karigor dismiss <id> <workItemId>` | Close a request you no longer want |
| `karigor explain <id>` | The story of what happened |
| `karigor cost <id>` | What it has used |
