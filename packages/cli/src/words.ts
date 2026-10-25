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
  itemStatus: (i, s, r) => `${i} এখন ${BN.status[s] ?? s}${r ? ` (${reasonIn("bn", r)})` : ""}।`,
  downgraded: (p) => `${p}-এর বাজেট কম; সস্তা মডেলে বদলানো হলো।`,
  stopped: (r) => `থেমে গেছে: ${reasonIn("bn", r)}`,
  finished: () => "শেষ হয়েছে।",
  deployed: (v, preview, url) => `${v} ${preview ? "একটি প্রিভিউতে" : "চালু অ্যাপে"} তোলা হলো${url ? `: ${url}` : ""}।`,
  deployFailed: (v, preview) => `${v} ${preview ? "প্রিভিউতে" : "চালু অ্যাপে"} তোলা যায়নি।`,
  rolledBack: (v) => `${v} চালু হওয়ার পর সমস্যা করছিল, তাই আগের সংস্করণে ফেরানো হলো।`,
  feedback: (t) => `আপনার মতামত: ${t}।`,
  problem: (s, sev, t) => `একটি সমস্যা ধরা পড়েছে (${s}, ${sev}): ${t}।`,
  fixRound: (c, n) => `ঠিক করার রাউন্ড ${c} শুরু হলো, ${n}টি সমস্যা বা অনুরোধের জন্য।`,
  waiting: (n) => `আপনার কাছ থেকে দরকার: ${n}।`,
  resumed: () => "আবার কাজ চলছে।",
  paused: (r) => `বিরতি: ${reasonIn("bn", r)}।`,
  dismissed: (r) => `একটি কাজ বন্ধ করা হলো: ${r}।`,
  reopened: (n) => `আবার কাজে ফেরানো হলো${n ? `, ${n}টি কাজ আবার তালিকায়` : ""}।`,
  settings: (made, names) => `${made ? "তৈরি করে রাখা হলো" : "রাখা হলো"}: ${names.join(", ")}। অ্যাপ এখান থেকেই পড়বে।`,
  corrected: (id, t) => `আপনি সিদ্ধান্ত ${id} বদলেছেন: ${t}।`,
};

export const storyWords = (lang: Lang = "en"): StoryWords => (lang === "bn" ? BANGLA : EN);

/** The fixed sentences of `karigor status`. */
export interface StatusWords {
  project(id: string): string;
  idea(text: string): string;
  created(): string;
  running(phase: string, sprint?: number): string;
  stopped(reason?: string): string;
  paused(reason: string): string;
  waiting(): string;
  giveWith(id: string): string;
  finished(stage: boolean, cycle: number, headline?: string): string;
  link(url: string): string;
  roundGrow(cycle: number): string;
  roundFix(cycle: number): string;
  stages(): string;
  stageMark(state: "built" | "building" | "later"): string;
  growWith(id: string): string;
  liveVersion(version: string, url?: string): string;
  missingSettings(): string;
  openItems(n: number): string;
  process(template: string, profile: string): string;
  budget(tier: string): string;
  work(done: number, doing: number, todo: number, parked: number, dropped: number): string;
  parked(title: string, reason?: string): string;
  failures(n: number): string;
  decisions(): string;
  corrected(text: string): string;
}

export const STATUS_EN: StatusWords = {
  project: (id) => `Project ${id}`,
  idea: (t) => `Idea: ${t}`,
  created: () => "Status: created, not started yet.",
  running: (p, s) => `Status: in progress, ${p}${s ? `, sprint ${s}` : ""}.`,
  stopped: (r) => `Status: stopped. ${r ?? ""}`.trim(),
  paused: (r) => `Status: paused. ${r.charAt(0).toUpperCase()}${r.slice(1)}.`,
  waiting: () => "Status: waiting for you. It is built, and only needs a few things that only you can give:",
  giveWith: (id) => `Give them with: karigor setup ${id}`,
  finished: (stage, c, h) => `Status: ${stage ? `a stage was added (round ${c})` : c > 0 ? `updated (fix round ${c})` : "finished"}. ${h ?? ""}`.trim(),
  link: (u) => `Link: ${u}`,
  roundGrow: (c) => `Round ${c} builds the next stage on top of what is live.`,
  roundFix: (c) => `This is fix round ${c}: problems seen after release are being fixed.`,
  stages: () => "Stages:",
  stageMark: (s) => (s === "built" ? "[built]   " : s === "building" ? "[building]" : "[later]   "),
  growWith: (id) => `Build the next one with: karigor grow ${id}`,
  liveVersion: (v, u) => `Live version: ${v}${u ? ` at ${u}` : ""}.`,
  missingSettings: () => "It is online but cannot be used until these settings are added where it is hosted:",
  openItems: (n) => `Problems and requests waiting to be handled: ${n}.`,
  process: (t, p) => `Process: ${t}; building a ${p}.`,
  budget: (t) => `Budget tier: ${t}.`,
  work: (d, i, t, p, x) => `Work: ${d} done, ${i} in progress, ${t} to do, ${p} parked, ${x} replaced by smaller pieces.`,
  parked: (t, r) => `Parked: ${t}. ${r ?? ""}`.trim(),
  failures: (n) => `Problems caught by checks so far: ${n}.`,
  decisions: () => "Decisions made on your behalf (tell us if any is wrong):",
  corrected: (t) => `${t} (you corrected this)`,
};

