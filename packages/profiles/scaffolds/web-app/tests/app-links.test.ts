import { describe, expect, it } from "vitest";
import { assetLinks } from "@/lib/app-links";

const FP = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase().padStart(2, "0")).join(":");

describe("Android app links", () => {
  it("are empty until Karigor makes the phone apps", () => {
    expect(assetLinks(undefined)).toEqual([]);
    expect(assetLinks("not a setting")).toEqual([]);
    expect(assetLinks("app.karigor.shop:not-a-fingerprint")).toEqual([]);
  });

  it("name the package and every signing fingerprint", () => {
    const [s] = assetLinks(`app.karigor.shop:${FP.toLowerCase()}, ${FP}`) as { target: { package_name: string; sha256_cert_fingerprints: string[] } }[];
    expect(s!.target.package_name).toBe("app.karigor.shop");
    expect(s!.target.sha256_cert_fingerprints).toEqual([FP, FP]);
  });
});
