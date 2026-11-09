import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { androidString, liveAppInfo, makePhoneApps, packageIdFor, phoneBuildFile, phoneFiles, phoneState, signingKey, type PhoneAppInfo, type PhoneExec } from "../src/index.js";

const run = promisify(execFile);
const has = (cmd: string) => run("which", [cmd]).then(() => true, () => false);

const INFO: PhoneAppInfo = {
  name: "Rina's \"Best\" Shop & Co",
  shortName: "Rina's Shop",
  url: "https://rinas-shop-a1b2c3.vercel.app",
  packageId: "app.karigor.rinas_shop_a1b2c3",
  themeColor: "#0e5e55",
  backgroundColor: "#fff",
  icon: "https://rinas-shop-a1b2c3.vercel.app/icon.svg",
  versionCode: 3,
  versionName: "1.3",
  offline: { title: "No connection", text: "Check the phone's internet.", retry: "Try again" },
};

describe("the phone apps' files", () => {
  it("give each app a package id stores accept", () => {
    expect(packageIdFor("rinas-shop-a1b2c3")).toBe("app.karigor.rinas_shop_a1b2c3");
    expect(packageIdFor("123-go")).toBe("app.karigor.a123_go");
    expect(packageIdFor("---")).toBe("app.karigor.app");
  });

  it("open the live app, carry its name, colours and version, and escape what the person typed", () => {
    const f = phoneFiles(INFO);
    expect(f["android/app/src/main/AndroidManifest.xml"]).toContain('android:value="https://rinas-shop-a1b2c3.vercel.app/"');
    expect(f["android/app/src/main/AndroidManifest.xml"]).toContain('android:host="rinas-shop-a1b2c3.vercel.app"');
    expect(f["android/app/build.gradle"]).toMatch(/applicationId "app\.karigor\.rinas_shop_a1b2c3"[\s\S]*versionCode 3[\s\S]*versionName "1\.3"/);
    expect(f["android/app/src/main/res/values/strings.xml"]).toContain(`<string name="app_name">Rina\\'s Shop</string>`);
    expect(f["android/app/src/main/res/values/colors.xml"]).toContain("#ffffff");
    expect(f["ios/App/Info.plist"]).toContain("<key>KarigorAppURL</key><string>https://rinas-shop-a1b2c3.vercel.app/</string>");
    expect(f["ios/project.yml"]).toContain('PRODUCT_BUNDLE_IDENTIFIER: "app.karigor.rinas_shop_a1b2c3"');
    expect(JSON.parse(f["phone.json"]!)).toMatchObject({ versionCode: 3, icon: INFO.icon });
    expect(androidString('@a "b" \\ <c>')).toBe('\\@a \\"b\\" \\\\ &lt;c&gt;');
  });

  it("keep the signing key out of the files: the build reads it from the repository's secrets", () => {
    const f = phoneFiles(INFO);
    expect(f[".github/workflows/phone-apps.yml"]).toContain("${{ secrets.ANDROID_KEYSTORE_B64 }}");
    expect(f[".github/workflows/phone-apps.yml"]).not.toMatch(/\$\{\{\s*(github\.event|inputs)/);
    expect(f[".gitignore"]).toMatch(/\*\.p12/);
    expect(f["scripts/icons.sh"]).toContain("${LETTER:-A}");
  });

  it("refuse an address that is not https, and a package id stores would not take", () => {
    expect(() => phoneFiles({ ...INFO, url: "http://localhost:3000" })).toThrow(/https/);
    expect(() => phoneFiles({ ...INFO, packageId: "App.Bad-Id" })).toThrow(/not a valid package id/);
  });

  it.runIf(process.env["KARIGOR_PHONE_LINT"] === "1")("are valid XML and plist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karigor-phone-files-"));
    for (const [p, c] of Object.entries(phoneFiles(INFO))) {
      await mkdir(join(dir, p, ".."), { recursive: true });
      await writeFile(join(dir, p), c);
    }
    for (const p of ["android/app/src/main/AndroidManifest.xml", "android/app/src/main/res/values/strings.xml", "ios/App/Info.plist"]) await run("xmllint", ["--noout", join(dir, p)]);
    await run("plutil", ["-lint", join(dir, "ios/App/Info.plist")]);
  });
});

