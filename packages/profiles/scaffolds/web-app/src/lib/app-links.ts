/**
 * The statement Android checks before it opens this app's phone app full screen (without an address bar).
 * ANDROID_APP_LINKS is set by Karigor when it makes the phone apps: "<package>:<SHA-256 fingerprint>[,<fingerprint>…]".
 */
export function assetLinks(setting: string | undefined = process.env.ANDROID_APP_LINKS): unknown[] {
  const m = /^\s*([A-Za-z][\w.]*)\s*:\s*(.+)$/.exec(setting ?? "");
  if (!m) return [];
  const fingerprints = m[2]!.split(",").map((f) => f.trim().toUpperCase()).filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (!fingerprints.length) return [];
  return [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: m[1], sha256_cert_fingerprints: fingerprints } }];
}
