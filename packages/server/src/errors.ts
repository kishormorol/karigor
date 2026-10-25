import type { Lang } from "@karigor/cli";

/** The chat API's error messages in Bangla, keyed by the English message. Anything unknown is shown as it came. */
const EXACT: Record<string, string> = {
  "that message is too long": "বার্তাটি অনেক লম্বা",
  "the request was not valid JSON": "অনুরোধটি ঠিকমতো পাঠানো হয়নি",
  "Karigor is busy with other projects; try again in a few minutes": "Karigor এখন অন্য প্রকল্পে ব্যস্ত; কয়েক মিনিট পরে আবার চেষ্টা করুন",
  "no such project": "এমন কোনো প্রকল্প নেই",
  "this Karigor uses your own Anthropic key; add it first": "এই Karigor আপনার নিজের Anthropic কী ব্যবহার করে; আগে সেটি যোগ করুন",
  "it is already being worked on from another window or the command line": "অন্য একটি উইন্ডো বা কমান্ড লাইন থেকে এটির কাজ এখনই চলছে",
  "every part of the plan is built": "পরিকল্পনার সব অংশ তৈরি হয়ে গেছে",
  "it is not finished yet": "এটি এখনো শেষ হয়নি",
  "it is being worked on right now; try again when this round finishes": "এখন এটির কাজ চলছে; এই রাউন্ড শেষ হলে আবার চেষ্টা করুন",
  "this Karigor does not put apps online, so there is nowhere to store settings": "এই Karigor অ্যাপ অনলাইনে তোলে না, তাই সেটিং রাখার কোনো জায়গা নেই",
  "not found": "পাওয়া যায়নি",
  "this Karigor needs an access link; ask whoever runs it": "এই Karigor খুলতে একটি প্রবেশ লিংক লাগে; যিনি এটি চালান তাকে জিজ্ঞেস করুন",
  "something went wrong on the server": "সার্ভারে কিছু একটা গোলমাল হয়েছে",
  "no decisions have been recorded yet": "এখনো কোনো সিদ্ধান্ত লেখা হয়নি",
};

const FIELDS: Record<string, string> = { idea: "আইডিয়া", text: "বার্তা", decisionId: "সিদ্ধান্ত", values: "সেটিং" };

const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^(\w+) is missing$/, (k) => `${FIELDS[k!] ?? k} দেওয়া হয়নি`],
  [/^(\w+) is too long \(at most (\d+) characters\)$/, (_k, n) => `লেখাটি অনেক লম্বা (সর্বোচ্চ ${n} অক্ষর)`],
  [/^there is no ready-made idea called "(.+)"; karigor starters lists them$/, (id) => `"${id}" নামে কোনো তৈরি আইডিয়া নেই`],
  [/^no decision (\S+) \(have: (.*)\)$/, (id, have) => `${id} নামে কোনো সিদ্ধান্ত নেই (আছে: ${have})`],
  [/^the app has no setting called (\S+) \(it has: (.*)\)$/, (k, has) => `অ্যাপে ${k} নামে কোনো সেটিং নেই (আছে: ${has})`],
];

/** An error message in the page's language. */
export function errorIn(lang: Lang, message: string): string {
  if (lang !== "bn") return message;
  const exact = EXACT[message];
  if (exact) return exact;
  for (const [re, bn] of PATTERNS) {
    const m = re.exec(message);
    if (m) return bn(...m.slice(1));
  }
  return message;
}
