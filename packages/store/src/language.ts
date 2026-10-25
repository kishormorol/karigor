import type { ProjectState } from "./replay.js";
import type { TargetProfile } from "./schemas/index.js";

/** A language the person may read, other than English. */
export type PersonLanguage = "Bangla";

/**
 * The language a piece of the person's writing is in, when it is not English: Bangla when Bengali letters
 * outnumber Latin ones ("বিকাশে দাম দেন" counts as Bangla even with a Latin word in it).
 */
export function languageOf(text: string): PersonLanguage | undefined {
  const bengali = text.match(/[ঀ-৿]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return bengali > 0 && bengali >= latin ? "Bangla" : undefined;
}

/** The language of the project's idea, which is the language everything the person reads is written in. */
export async function ideaLanguage(
  state: Pick<ProjectState, "ideaId">,
  store: { readArtifact(kind: "idea", id: string): Promise<{ meta: { text: string; locale?: string } }> },
): Promise<PersonLanguage | undefined> {
  if (!state.ideaId) return undefined;
  try {
    const { text, locale } = (await store.readArtifact("idea", state.ideaId)).meta;
    // Recorded when the project was made; older projects only have the text to go on.
    return locale === "bn" ? "Bangla" : languageOf(text);
  } catch {
    return undefined;
  }
}

/** The line added to every agent's instructions when the person reads a language other than English. */
export function languageNote(lang: PersonLanguage | undefined): string {
  if (!lang) return "";
  return `\n\n## Language\n\nThe person reads ${lang}. Write everything they will read in ${lang}: titles, goals and descriptions, assumptions and decisions, the reasons for a verdict, summaries, work-item and backlog titles, and anything else in plain words. Code, identifiers, ids, file names, commit messages, test names and other technical text stay in English. The app's own screens use the language the spec chose.`;
}

/** Each kind of software, described in Bangla for the decisions the person reads. */
export const TARGET_PROFILES_BN: Record<TargetProfile, string> = {
  "web-app": "একটি ওয়েবসাইট বা ওয়েব অ্যাপ, ব্যাকএন্ড আর ডেটাবেসসহ, যা ফোন বা কম্পিউটারের ব্রাউজারে চলে।",
  "static-site": "ব্যাকএন্ড ছাড়া একটি সাইট: ল্যান্ডিং পেজ, পোর্টফোলিও, তথ্যপাতা, অন্য সেবার মাধ্যমে সহজ ফর্ম।",
  api: "একটি ব্যাকএন্ড সেবা যা অন্য প্রোগ্রাম ব্যবহার করে; কোনো স্ক্রিন নেই।",
  cli: "টার্মিনালে চালানোর একটি কমান্ড-লাইন টুল।",
  "mobile-app": "ফোনে ইনস্টল করার একটি অ্যাপ (আইওএস বা অ্যান্ড্রয়েড)।",
  "ml-model": "একটি প্রশিক্ষিত মডেল বা ডেটা পাইপলাইন, ব্যবহারের জন্য ছোট একটি স্ক্রিনসহ।",
};
