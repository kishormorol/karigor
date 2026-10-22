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

Karigor builds the **first version** first: the smallest app that does the whole job from start to finish, about 15 pieces of work. Anything else it notes for later. So put the jobs that matter most into the idea; extras are easy to add afterwards (step 6).

## 3. Start the build

```sh
karigor new "your idea here" --run --port 3300
```

`--port` chooses the address the app gets on your computer (here http://localhost:3300); give each app its own. Karigor prints the project's id (like `p-mvin1bja-92f2`) — keep it, every other command needs it.

What happens next, with no input from you:

1. It writes a specification, with every assumption it made recorded.
2. It designs the app and splits the work into small pieces.
3. A developer builds each piece in a real code repository, with tests. A reviewer and a skeptic check it, and nothing goes forward unless the tests, lint, build and security scan pass.
4. It releases: builds the app, starts a preview, checks it works, checks it can roll back, and only then makes it live.

A first version usually takes a few hours. You can close nothing and leave it running; to see where it is from another terminal:

```sh
karigor status <id>       # where it stands, in plain words
karigor explain <id>      # the story so far
karigor cost <id>         # what it has used
```

**If it stops.** Every step is saved, so nothing is lost:

| What you see | What to do |
|---|---|
| It paused because your Claude usage limit ran out | Wait for the reset, then `karigor resume <id>` |
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

Then open http://localhost:3300. Leave `serve` running: it keeps the app up and fixes problems on its own (step 7).

Your data stays on your computer, in `~/.karigor/projects/<id>/data/`, and survives every new release. If the app has an owner sign-in, set the password with the login page's "set or reset password" link, which emails you. If email is not set up yet, make a one-time link from the terminal instead:

```sh
cd ~/.karigor/projects/<id>/releases/<live version> && pnpm owner:reset-link
```

(The live version is in `~/.karigor/projects/<id>/releases/current.json`. Not every app has this script; the app's `README.md` says what it has.)

**Try everything.** Use it as you would on a busy day, on your phone too: enter real-looking data, make mistakes on purpose, undo things. Write down whatever is wrong, confusing or missing.

## 6. Change it

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

## 7. Keep it running

`karigor serve <id> --port <n>` is the whole of operations on your computer. It runs the live app, watches its output and health, checks its libraries for security problems each day, and turns anything wrong into a fix round with a new release. It stops when you close it or restart the computer; run it again to continue.

## 8. Put it online

For a public address, use Vercel's free tier. You need a free Vercel account and, so the data survives on the internet, a free [Turso](https://turso.tech) database:

```sh
karigor new "..." --deploy vercel --run
karigor setup <id>                             # it asks for the database address and token
karigor watch <id> --every 15                  # checks the live site and fixes problems
```

Karigor uses the Vercel CLI's own login (`vercel login`), or a token in `VERCEL_TOKEN`.

## 9. What to expect

Karigor builds web apps that work on phones and computers: sign-in, forms, lists, records with money and stock, simple dashboards with totals, and email. The first version is deliberately small, about 15 pieces of work, and is complete and tested end to end. Bigger systems grow from there one request at a time through `feedback`.

Not yet well supported: many user roles with different permissions, big multi-module systems (a full school or hospital management system), charts and large data tables, file uploads, and scheduled jobs. Karigor will attempt them, but a first version will cover only part of such an idea. For now:

- Start with the core job and one or two kinds of user; add modules one feedback at a time.
- Name each kind of user and what they may do in your idea, so the design plans for them from the start.
- Test each change before asking for the next.

## Command summary

| Command | What it does |
|---|---|
| `karigor new "<idea>" --run` | Start a new app and build it |
| `karigor status <id>` | Where it stands |
| `karigor resume <id>` | Continue after a pause, limit or crash |
| `karigor setup <id>` | Give settings only you can provide |
| `karigor serve <id> --port <n>` | Run it on this computer and keep it healthy |
| `karigor feedback <id> "<text>"` | Ask for a change or report a problem |
| `karigor fix <id>` | Start a fix round now |
| `karigor correct <id> <decisionId> "<text>"` | Change a decision made for you |
| `karigor reopen <id>` | Bring parked work back after a stop |
| `karigor dismiss <id> <workItemId>` | Close a request you no longer want |
| `karigor explain <id>` | The story of what happened |
| `karigor cost <id>` | What it has used |
