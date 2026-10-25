import { describe, expect, it } from "vitest";
import { reasonIn } from "../src/index.js";

describe("kernel reasons in Bangla", () => {
  it("translates every reason the kernel writes, and leaves English and unknown reasons as they are", () => {
    const cases: [string, RegExp][] = [
      ['gate "journeys-pass" failed in build after 3 failures', /^যাচাই "journeys-pass" তৈরির ধাপে 3 বার ব্যর্থ হওয়ায় কাজ থামানো হলো$/],
      ["developer could not produce valid work in build after 4 failures", /^ডেভেলপার ঠিকমতো কাজ দিতে পারেনি; তৈরির ধাপে 4 বার/],
      ["too many failures (16); the failure budget is 15", /^অনেক বেশি ব্যর্থতা \(16টি\); সর্বোচ্চ 15টি চলে$/],
      ["the model's usage allowance is used up (it resets 11:10pm); nothing failed, and the work carries on with karigor resume after that", /^মডেলের ব্যবহারের সীমা শেষ \(আবার পাওয়া যাবে 11:10pm\); কিছু ব্যর্থ হয়নি/],
      ["the model's usage allowance is used up; nothing failed, and the work carries on with karigor resume after that", /^মডেলের ব্যবহারের সীমা শেষ; কিছু ব্যর্থ হয়নি/],
      ["the new version failed after going live; the previous version (r2-abc) is back and a fix is queued", /আগের সংস্করণ \(r2-abc\) ফিরিয়ে আনা হয়েছে/],
      ["out of budget: build has no money left", /^বাজেট শেষ: build has no money left$/],
      ["failed 3 times; retry budget exhausted", /^3 বার ব্যর্থ; আর চেষ্টার সুযোগ নেই$/],
      ['blocked: depends on "b1", which was parked', /^আটকে আছে: "b1"-এর ওপর নির্ভর করে, যা আলাদা করে রাখা হয়েছে$/],
      ["blocked: its dependencies form a cycle", /^আটকে আছে:/],
      ["there is no healthy preview to put live", /^চালু করার মতো সুস্থ কোনো প্রিভিউ নেই$/],
    ];
    for (const [en, bn] of cases) expect(reasonIn("bn", en), en).toMatch(bn);
    expect(reasonIn("en", 'gate "x" failed in build after 3 failures')).toBe('gate "x" failed in build after 3 failures');
    expect(reasonIn("bn", "something the kernel never says")).toBe("something the kernel never says");
  });
});