export const STATUS_BN: StatusWords = {
  project: (id) => `প্রকল্প ${id}`,
  idea: (t) => `আইডিয়া: ${t}`,
  created: () => "অবস্থা: তৈরি হয়েছে, এখনো শুরু হয়নি।",
  running: (p, s) => `অবস্থা: কাজ চলছে, ${p}${s ? `, স্প্রিন্ট ${s}` : ""}।`,
  stopped: (r) => `অবস্থা: থেমে গেছে। ${r ? reasonIn("bn", r) : ""}`.trim(),
  paused: (r) => `অবস্থা: বিরতি। ${reasonIn("bn", r)}।`,
  waiting: () => "অবস্থা: আপনার অপেক্ষায়। তৈরি হয়ে গেছে, শুধু আপনিই দিতে পারেন এমন কয়েকটি জিনিস দরকার:",
  giveWith: (id) => `এগুলো দিন এভাবে: karigor setup ${id}`,
  finished: (stage, c, h) => `অবস্থা: ${stage ? `একটি নতুন অংশ যোগ হয়েছে (রাউন্ড ${c})` : c > 0 ? `হালনাগাদ হয়েছে (ঠিক করার রাউন্ড ${c})` : "শেষ হয়েছে"}। ${h ?? ""}`.trim(),
  link: (u) => `লিংক: ${u}`,
  roundGrow: (c) => `রাউন্ড ${c}: চালু অ্যাপের ওপর পরের অংশ তৈরি হচ্ছে।`,
  roundFix: (c) => `এটি ঠিক করার রাউন্ড ${c}: চালু হওয়ার পর পাওয়া সমস্যাগুলো ঠিক করা হচ্ছে।`,
  stages: () => "অংশগুলো:",
  stageMark: (s) => (s === "built" ? "[তৈরি হয়েছে]" : s === "building" ? "[তৈরি হচ্ছে]" : "[পরে]"),
  growWith: (id) => `পরের অংশ তৈরি করুন এভাবে: karigor grow ${id}`,
  liveVersion: (v, u) => `চালু সংস্করণ: ${v}${u ? `, ${u}` : ""}।`,
  missingSettings: () => "এটি অনলাইনে আছে, কিন্তু যেখানে চলে সেখানে এই সেটিংগুলো না দেওয়া পর্যন্ত ব্যবহার করা যাবে না:",
  openItems: (n) => `যেসব সমস্যা আর অনুরোধ এখনো বাকি: ${n}টি।`,
  process: (t, p) => `পদ্ধতি: ${t}; তৈরি হচ্ছে একটি ${BN.profile[p] ?? p}।`,
  budget: (t) => `বাজেট: ${BN.tier[t] ?? t} স্তর।`,
  work: (d, i, t, p, x) => `কাজ: ${d}টি শেষ, ${i}টি চলছে, ${t}টি বাকি, ${p}টি আলাদা করে রাখা, ${x}টি ছোট ভাগে ভাঙা।`,
  parked: (t, r) => `আলাদা করে রাখা: ${t}। ${r ? reasonIn("bn", r) : ""}`.trim(),
  failures: (n) => `এ পর্যন্ত যাচাইয়ে ধরা পড়া সমস্যা: ${n}টি।`,
  decisions: () => "আপনার হয়ে নেওয়া সিদ্ধান্ত (কোনোটি ভুল হলে জানান):",
  corrected: (t) => `${t} (আপনি বদলেছেন)`,
};