describe("the live app's look", () => {
  it("comes from its web manifest, with the biggest icon, and falls back when there is none", async () => {
    const manifest = { name: "Rina's Shop", short_name: "Rina", theme_color: "#123456", background_color: "nonsense", icons: [{ src: "/small.png", sizes: "48x48" }, { src: "/icon.svg", sizes: "any" }] };
    const fetcher = (async (u: URL) => (String(u).endsWith("/manifest.webmanifest") ? new Response(JSON.stringify(manifest)) : new Response("", { status: 404 }))) as unknown as typeof fetch;
    expect(await liveAppInfo("https://shop.vercel.app", fetcher)).toEqual({ name: "Rina's Shop", shortName: "Rina", themeColor: "#123456", backgroundColor: "#ffffff", icon: "https://shop.vercel.app/icon.svg" });
    const none = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    expect(await liveAppInfo("https://shop.vercel.app", none)).toEqual({ name: "shop", shortName: "shop", themeColor: "#0e5e55", backgroundColor: "#ffffff" });
  });
});

describe.runIf(process.platform !== "win32")("the Android signing key", { timeout: 60_000 }, () => {
  it("is made once, kept private and out of git, and Java reads it with the same fingerprint", async () => {
    if (!(await has("openssl"))) return;
    const dir = await mkdtemp(join(tmpdir(), "karigor-signing-"));
    const k = await signingKey(dir, "Rina's Shop");
    expect(k.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect((await signingKey(dir, "Rina's Shop")).fingerprint).toBe(k.fingerprint);
    expect((await stat(k.file)).mode & 0o777).toBe(0o600);
    expect(await stat(join(dir, "phone-signing", "upload.key")).then(() => true, () => false)).toBe(false);
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toContain("phone-signing/");
    if (await has("keytool")) {
      const { stdout } = await run("keytool", ["-list", "-v", "-keystore", k.file, "-storetype", "pkcs12", "-storepass", k.password]);
      expect(stdout).toMatch(/Alias name: upload/);
      expect(stdout).toContain(k.fingerprint);
    }
  });
});

/** GitHub, git and OpenSSL as a script: what each call returns, and a record of what was asked. */
function fakeTools(o: { run?: { status: string; conclusion: string }; loggedIn?: boolean; repoExists?: boolean } = {}) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const exec: PhoneExec = async (cmd, args, opts) => {
    calls.push({ cmd, args, ...(opts.input ? { input: opts.input } : {}) });
    const ok = (stdout = "") => ({ stdout, stderr: "", code: 0 });
    if (cmd === "openssl") {
      if (args[0] === "req") {
        await writeFile(args[args.indexOf("-keyout") + 1]!, "key");
        await writeFile(args[args.indexOf("-out") + 1]!, "cert");
      }
      if (args[0] === "pkcs12") await writeFile(args[args.indexOf("-out") + 1]!, "p12-bytes");
      if (args[0] === "x509") return ok(`sha256 Fingerprint=${Array(32).fill("AB").join(":")}\n`);
      return ok();
    }
    if (cmd === "git") return ok(args.includes("rev-parse") ? "abc123\n" : "");
    if (cmd === "gh") {
      if (args[0] === "api") return o.loggedIn === false ? { stdout: "", stderr: "not logged in", code: 1 } : ok("rina\n");
      if (args[0] === "repo" && args[1] === "view") return o.repoExists ? ok("{}") : { stdout: "", stderr: "not found", code: 1 };
      if (args[0] === "run" && args[1] === "list") return ok(JSON.stringify([{ databaseId: 7, url: "https://github.com/rina/x/actions/runs/7", ...(o.run ?? { status: "completed", conclusion: "success" }) }]));
      if (args[0] === "run" && args[1] === "download") {
        const out = args[args.indexOf("--dir") + 1]!;
        await mkdir(join(out, "android"), { recursive: true });
        await mkdir(join(out, "ios"), { recursive: true });
        await writeFile(join(out, "android", "app-release.apk"), "apk");
        await writeFile(join(out, "android", "app-release.aab"), "aab");
        await writeFile(join(out, "ios", "App-simulator.zip"), "zip");
      }
      return ok();
    }
    return { stdout: "", stderr: `unexpected ${cmd}`, code: 1 };
  };
  return { exec, calls };
}

const noManifest = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;

