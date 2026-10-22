/**
 * Makes the first admin (or gives an existing person admin rights) and prints a one-time link to set
 * a password. Run on the computer that can reach the app's database:
 *   pnpm admin:link owner@example.com "Owner's name"
 * Karigor runs it for the person with: karigor admin-link <project> <email> [name]
 */
import { ensureAdmin } from "../src/server/people";

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  if (!email) {
    console.error('Usage: pnpm admin:link <email> ["Name"]');
    process.exit(2);
  }
  const r = await ensureAdmin({ email, name: nameParts.join(" ") });
  const origin = (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
  console.log(r.created ? `Added ${r.person.name} (${r.person.email}) as an admin.` : `${r.person.name} (${r.person.email}) is an admin.`);
  console.log(`One-time link to set a password (works once, ${r.person.hasPassword ? "for 24 hours" : "for 7 days"}):`);
  console.log(`${origin}/welcome/${r.token}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
