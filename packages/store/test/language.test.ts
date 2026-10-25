import { describe, expect, it } from "vitest";
import { ideaLanguage, languageNote, languageOf } from "../src/index.js";

describe("the person's language", () => {
  it("is Bangla when Bengali letters outnumber Latin ones, even with a brand name in English", () => {
    expect(languageOf("আমার দোকানের জন্য একটি হিসাবের খাতা, বিকাশ আর Nagad সহ")).toBe("Bangla");
    expect(languageOf("A shop counter for my grocery, with bKash")).toBeUndefined();
    expect(languageOf("A shop counter. আমার দোকান.")).toBeUndefined();
    expect(languageOf("")).toBeUndefined();
  });

  it("comes from the idea: its recorded locale first, then its words", async () => {
    const store = (meta: { text: string; locale?: string }) => ({ readArtifact: async () => ({ meta }) });
    expect(await ideaLanguage({ ideaId: "i1" }, store({ text: "Tools for neighbours", locale: "bn" }))).toBe("Bangla");
    expect(await ideaLanguage({ ideaId: "i1" }, store({ text: "প্রতিবেশীদের যন্ত্রপাতি", locale: "en" }))).toBe("Bangla");
    expect(await ideaLanguage({ ideaId: "i1" }, store({ text: "Tools for neighbours" }))).toBeUndefined();
    expect(await ideaLanguage({}, store({ text: "প্রতিবেশীদের যন্ত্রপাতি" }))).toBeUndefined();
  });

  it("tells agents what to write in the person's language and what stays English", () => {
    expect(languageNote(undefined)).toBe("");
    const note = languageNote("Bangla");
    expect(note).toMatch(/The person reads Bangla/);
    expect(note).toMatch(/assumptions and decisions, the reasons for a verdict, summaries/);
    expect(note).toMatch(/Code, identifiers, ids, file names, commit messages.*stay in English/);
  });
});