export const statusWords = (lang: Lang = "en"): StatusWords => (lang === "bn" ? STATUS_BN : STATUS_EN);

const PHASE_NOUN_BN: Record<string, string> = {
  specify: "লেখার", design: "নকশার", plan: "পরিকল্পনার", spike: "পরীক্ষার", build: "তৈরির", verify: "যাচাইয়ের", release: "চালু করার", triage: "বাছাইয়ের",
};
const phaseNoun = (p: string) => PHASE_NOUN_BN[p] ?? p;

/** Reasons the kernel writes when it stops, pauses or sets work aside, in Bangla. Unknown reasons are shown as written. */
const REASONS_BN: [RegExp, (...m: string[]) => string][] = [
  [/^gate "([^"]+)" failed in (\S+) after (\d+) failures$/, (g, p, n) => `যাচাই "${g}" ${phaseNoun(p!)} ধাপে ${n} বার ব্যর্থ হওয়ায় কাজ থামানো হলো`],
  [/^(\S+) could not produce valid work in (\S+) after (\d+) failures$/, (r, p, n) => `${role(r!)} ঠিকমতো কাজ দিতে পারেনি; ${phaseNoun(p!)} ধাপে ${n} বার চেষ্টার পর কাজ থামানো হলো`],
  [/^gate "([^"]+)" failed \(attempt (\d+)\)$/, (g, n) => `যাচাই "${g}" ব্যর্থ হয়েছে (চেষ্টা ${n})`],
  [/^gate "([^"]+)" failed; going back to (\S+)$/, (g, p) => `যাচাই "${g}" ব্যর্থ হয়েছে; ${phaseNoun(p!)} ধাপে ফেরত যাওয়া হচ্ছে`],
  [/^too many failures \((\d+)\); the failure budget is (\d+)$/, (n, m) => `অনেক বেশি ব্যর্থতা (${n}টি); সর্বোচ্চ ${m}টি চলে`],
  [/^there is no healthy preview to put live$/, () => "চালু করার মতো সুস্থ কোনো প্রিভিউ নেই"],
  [/^the new version failed after going live; the previous version \((\S+)\) is back and a fix is queued$/, (v) => `নতুন সংস্করণ চালু হওয়ার পর সমস্যা করছিল; আগের সংস্করণ (${v}) ফিরিয়ে আনা হয়েছে আর ঠিক করার কাজ তালিকায় রাখা হয়েছে`],
  [/^the new version failed after going live; it was taken offline and a fix is queued$/, () => "নতুন সংস্করণ চালু হওয়ার পর সমস্যা করছিল; এটি অফলাইনে নেওয়া হয়েছে আর ঠিক করার কাজ তালিকায় রাখা হয়েছে"],
  [/^out of budget: ?(.*)$/, (x) => `বাজেট শেষ${x ? `: ${x}` : ""}`],
  [/^the model's usage allowance is used up(?: \(it resets (.+?)\))?; nothing failed, and the work carries on with karigor resume after that$/, (at) => `মডেলের ব্যবহারের সীমা শেষ${at ? ` (আবার পাওয়া যাবে ${at})` : ""}; কিছু ব্যর্থ হয়নি, সীমা ফিরলে karigor resume দিলে কাজ চলবে`],
  [/^failed (\d+) times; retry budget exhausted$/, (n) => `${n} বার ব্যর্থ; আর চেষ্টার সুযোগ নেই`],
  [/^blocked: depends on "([^"]+)", which is not in the backlog$/, (d) => `আটকে আছে: "${d}"-এর ওপর নির্ভর করে, যা তালিকায় নেই`],
  [/^blocked: depends on "([^"]+)", which was (parked|dropped)$/, (d, s) => `আটকে আছে: "${d}"-এর ওপর নির্ভর করে, যা ${s === "parked" ? "আলাদা করে রাখা হয়েছে" : "বাদ দেওয়া হয়েছে"}`],
  [/^blocked: its dependencies form a cycle$/, () => "আটকে আছে: এর নির্ভরতাগুলো ঘুরে ঘুরে একে অপরের ওপর নির্ভর করে"],
];

/** A reason the kernel wrote, in the person's language. */
export function reasonIn(lang: Lang, reason: string): string {
  if (lang !== "bn") return reason;
  for (const [re, bn] of REASONS_BN) {
    const m = re.exec(reason);
    if (m) return bn(...m.slice(1));
  }
  return reason;
}
