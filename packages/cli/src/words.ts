/**
 * The fixed sentences of a project's story, in each language the chat page offers. What the agents wrote (a gate's
 * reasons, an item's id, a stop reason) is passed in and stays as they wrote it.
 */
export type Lang = "en" | "bn";
export const LANGS: readonly Lang[] = ["en", "bn"];
export const isLang = (s: unknown): s is Lang => typeof s === "string" && (LANGS as readonly string[]).includes(s);

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const PHASES_EN: Record<string, string> = {
  specify: "writing down what to build",
  design: "deciding how to build it",
  plan: "breaking the work into pieces",
  spike: "testing the riskiest part first",
  build: "building",
  verify: "checking the whole thing",
  release: "putting it online",
  triage: "sorting out what needs fixing",
  done: "done",
};

const PHASES_BN: Record<string, string> = {
  specify: "কী বানাতে হবে তা লিখে রাখা",
  design: "কীভাবে বানানো হবে তা ঠিক করা",
  plan: "কাজটিকে ছোট ছোট ভাগে ভাগ করা",
  spike: "সবচেয়ে ঝুঁকির অংশটি আগে পরীক্ষা করা",
  build: "তৈরি করা",
  verify: "পুরোটা যাচাই করা",
  release: "অনলাইনে তোলা",
  triage: "কী ঠিক করতে হবে তা বাছাই করা",
  done: "শেষ",
};

const ROLES_BN: Record<string, string> = {
  selector: "পদ্ধতি বাছাইকারী",
  estimator: "খরচ হিসাবকারী",
  "product-owner": "প্রোডাক্ট ওনার",
  architect: "স্থপতি",
  planner: "পরিকল্পনাকারী",
  developer: "ডেভেলপার",
  reviewer: "পর্যালোচক",
  skeptic: "সংশয়ী পর্যালোচক",
  releaser: "রিলিজকারী",
};

const BN = {
  tier: { free: "বিনা খরচের", cheap: "সস্তা", best: "সেরা" } as Record<string, string>,
  model: { judgment: "বিচারের", routine: "সাধারণ কাজের", mock: "নকল" } as Record<string, string>,
  status: { todo: "বাকি", "in-progress": "চলছে", done: "শেষ", parked: "আলাদা করে রাখা" } as Record<string, string>,
  profile: { "web-app": "ওয়েব অ্যাপ" } as Record<string, string>,
};

export interface StoryWords {
  phase(phase?: string): string;
  created(): string;
  template(template: string, profile: string): string;
  budget(tier: string): string;
  sprint(n: number, items: string): string;
  phaseStarted(phase: string): string;
  workerStarted(role: string, itemId: string | undefined, attempt: number, tier: string): string;
  workerOk(role: string, itemId: string | undefined, kinds: string): string;
  workerFailed(role: string, itemId: string | undefined, outcome: string, error?: string): string;
  gate(gate: string, itemId: string | undefined, pass: boolean, reasons: string): string;
  transition(from: string, to: string): string;
  itemStatus(itemId: string, status: string, reason?: string): string;
  downgraded(phase: string): string;
  stopped(reason: string): string;
  finished(): string;
  deployed(version: string, preview: boolean, url?: string): string;
  deployFailed(version: string, preview: boolean): string;
  rolledBack(version: string): string;
  feedback(title: string): string;
  problem(source: string, severity: string, title: string): string;
  fixRound(cycle: number, n: number): string;
  waiting(needs: string): string;
  resumed(): string;
  paused(reason: string): string;
  dismissed(reason: string): string;
  reopened(n: number): string;
  settings(made: boolean, names: string[]): string;
  corrected(id: string, text: string): string;
}

export const EN: StoryWords = {
  phase: (p) => (p ? PHASES_EN[p] ?? p : "not started"),
  created: () => "Project created.",
  template: (t, p) => `Chose the "${t}" process; building a ${p}.`,
  budget: (t) => `Budget tier: ${t}.`,
  sprint: (n, items) => `Sprint ${n} started with ${items}.`,
  phaseStarted: (p) => `Started ${EN.phase(p)}.`,
  workerStarted: (r, i, a, t) => `${r}${i ? ` on ${i}` : ""} started (attempt ${a}, ${t} model).`,
  workerOk: (r, i, k) => `${r}${i ? ` on ${i}` : ""} produced ${k || "nothing new"}.`,
  workerFailed: (r, i, o, err) => `${r}${i ? ` on ${i}` : ""} did not succeed (${o}${err ? `: ${err}` : ""}).`,
  gate: (g, i, pass, reasons) => `Check "${g}"${i ? ` on ${i}` : ""}: ${pass ? "passed" : "FAILED"}.${reasons}`,
  transition: (f, t) => `Moved from ${f} to ${t}.`,
  itemStatus: (i, s, r) => `${i} is now ${s}${r ? ` (${r})` : ""}.`,
  downgraded: (p) => `Budget for ${p} is tight; switched to the cheaper model.`,
  stopped: (r) => `Stopped: ${r}`,
  finished: () => "Finished.",
  deployed: (v, preview, url) => `Put ${v} on ${preview ? "a preview" : "production"}${url ? ` at ${url}` : ""}.`,
  deployFailed: (v, preview) => `Could not put ${v} on ${preview ? "a preview" : "production"}.`,
  rolledBack: (v) => `${v} failed after going live and was taken back.`,
  feedback: (t) => `Feedback received: ${t}.`,
  problem: (s, sev, t) => `Noticed a problem (${s}, ${sev}): ${t}.`,
  fixRound: (c, n) => `Started fix round ${c} for ${n} ${plural(n, "problem", "problems")} or ${plural(n, "request", "requests")}.`,
  waiting: (n) => `Waiting for you to give: ${n}.`,
  resumed: () => "Carrying on.",
  paused: (r) => `Paused: ${r}.`,
  dismissed: (r) => `Closed a work item: ${r}.`,
  reopened: (n) => `Put back to work${n ? ` with ${n} ${plural(n, "item", "items")} back on the list` : ""}.`,
  settings: (made, names) => `${made ? "Made and stored" : "Stored"} the ${plural(names.length, "setting", "settings")} ${names.join(", ")} where the app reads ${plural(names.length, "it", "them")}.`,
  corrected: (id, t) => `You corrected decision ${id}: ${t}.`,
};