describe("making the phone apps", () => {
  it("keeps a private repository, passes the key as secrets on standard input, builds, downloads, and switches on Android's trust", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karigor-phone-"));
    const { exec, calls } = fakeTools();
    const links: string[] = [];
    const s = await makePhoneApps({ projectDir: dir, slug: "rinas-shop-a1b2c3", url: "https://rinas-shop-a1b2c3.vercel.app/", exec, fetcher: noManifest, pollMs: 1, setAppLinks: async (v) => (links.push(v), { ok: true, output: "" }) });
    expect(s).toMatchObject({ status: "ready", repo: "rina/rinas-shop-a1b2c3-phone", packageId: "app.karigor.rinas_shop_a1b2c3", versionCode: 1 });
    expect(s.files?.map((f) => f.path).sort()).toEqual(["v1/android/app-release.aab", "v1/android/app-release.apk", "v1/ios/App-simulator.zip"]);
    expect(calls.some((c) => c.cmd === "gh" && c.args.join(" ") === "repo create rina/rinas-shop-a1b2c3-phone --private --description Phone apps for rinas-shop-a1b2c3.vercel.app, made by Karigor")).toBe(true);
    const secrets = calls.filter((c) => c.cmd === "gh" && c.args[0] === "secret");
    expect(secrets.map((c) => c.args[2])).toEqual(["ANDROID_KEYSTORE_B64", "ANDROID_KEYSTORE_PASSWORD"]);
    expect(secrets[0]!.input).toBe(Buffer.from("p12-bytes").toString("base64"));
    // no secret ever appears as an argument
    const password = (await readFile(join(dir, "phone-signing", "password"), "utf8")).trim();
    expect(calls.some((c) => c.args.some((a) => a.includes(password)))).toBe(false);
    expect(links).toEqual([`app.karigor.rinas_shop_a1b2c3:${Array(32).fill("AB").join(":")}`]);
    expect(await readFile(join(dir, "phone", "android", "app", "src", "main", "AndroidManifest.xml"), "utf8")).toContain("rinas-shop-a1b2c3.vercel.app");
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toMatch(/phone\/[\s\S]*phone-builds\//);
    expect(await phoneBuildFile(dir, "v1/android/app-release.apk")).toBe(join(dir, "phone-builds", "v1", "android", "app-release.apk"));
    expect(await phoneBuildFile(dir, "../phone-signing/password")).toBeUndefined();

    // the next time: a new version, the same repository, and the app is not redeployed for the same key
    const again = fakeTools({ repoExists: true });
    const s2 = await makePhoneApps({ projectDir: dir, slug: "rinas-shop-a1b2c3", url: "https://rinas-shop-a1b2c3.vercel.app", exec: again.exec, fetcher: noManifest, pollMs: 1, setAppLinks: async (v) => (links.push(v), { ok: true, output: "" }) });
    expect(s2).toMatchObject({ status: "ready", versionCode: 2 });
    expect(again.calls.some((c) => c.args[0] === "repo" && c.args[1] === "create")).toBe(false);
    expect(links).toHaveLength(1);
    expect((await phoneState(dir))?.files?.[0]?.path).toMatch(/^v2\//);
  });

  it("says plainly what is missing, and keeps the failure for the page", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karigor-phone-"));
    await expect(makePhoneApps({ projectDir: dir, slug: "x", url: "http://localhost:3000", exec: fakeTools().exec })).rejects.toThrow(/https address/);
    const s = await makePhoneApps({ projectDir: dir, slug: "x", url: "https://x.vercel.app", exec: fakeTools({ loggedIn: false }).exec, fetcher: noManifest });
    expect(s).toMatchObject({ status: "failed", error: expect.stringMatching(/gh auth login/) });
    const failed = await makePhoneApps({ projectDir: dir, slug: "x", url: "https://x.vercel.app", exec: fakeTools({ run: { status: "completed", conclusion: "failure" } }).exec, fetcher: noManifest, pollMs: 1 });
    expect(failed).toMatchObject({ status: "failed", error: expect.stringMatching(/cloud build failed \(failure\); see https:\/\/github.com/) });
    expect((await phoneState(dir))?.status).toBe("failed");
  });
});

/** The real thing: a private repository on the signed-in GitHub account and a cloud build. KARIGOR_REAL_PHONE=<https app address>. */
describe.runIf(!!process.env["KARIGOR_REAL_PHONE"])("making the phone apps (live, GitHub)", () => {
  it("builds the Android app and the iPhone simulator app in the cloud and downloads them", async () => {
    const dir = process.env["KARIGOR_REAL_PHONE_DIR"] || (await mkdtemp(join(tmpdir(), "karigor-real-phone-")));
    const s = await makePhoneApps({ projectDir: dir, slug: process.env["KARIGOR_REAL_PHONE_SLUG"] || "karigor-phone-smoke", url: process.env["KARIGOR_REAL_PHONE"]!, log: (l) => console.log(l) });
    expect(s.error ?? "", s.runUrl).toBe("");
    expect(s.files?.map((f) => f.path.split("/").at(-1)).sort()).toEqual(["App-simulator.zip", "app-release.aab", "app-release.apk", "play-512.png"]);
  }, 60 * 60 * 1000);
});
