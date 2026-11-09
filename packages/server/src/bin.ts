#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { logMailer, resendMailer } from "./mail.js";
import { PaddleProvider, SslCommerzProvider, type PaymentProvider } from "./billing.js";

/** The payment providers whose settings are present. */
function billingFromEnv(publicUrl: string): { billing?: { providers: PaymentProvider[]; packs: number[] } } {
  const e = process.env;
  const sandbox = e["KARIGOR_PAYMENTS_SANDBOX"] === "1";
  const providers: PaymentProvider[] = [];
  if (e["PADDLE_API_KEY"] && e["PADDLE_PRODUCT_ID"] && e["PADDLE_WEBHOOK_SECRET"]) providers.push(new PaddleProvider({ apiKey: e["PADDLE_API_KEY"], productId: e["PADDLE_PRODUCT_ID"], webhookSecret: e["PADDLE_WEBHOOK_SECRET"], sandbox }));
  if (e["SSLCOMMERZ_STORE_ID"] && e["SSLCOMMERZ_STORE_PASSWORD"]) providers.push(new SslCommerzProvider({ storeId: e["SSLCOMMERZ_STORE_ID"], storePassword: e["SSLCOMMERZ_STORE_PASSWORD"], bdtPerUsd: Number(e["KARIGOR_BDT_PER_USD"] ?? 122), publicUrl, sandbox }));
  if (!providers.length) return {};
  const packs = (e["KARIGOR_CREDIT_PACKS"] ?? "5,10,25").split(",").map(Number).filter((n) => n > 0);
  return { billing: { providers, packs } };
}
import { People } from "./people.js";
import { createKarigorServer } from "./server.js";

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", default: process.env["KARIGOR_ROOT"] ?? join(homedir(), ".karigor", "projects") },
    port: { type: "string", default: process.env["PORT"] ?? "4321" },
    host: { type: "string", default: process.env["KARIGOR_HOST"] ?? "127.0.0.1" },
    adapter: { type: "string", default: process.env["KARIGOR_ADAPTER"] ?? "claude-code" },
    deploy: { type: "string", default: process.env["KARIGOR_DEPLOY"] ?? "local" },
    profile: { type: "string", default: "web-app" },
    "app-port": { type: "string", default: process.env["KARIGOR_APP_PORT"] ?? "3000" },
    help: { type: "boolean", default: false },
  },
});

if (v.help) {
  console.log(`karigor-server: the chat UI over Karigor

  --root <dir>       where projects live (KARIGOR_ROOT)
  --port <n>         port for the UI (PORT, default 4321)
  --host <addr>      address to listen on (KARIGOR_HOST, default 127.0.0.1)
  --adapter <name>   claude-code, claude, ollama or demo (KARIGOR_ADAPTER)
  --deploy <target>  local, vercel, netlify, cloudflare or none (KARIGOR_DEPLOY)
  --app-port <n>     port of the live app on the local target (KARIGOR_APP_PORT)

Set KARIGOR_TOKEN to require an access link (/?token=...). Required when the host is not 127.0.0.1.
That link sees every project. To give someone their own sign-in, which sees only their projects:

  karigor-server add-person "<name>"   prints their link (KARIGOR_URL sets its address)
  KARIGOR_SIGNUP=open                  anyone who opens the page signs up with a name

To host everyone's apps from here, each on its own port and kept running:
  KARIGOR_APPS_URL=https://a{port}.example.com   the address people use for each app
  KARIGOR_SERVE_APPS=1                           the same, at http://localhost:<port>

To run it as a service for many people (sign-in by email, credit for builds):
  KARIGOR_URL=https://karigor.example.com   this Karigor's public address (needed for the emailed links)
  KARIGOR_EMAIL_SIGNIN=1                    people sign in with a one-time link sent to their email
  RESEND_API_KEY, KARIGOR_MAIL_FROM         send those emails through Resend (without them, links go to this log)
  KARIGOR_WELCOME_CREDIT=1                  USD of credit for each new sign-up (with KARIGOR_SIGNUP=open)
  KARIGOR_METERED=20                        charge builds on this Karigor's model key: cost plus this % margin
  KARIGOR_CREDIT_PACKS=5,10,25              the amounts (USD) people may buy
  PADDLE_API_KEY, PADDLE_PRODUCT_ID, PADDLE_WEBHOOK_SECRET   pay by card worldwide (webhook: <KARIGOR_URL>/api/billing/notice/paddle)
  SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASSWORD, KARIGOR_BDT_PER_USD   pay by bKash, Nagad or a Bangladeshi card
  KARIGOR_PAYMENTS_SANDBOX=1                use the providers' test systems`);
  process.exit(0);
}

if (positionals[0] === "add-person") {
  const name = positionals.slice(1).join(" ").trim();
  if (!name) {
    console.error('karigor-server: add-person needs a name, as in add-person "Rahima"');
    process.exit(1);
  }
  const { token } = await new People(v.root!).add(name);
  const base = process.env["KARIGOR_URL"] ?? `http://localhost:${v.port}`;
  console.log(`Send ${name} this link. It is shown only once, and it opens only their own projects:\n${base.replace(/\/$/, "")}/?token=${token}`);
  process.exit(0);
}

const token = process.env["KARIGOR_TOKEN"];
const host = v.host!;
if (!token && host !== "127.0.0.1" && host !== "localhost" && process.env["KARIGOR_ALLOW_OPEN"] !== "1") {
  console.error("karigor-server: listening beyond this computer needs KARIGOR_TOKEN (or KARIGOR_ALLOW_OPEN=1 if something else protects it)");
  process.exit(1);
}

const { server } = createKarigorServer({
  root: v.root!,
  adapter: v.adapter!,
  deploy: v.deploy!,
  profile: v.profile!,
  appPort: Number(v["app-port"]),
  ...(token ? { token } : {}),
  signup: process.env["KARIGOR_SIGNUP"] === "open",
  ...(process.env["KARIGOR_EMAIL_SIGNIN"] === "1"
    ? {
        emailSignIn: {
          url: process.env["KARIGOR_URL"] ?? `http://localhost:${v.port}`,
          mailer: process.env["RESEND_API_KEY"] && process.env["KARIGOR_MAIL_FROM"] ? resendMailer({ apiKey: process.env["RESEND_API_KEY"], from: process.env["KARIGOR_MAIL_FROM"] }) : logMailer((l) => console.log(l)),
        },
      }
    : {}),
  ...billingFromEnv(process.env["KARIGOR_URL"] ?? `http://localhost:${v.port}`),
  ...(process.env["KARIGOR_WELCOME_CREDIT"] ? { welcomeCreditUsd: Number(process.env["KARIGOR_WELCOME_CREDIT"]) } : {}),
  ...(process.env["KARIGOR_METERED"] !== undefined ? { metered: { marginPct: Number(process.env["KARIGOR_METERED"]) || 0 } } : {}),
  ...(process.env["KARIGOR_APPS_URL"] || process.env["KARIGOR_SERVE_APPS"] === "1" ? { apps: process.env["KARIGOR_APPS_URL"] ? { url: process.env["KARIGOR_APPS_URL"] } : {} } : {}),
  log: (l) => console.log(l),
});
server.listen(Number(v.port), host, () => {
  const where = `http://${host === "0.0.0.0" ? "localhost" : host}:${v.port}`;
  console.log(`Karigor is ready at ${where}${token ? "/?token=<your KARIGOR_TOKEN>" : ""} (${v.adapter} adapter, ${v.deploy} deploy)`);
});
