#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
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
  --deploy <target>  local, vercel or none (KARIGOR_DEPLOY)
  --app-port <n>     port of the live app on the local target (KARIGOR_APP_PORT)

Set KARIGOR_TOKEN to require an access link (/?token=...). Required when the host is not 127.0.0.1.
That link sees every project. To give someone their own sign-in, which sees only their projects:

  karigor-server add-person "<name>"   prints their link (KARIGOR_URL sets its address)
  KARIGOR_SIGNUP=open                  anyone who opens the page signs up with a name`);
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
  log: (l) => console.log(l),
});
server.listen(Number(v.port), host, () => {
  const where = `http://${host === "0.0.0.0" ? "localhost" : host}:${v.port}`;
  console.log(`Karigor is ready at ${where}${token ? "/?token=<your KARIGOR_TOKEN>" : ""} (${v.adapter} adapter, ${v.deploy} deploy)`);
});
