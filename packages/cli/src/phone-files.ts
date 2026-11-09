/**
 * The phone apps for a web app that is online: an Android app (a Trusted Web Activity, the way Google
 * recommends putting a web app in the Play Store) and an iPhone app (a web view with pull-to-refresh, an
 * offline screen and links to other apps). Both open the live app; nothing is copied into them, so
 * every new release reaches the phones at once. They are built in the cloud (GitHub Actions).
 */

export interface PhoneAppInfo {
  /** Shown under the icon. */
  name: string;
  shortName: string;
  /** The live app, https. */
  url: string;
  /** Android application id and iOS bundle id, e.g. `app.karigor.shop_a1b2c3`. */
  packageId: string;
  themeColor: string;
  backgroundColor: string;
  /** Absolute address of the app's icon (SVG or PNG); a plain icon with the first letter when absent. */
  icon?: string;
  /** Goes up by one on every build; stores refuse a number they have seen. */
  versionCode: number;
  versionName: string;
  /** Words on the iPhone app's offline screen, in the app's language. */
  offline: { title: string; text: string; retry: string };
}

/** A package id stores accept: lower-case letters, digits and underscores, each part starting with a letter. */
export function packageIdFor(slug: string): string {
  const part = slug.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "a$1") || "app";
  return `app.karigor.${part}`;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
export function safeColor(c: unknown, fallback: string): string {
  if (typeof c !== "string") return fallback;
  const t = c.trim();
  if (COLOR.test(t)) return t.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(t)) return `#${[...t.slice(1)].map((x) => x + x).join("")}`.toLowerCase();
  return fallback;
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** A string resource: XML-escaped, and Android's own escapes for quotes, apostrophes and a leading @ or ?. */
export const androidString = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/^([@?])/, "\\$1");
const plist = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const yamlString = (s: string) => JSON.stringify(s);

