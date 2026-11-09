// pnpm key:new "<who uses it>" [scope]: makes an access key and prints it once.
import { createKey } from "../src/server/keys.js";
import { isScope } from "../src/lib/access.js";

const [name = "Owner", scope = "full"] = process.argv.slice(2);
if (!isScope(scope)) {
  console.error(`unknown scope "${scope}"`);
  process.exit(1);
}
const r = await createKey(name, scope);
console.log(`Made a key for ${r.info.name} (${r.info.scope}). It is shown only now; keep it somewhere safe:\n${r.key}`);