const on = (i?: string) => (i ? ` (${i})` : "");
const role = (r: string) => ROLES_BN[r] ?? r;

export const BANGLA: StoryWords = {
  phase: (p) => (p ? PHASES_BN[p] ?? p : "এখনো শুরু হয়নি"),
  created: () => "পেয়েছি। এখান থেকে আমি দেখছি।",
  template: (t, p) => `পরিকল্পনা: "${t}" পদ্ধতি, তৈরি হবে একটি ${BN.profile[p] ?? p}।`,
  budget: (t) => `বাজেট: ${BN.tier[t] ?? t} স্তর।`,
  sprint: (n, items) => `স্প্রিন্ট ${n} শুরু হলো: ${items}।`,
  phaseStarted: (p) => `শুরু হলো: ${BANGLA.phase(p)}।`,
  workerStarted: (r, i, a, t) => `${role(r)}${on(i)} কাজ শুরু করল (চেষ্টা ${a}, ${BN.model[t] ?? t} মডেল)।`,
  workerOk: (r, i, k) => `${role(r)}${on(i)} তৈরি করল: ${k || "নতুন কিছু নয়"}।`,
  workerFailed: (r, i, o, err) => `${role(r)}${on(i)} সফল হয়নি (${o}${err ? `: ${err}` : ""})।`,
  gate: (g, i, pass, reasons) => `যাচাই "${g}"${on(i)}: ${pass ? "পাস করেছে" : "ব্যর্থ"}।${reasons}`,
  transition: (f, t) => `${f} → ${t}`,
  itemStatus: (i, s, r) => `${i} এখন ${BN.status[s] ?? s}${r ? ` (${r})` : ""}।`,
  downgraded: (p) => `${p}-এর বাজেট কম; সস্তা মডেলে বদলানো হলো।`,
  stopped: (r) => `থেমে গেছে: ${r}`,
  finished: () => "শেষ হয়েছে।",
  deployed: (v, preview, url) => `${v} ${preview ? "একটি প্রিভিউতে" : "চালু অ্যাপে"} তোলা হলো${url ? `: ${url}` : ""}।`,
  deployFailed: (v, preview) => `${v} ${preview ? "প্রিভিউতে" : "চালু অ্যাপে"} তোলা যায়নি।`,
  rolledBack: (v) => `${v} চালু হওয়ার পর সমস্যা করছিল, তাই আগের সংস্করণে ফেরানো হলো।`,
  feedback: (t) => `আপনার মতামত: ${t}।`,
  problem: (s, sev, t) => `একটি সমস্যা ধরা পড়েছে (${s}, ${sev}): ${t}।`,
  fixRound: (c, n) => `ঠিক করার রাউন্ড ${c} শুরু হলো, ${n}টি সমস্যা বা অনুরোধের জন্য।`,
  waiting: (n) => `আপনার কাছ থেকে দরকার: ${n}।`,
  resumed: () => "আবার কাজ চলছে।",
  paused: (r) => `বিরতি: ${r}।`,
  dismissed: (r) => `একটি কাজ বন্ধ করা হলো: ${r}।`,
  reopened: (n) => `আবার কাজে ফেরানো হলো${n ? `, ${n}টি কাজ আবার তালিকায়` : ""}।`,
  settings: (made, names) => `${made ? "তৈরি করে রাখা হলো" : "রাখা হলো"}: ${names.join(", ")}। অ্যাপ এখান থেকেই পড়বে।`,
  corrected: (id, t) => `আপনি সিদ্ধান্ত ${id} বদলেছেন: ${t}।`,
};

export const storyWords = (lang: Lang = "en"): StoryWords => (lang === "bn" ? BANGLA : EN);
