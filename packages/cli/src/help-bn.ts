import type { Command } from "commander";

/** `karigor --help` in Bangla, keyed by the English description. Commander's own headings stay as they are. */
const HELP_BN: Record<string, string> = {
  "Software agents that take an idea to deployed, maintained software.": "সফটওয়্যার এজেন্টের একটি দল, যারা একটি আইডিয়াকে চালু আর রক্ষণাবেক্ষণ করা সফটওয়্যারে পরিণত করে।",
  "record an idea as a new project": "একটি আইডিয়াকে নতুন প্রকল্প হিসেবে লিখে রাখুন",
  "list ready-made ideas for common needs, or show one in full": "সাধারণ প্রয়োজনের তৈরি আইডিয়াগুলোর তালিকা, অথবা একটি পুরোটা দেখুন",
  "build the project until it is finished or stopped": "প্রকল্পটি শেষ বা থেমে যাওয়া পর্যন্ত তৈরি করুন",
  "continue a project after an interruption": "বাধা পড়ার পর প্রকল্পটি আবার চালু করুন",
  "tell Karigor about a problem or a wish; it becomes work for the next fix round": "Karigor-কে একটি সমস্যা বা চাওয়ার কথা বলুন; এটি পরের ঠিক করার রাউন্ডের কাজ হবে",
  "correct a decision Karigor made on your behalf": "আপনার হয়ে Karigor-এর নেওয়া একটি সিদ্ধান্ত বদলান",
  "give the live app the settings it still needs (a passcode, a database), in plain words": "চালু অ্যাপের এখনো দরকার এমন সেটিংগুলো দিন (একটি পাসকোড, একটি ডেটাবেস), সহজ কথায়",
  "close a reported problem or request that no longer needs doing": "জানানো এমন একটি সমস্যা বা অনুরোধ বন্ধ করুন যা আর করার দরকার নেই",
  "put a stopped project back to work: parked items return, then karigor resume carries on": "থেমে যাওয়া প্রকল্পকে আবার কাজে ফেরান: আলাদা করে রাখা কাজগুলো ফিরে আসে, তারপর karigor resume চালালে কাজ চলে",
  "add the current UI kit and theme to an app built from an older template (pages are restyled by a fix round)": "পুরোনো টেমপ্লেটে তৈরি অ্যাপে এখনকার নকশার উপকরণ আর থিম যোগ করুন (পেজগুলো একটি ঠিক করার রাউন্ডে নতুন করে সাজানো হয়)",
  "start a fix round now for every open problem and request": "সব খোলা সমস্যা আর অনুরোধের জন্য এখনই একটি ঠিক করার রাউন্ড শুরু করুন",
  "build the next stage of the plan on top of the live app (karigor status lists the stages)": "চালু অ্যাপের ওপর পরিকল্পনার পরের অংশ তৈরি করুন (karigor status অংশগুলোর তালিকা দেখায়)",
  "make the first admin (or a new link for an existing one): prints a one-time link to choose a password": "প্রথম অ্যাডমিন তৈরি করুন (অথবা আগের জনের জন্য নতুন লিংক): পাসওয়ার্ড বেছে নেওয়ার একবারের একটি লিংক দেখায়",
  "check the live app and its libraries; run a fix round when something is wrong": "চালু অ্যাপ আর তার লাইব্রেরিগুলো যাচাই করুন; কিছু ভুল হলে একটি ঠিক করার রাউন্ড চালান",
  "run the live app on this computer, watch it, and fix what breaks": "এই কম্পিউটারে চালু অ্যাপটি চালান, নজর রাখুন, আর যা ভাঙে তা ঠিক করুন",
  "where the project stands, in plain language": "প্রকল্পটি কোথায় আছে, সহজ কথায়",
  "what has been spent so far": "এ পর্যন্ত কত খরচ হয়েছে",
  "the story of what happened, or one artifact": "কী কী হয়েছে তার বিবরণ, অথবা একটি নথি",
  "set a piece of work aside": "একটি কাজ আলাদা করে রাখুন",
  "put a parked piece of work back": "আলাদা করে রাখা একটি কাজ ফিরিয়ে আনুন",
  "where projects live": "প্রকল্পগুলো যেখানে থাকে",
  "en or bn: the language Karigor writes to you in (default: the project's own language; KARIGOR_LANG)": "en বা bn: Karigor আপনাকে যে ভাষায় লিখবে (না দিলে প্রকল্পের নিজের ভাষা; KARIGOR_LANG)",
  "claude-code (your Claude Code login, no key), claude (API key), ollama (local, free) or demo (offline)": "claude-code (আপনার Claude Code লগইন, কী লাগে না), claude (API কী), ollama (এই কম্পিউটারে, বিনা খরচে) বা demo (ইন্টারনেট ছাড়া)",
  "free, cheap or best (asked once; default best for claude-code and ollama, which cost nothing per call; free for demo; cheap for claude)": "free, cheap বা best (একবারই জিজ্ঞেস করা হয়; claude-code আর ollama-র জন্য best, কারণ তাতে প্রতিবার খরচ নেই; demo-র জন্য free; claude-এর জন্য cheap)",
  "target profile for real builds": "আসল তৈরির জন্য কোন ধরনের সফটওয়্যার",
  "where releases go: local (this computer, free), vercel (VERCEL_TOKEN) or none; default: the project's last target, else local": "রিলিজ কোথায় যাবে: local (এই কম্পিউটার, বিনা খরচে), vercel (VERCEL_TOKEN) বা none; না দিলে প্রকল্পের আগের জায়গা, নইলে local",
  "port for the live app on the local target (default: the port it last went live on, else 3000)": "local-এ চালু অ্যাপের পোর্ট (না দিলে আগের বার যে পোর্টে চালু হয়েছিল, নইলে 3000)",
  "the idea, in plain language; with --starter, your changes to the ready-made idea": "আইডিয়াটি, সহজ কথায়; --starter দিলে তৈরি আইডিয়ায় আপনার পরিবর্তন",
  "start from a ready-made idea (see karigor starters)": "একটি তৈরি আইডিয়া থেকে শুরু করুন (karigor starters দেখুন)",
  "start building immediately": "এখনই তৈরি শুরু করুন",
  "a ready-made idea to show in full": "পুরোটা দেখার জন্য একটি তৈরি আইডিয়া",
  "when the usage allowance runs out, wait and try again every this many minutes (default 30) instead of stopping": "ব্যবহারের সীমা শেষ হলে না থেমে এত মিনিট পরপর অপেক্ষা করে আবার চেষ্টা করুন (না দিলে ৩০)",
  "what is wrong or what you would like, in your own words": "কী ভুল বা আপনি কী চান, নিজের ভাষায়",
  "the decision's id from karigor status, like a3": "karigor status থেকে সিদ্ধান্তের আইডি, যেমন a3",
  "what it should be instead": "এর বদলে কী হওয়া উচিত",
  "give a setting's value without being asked (repeatable)": "জিজ্ঞেস না করেই একটি সেটিংয়ের মান দিন (কয়েকবার দেওয়া যায়)",
  "from karigor status": "karigor status থেকে",
  "why it no longer needs doing": "কেন এটি আর করার দরকার নেই",
  "keep going until every stage is built": "সব অংশ তৈরি না হওয়া পর্যন্ত চালিয়ে যান",
  "keep watching, checking this often": "নজর রাখুন, এত সময় পরপর যাচাই করে",
  "the address to check (default: the live app, for hosted targets)": "যে ঠিকানা যাচাই করা হবে (না দিলে অনলাইনে চালু অ্যাপ)",
  "how often to look for problems": "কত সময় পরপর সমস্যা খোঁজা হবে",
  "show one artifact instead of the story": "বিবরণের বদলে একটি নথি দেখান",
  why: "কেন",
  "display help for command": "এই কমান্ডের সাহায্য দেখান",
  "output the version number": "সংস্করণ নম্বর দেখান",
};

const bn = (s: string | undefined) => (s ? HELP_BN[s] ?? s : s);

/** Put `--help` in Bangla: every command, argument and option description that has a Bangla version. */
export function localizeHelp(cmd: Command): void {
  cmd.description(bn(cmd.description()) ?? "");
  for (const o of cmd.options) o.description = bn(o.description) ?? "";
  for (const a of cmd.registeredArguments) a.description = bn(a.description) ?? "";
  cmd.helpOption("-h, --help", HELP_BN["display help for command"]);
  for (const c of cmd.commands) localizeHelp(c);
}
