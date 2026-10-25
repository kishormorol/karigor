import { describe, expect, it } from "vitest";
import { progressIn, reasonIn } from "../src/index.js";

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

describe("the progress log in Bangla", () => {
  it("translates each kind of line, keeps the indent, and leaves English and unknown lines alone", () => {
    const cases: [string, string][] = [
      ["selecting a process and a target", "পদ্ধতি আর কী তৈরি হবে তা বাছাই হচ্ছে"],
      ["budget: best tier, USD 0.00", "বাজেট: সেরা স্তর, USD 0.00"],
      ["entering specify", "শুরু হলো: কী বানাতে হবে তা লিখে রাখা"],
      ["specify: product-owner", "লেখার ধাপ: প্রোডাক্ট ওনার"],
      ["build: developer on roles-and-people (round 1)", "তৈরির ধাপ: ডেভেলপার (roles-and-people), আবার চেষ্টা 1"],
      ["build: gate skeptic-review on sms-count", 'তৈরির ধাপ: যাচাই "skeptic-review" (sms-count)'],
      ["build: sprint 2 with contacts-add-list, sms-connection", "তৈরির ধাপ: স্প্রিন্ট 2 শুরু: contacts-add-list, sms-connection"],
      ["specify -> design", "লেখার ধাপ শেষ, এবার নকশার ধাপ"],
      ['build -> back to plan: gate "journeys-pass" failed; going back to plan', 'তৈরির ধাপ থেকে পরিকল্পনার ধাপে ফেরত: যাচাই "journeys-pass" ব্যর্থ হয়েছে; পরিকল্পনার ধাপে ফেরত যাওয়া হচ্ছে'],
      ["done sms-count", "শেষ: sms-count"],
      ["  putting r1-c864ef4 live", "  r1-c864ef4 চালু করা হচ্ছে"],
      ["  live: http://localhost:3300", "  চালু: http://localhost:3300"],
      ["waiting 30 minutes for the usage allowance, then trying again", "ব্যবহারের সীমা ফেরার জন্য 30 মিনিট অপেক্ষা, তারপর আবার চেষ্টা"],
      ["fix round 1 ended: finished", "ঠিক করার রাউন্ড 1 শেষ: শেষ"],
      ["serving r2-fb84e96 at http://localhost:3300", "r2-fb84e96 চলছে: http://localhost:3300"],
    ];
    for (const [en, bn] of cases) expect(progressIn("bn", en), en).toBe(bn);
    expect(progressIn("en", "specify: product-owner")).toBe("specify: product-owner");
    expect(progressIn("bn", "something new")).toBe("something new");
  });
});