/** Every file of the phone apps' repository, by path. */
export function phoneFiles(info: PhoneAppInfo): Record<string, string> {
  const u = new URL(info.url);
  if (u.protocol !== "https:") throw new Error("phone apps need the app at an https address");
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(info.packageId)) throw new Error(`"${info.packageId}" is not a valid package id`);
  const host = u.host;
  const start = `${u.origin}/`;
  const theme = safeColor(info.themeColor, "#0e5e55");
  const bg = safeColor(info.backgroundColor, "#ffffff");
  return {
    "phone.json": JSON.stringify({ name: info.name, shortName: info.shortName, url: start, packageId: info.packageId, themeColor: theme, backgroundColor: bg, icon: info.icon ?? "", versionCode: info.versionCode, versionName: info.versionName }, null, 2) + "\n",
    "README.md": `# ${info.name}: phone apps

Made by Karigor. Both apps open ${start}; a new release of the app reaches the phones without a new build.

- \`android/\`: the Android app (a Trusted Web Activity). The build makes \`app-release.aab\` for the Play Store and \`app-release.apk\` to install directly.
- \`ios/\`: the iPhone app (a web view). The build makes a simulator app; an App Store build needs an Apple Developer account.
- \`.github/workflows/phone-apps.yml\` builds both on every push. The Android signing key is a secret of this repository; Karigor keeps the original.

Karigor writes these files again each time it makes the apps; change the app itself, not these files.
`,
    ".gitignore": "build/\nout/\n.gradle/\nandroid/app/build/\nios/build/\nios/App.xcodeproj/\n*.p12\n*.jks\n",
    "scripts/icons.sh": ICONS_SH,
    ".github/workflows/phone-apps.yml": WORKFLOW,

    "android/settings.gradle": `pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositories { google(); mavenCentral() }
}
rootProject.name = "app"
include ":app"
`,
    "android/build.gradle": `plugins {
    id "com.android.application" version "8.11.1" apply false
}
`,
    "android/gradle.properties": "org.gradle.jvmargs=-Xmx2g\nandroid.useAndroidX=true\n",
    "android/app/build.gradle": `plugins {
    id "com.android.application"
}

android {
    namespace "${info.packageId}"
    compileSdk 36

    defaultConfig {
        applicationId "${info.packageId}"
        minSdk 23
        targetSdk 36
        versionCode ${Math.max(1, Math.floor(info.versionCode))}
        versionName ${JSON.stringify(info.versionName)}
    }

    signingConfigs {
        release {
            // The key comes from the repository's secrets in the cloud build; it is never in the code.
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH") ?: "missing-key.p12")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias "upload"
            keyPassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            storeType "pkcs12"
        }
    }

    buildTypes {
        release {
            minifyEnabled false
            signingConfig signingConfigs.release
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    implementation "com.google.androidbrowserhelper:androidbrowserhelper:2.5.0"
}
`,
    "android/app/src/main/AndroidManifest.xml": `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />

    <queries>
        <intent>
            <action android:name="android.support.customtabs.action.CustomTabsService" />
        </intent>
    </queries>

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.Translucent.NoTitleBar">

        <meta-data android:name="asset_statements" android:resource="@string/asset_statements" />

        <activity
            android:name="com.google.androidbrowserhelper.trusted.LauncherActivity"
            android:exported="true"
            android:label="@string/app_name">
            <meta-data android:name="android.support.customtabs.trusted.DEFAULT_URL" android:value="${xml(start)}" />
            <meta-data android:name="android.support.customtabs.trusted.STATUS_BAR_COLOR" android:resource="@color/theme" />
            <meta-data android:name="android.support.customtabs.trusted.NAVIGATION_BAR_COLOR" android:resource="@color/background" />
            <meta-data android:name="android.support.customtabs.trusted.FALLBACK_STRATEGY" android:value="customtabs" />

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${xml(host)}" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
    "android/app/src/main/res/values/strings.xml": `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${androidString(info.shortName)}</string>
    <string name="asset_statements" translatable="false">[{ \\"relation\\": [\\"delegate_permission/common.handle_all_urls\\"], \\"target\\": { \\"namespace\\": \\"web\\", \\"site\\": \\"${xml(u.origin)}\\" } }]</string>
</resources>
`,
    "android/app/src/main/res/values/colors.xml": `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="theme">${theme}</color>
    <color name="background">${bg}</color>
</resources>
`,

    "ios/project.yml": `name: App
options:
  bundleIdPrefix: app.karigor
  deploymentTarget:
    iOS: "16.0"
targets:
  App:
    type: application
    platform: iOS
    sources: [App]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: ${yamlString(info.packageId)}
        MARKETING_VERSION: ${yamlString(info.versionName)}
        CURRENT_PROJECT_VERSION: ${yamlString(String(info.versionCode))}
        INFOPLIST_FILE: App/Info.plist
        GENERATE_INFOPLIST_FILE: NO
        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
        TARGETED_DEVICE_FAMILY: "1,2"
        SWIFT_VERSION: "5.0"
`,
    "ios/App/Info.plist": `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>$(DEVELOPMENT_LANGUAGE)</string>
    <key>CFBundleDisplayName</key><string>${plist(info.shortName)}</string>
    <key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
    <key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
    <key>LSRequiresIPhoneOS</key><true/>
    <key>UILaunchScreen</key><dict><key>UIColorName</key><string>LaunchBackground</string></dict>
    <key>UISupportedInterfaceOrientations</key>
    <array><string>UIInterfaceOrientationPortrait</string><string>UIInterfaceOrientationLandscapeLeft</string><string>UIInterfaceOrientationLandscapeRight</string></array>
    <key>UISupportedInterfaceOrientations~ipad</key>
    <array><string>UIInterfaceOrientationPortrait</string><string>UIInterfaceOrientationPortraitUpsideDown</string><string>UIInterfaceOrientationLandscapeLeft</string><string>UIInterfaceOrientationLandscapeRight</string></array>
    <key>ITSAppUsesNonExemptEncryption</key><false/>
    <key>NSCameraUsageDescription</key><string>To take a photo to add in the app.</string>
    <key>NSPhotoLibraryUsageDescription</key><string>To choose a photo to add in the app.</string>
    <key>KarigorAppURL</key><string>${plist(start)}</string>
    <key>KarigorOfflineTitle</key><string>${plist(info.offline.title)}</string>
    <key>KarigorOfflineText</key><string>${plist(info.offline.text)}</string>
    <key>KarigorRetry</key><string>${plist(info.offline.retry)}</string>
</dict>
</plist>
`,
    "ios/App/App.swift": IOS_SWIFT,
    "ios/App/Assets.xcassets/Contents.json": JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2) + "\n",
    "ios/App/Assets.xcassets/AppIcon.appiconset/Contents.json": JSON.stringify({ images: [{ filename: "icon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" }], info: { author: "xcode", version: 1 } }, null, 2) + "\n",
    "ios/App/Assets.xcassets/LaunchBackground.colorset/Contents.json": JSON.stringify({ colors: [{ color: { "color-space": "srgb", components: rgb(bg) }, idiom: "universal" }], info: { author: "xcode", version: 1 } }, null, 2) + "\n",
  };
}

function rgb(hex: string): Record<string, string> {
  const n = (i: number) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3);
  return { red: n(1), green: n(3), blue: n(5), alpha: "1.000" };
}

/** Launcher icons from the app's own icon, padded on its background colour; a plain one with its first letter when there is none. */
const ICONS_SH = `#!/usr/bin/env bash
# Makes the launcher icons into build/icons from phone.json. Needs jq, curl, rsvg-convert and ImageMagick.
set -euo pipefail
cd "$(dirname "$0")/.."
IM="$(command -v magick || command -v convert)"
ICON="$(jq -r .icon phone.json)"
BG="$(jq -r .backgroundColor phone.json)"
THEME="$(jq -r .themeColor phone.json)"
LETTER="$(jq -r .shortName phone.json | cut -c1 | tr '[:lower:]' '[:upper:]')"
mkdir -p build/icons/ios
raw=build/icon-raw.png
made=""
if [ -n "$ICON" ] && curl -fsSL --max-time 30 "$ICON" -o build/icon.src; then
  if head -c 512 build/icon.src | grep -qi "<svg"; then
    rsvg-convert -w 1024 -h 1024 -a build/icon.src -o "$raw" && made=1
  else
    "$IM" build/icon.src -resize 1024x1024 "$raw" && made=1
  fi
fi
if [ -n "$made" ]; then
  "$IM" "$raw" -resize 720x720 -background "$BG" -gravity center -extent 1024x1024 -alpha remove -alpha off build/icon-1024.png
else
  "$IM" -size 1024x1024 "xc:$THEME" -fill white -font DejaVu-Sans-Bold -pointsize 560 -gravity center -annotate +0+0 "\${LETTER:-A}" -alpha off build/icon-1024.png
fi
cp build/icon-1024.png build/icons/ios/icon-1024.png
"$IM" build/icon-1024.png -resize 512x512 build/icons/play-512.png
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d="build/icons/android/mipmap-\${pair%%:*}"
  mkdir -p "$d"
  "$IM" build/icon-1024.png -resize "\${pair##*:}x\${pair##*:}" "$d/ic_launcher.png"
done
echo "icons ready"
`;

const WORKFLOW = `# Builds the phone apps on every push. Written by Karigor; it is rewritten each time the apps are made.
name: Phone apps
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: phone-apps
  cancel-in-progress: true
jobs:
  icons:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get update -qq && sudo apt-get install -y -qq librsvg2-bin imagemagick fonts-dejavu-core jq
      - run: bash scripts/icons.sh
      - uses: actions/upload-artifact@v4
        with:
          name: icons
          path: build/icons
          retention-days: 7

  android:
    needs: icons
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: icons
          path: build/icons
      - run: cp -R build/icons/android/. android/app/src/main/res/
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"
      - uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: "8.14.3"
      - name: Signing key
        env:
          KEYSTORE_B64: \${{ secrets.ANDROID_KEYSTORE_B64 }}
        run: |
          if [ -z "$KEYSTORE_B64" ]; then echo "The signing key secret is missing; make the apps again from Karigor."; exit 1; fi
          echo "$KEYSTORE_B64" | base64 -d > "$RUNNER_TEMP/upload.p12"
      - name: Build
        working-directory: android
        env:
          ANDROID_KEYSTORE_PATH: \${{ runner.temp }}/upload.p12
          ANDROID_KEYSTORE_PASSWORD: \${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
        run: gradle --no-daemon bundleRelease assembleRelease
      - run: |
          mkdir -p out
          cp android/app/build/outputs/bundle/release/app-release.aab out/
          cp android/app/build/outputs/apk/release/app-release.apk out/
          cp build/icons/play-512.png out/
      - uses: actions/upload-artifact@v4
        with:
          name: android
          path: out
          retention-days: 30

  ios:
    needs: icons
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: icons
          path: build/icons
      - run: cp build/icons/ios/icon-1024.png ios/App/Assets.xcassets/AppIcon.appiconset/
      - run: brew install xcodegen
      - name: Build for the simulator
        working-directory: ios
        run: |
          xcodegen generate
          xcodebuild -project App.xcodeproj -scheme App -configuration Release -sdk iphonesimulator -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
      - run: |
          mkdir -p out
          cd ios/build/Build/Products/Release-iphonesimulator
          zip -qr "$GITHUB_WORKSPACE/out/App-simulator.zip" App.app
      - uses: actions/upload-artifact@v4
        with:
          name: ios
          path: out
          retention-days: 30
`;

const IOS_SWIFT = `import SwiftUI
import WebKit

// The app opens the live web app. Pages on its own address stay inside; anything else
// (WhatsApp, maps, phone calls, email) opens in the app made for it.

private func setting(_ key: String) -> String { Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "" }
private let appURL = URL(string: setting("KarigorAppURL"))!

@main
struct KarigorApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    @StateObject private var model = WebModel()
    var body: some View {
        ZStack {
            WebView(model: model).ignoresSafeArea(.container, edges: .bottom)
            if model.offline {
                VStack(spacing: 16) {
                    Text(setting("KarigorOfflineTitle")).font(.title2).bold()
                    Text(setting("KarigorOfflineText")).multilineTextAlignment(.center).foregroundStyle(.secondary)
                    Button(setting("KarigorRetry")) { model.reload() }.buttonStyle(.borderedProminent)
                }
                .padding(32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(uiColor: .systemBackground))
            }
        }
    }
}

struct WebView: UIViewRepresentable {
    let model: WebModel
    func makeUIView(context: Context) -> WKWebView { model.webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}

final class WebModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published var offline = false
    let webView: WKWebView

    override init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(pulled(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        webView.load(URLRequest(url: appURL))
    }

    @objc private func pulled(_ control: UIRefreshControl) {
        reload()
        control.endRefreshing()
    }

    func reload() {
        offline = false
        if webView.url == nil { webView.load(URLRequest(url: appURL)) } else { webView.reload() }
    }

    private func inside(_ url: URL) -> Bool {
        url.host == appURL.host || ["about", "blob", "data"].contains(url.scheme ?? "")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if inside(url) { return decisionHandler(.allow) }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    // Links that open a new window (target="_blank").
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if inside(url) { webView.load(action.request) } else { UIApplication.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    private func failed(_ error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { offline = true }
    }

    // alert() and confirm() from the page, as the phone's own dialogs.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, or: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a) { completionHandler(false) }
    }

    private func present(_ alert: UIAlertController, or fallback: @escaping () -> Void) {
        let scene = UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive } as? UIWindowScene
        guard var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return fallback() }
        while let next = top.presentedViewController { top = next }
        top.present(alert, animated: true)
    }
}
`;
