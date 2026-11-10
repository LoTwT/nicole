import { defineConfig } from "mygo-cli";

// Release builds take their version and update channel from the pushed tag:
// the Release workflow sets these variables from the tag, while the source
// keeps the development version 0.0.1 and the stable prefix. Reading them
// here, instead of rewriting a file in the checkout before building, keeps
// `git status` clean, so Go's VCS stamp does not mark the build "-modified".
// See docs/release.md.
type ReleaseEnvironment = {
  NICOLE_RELEASE_VERSION?: string;
  NICOLE_RELEASE_TAG_PREFIX?: string;
  NICOLE_DISABLE_UPDATES?: string;
};

// The config runs under Bun or Node, but tsconfig carries no Node types, so
// read the environment through globalThis rather than `process.env`.
const environment =
  (globalThis as { process?: { env?: ReleaseEnvironment } }).process?.env ?? {};

const releaseVersion = environment.NICOLE_RELEASE_VERSION;
const releaseTagPrefix = environment.NICOLE_RELEASE_TAG_PREFIX;
if ((releaseVersion === undefined) !== (releaseTagPrefix === undefined)) {
  throw new Error(
    "set both NICOLE_RELEASE_VERSION and NICOLE_RELEASE_TAG_PREFIX, or neither",
  );
}

// The Package workflow builds test installers without updates, so nothing of
// the update source is embedded and the app never checks for updates.
const updatesDisabled = environment.NICOLE_DISABLE_UPDATES === "1";

const updates = {
  publicKey: "JUV50KDgCfG2HqXbO0rr+Qrx6xzWTvX59BCg5gGHo+0=",
  github: "LoTwT/nicole",
  // "v" reads the repository's latest release; "test-v" reads the newest
  // release with that prefix through the GitHub API. See docs/release.md.
  tagPrefix: releaseTagPrefix ?? "v",
};

export default defineConfig({
  name: "Nicole",
  identifier: "me.eruoo.nicole",
  version: releaseVersion ?? "0.0.1",
  // `mygo dev` runs devCommand and loads devUrl; `mygo build` runs
  // buildCommand and embeds frontendDist into the app.
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web",
  frontendDist: "dist",
  bindings: "src/services/mygo.ts",
  // The Lucide and Feather attribution plus the generated runtime license
  // texts must travel with every distributed copy. MyGo installs resources in
  // Contents/Resources on macOS and next to the executable elsewhere, which
  // the Windows installer, the Debian package and the update archive all
  // carry. See docs/development.md.
  resources: ["THIRD-PARTY-NOTICES.md", "THIRD-PARTY-LICENSES.md"],
  // The system lists Nicole for Markdown files and opens them with it; the
  // path reaches App.OnOpenFile and then the page as app:open-file. See
  // docs/specs/ui.md and docs/release.md.
  fileAssociations: [
    {
      ext: ["md"],
      name: "Markdown Document",
      mimeType: "text/markdown",
      role: "Editor",
    },
  ],
  // AppKit and WebKit say their own texts (the Edit menu's dictation and
  // emoji items, the system items of the web view's context menu) in the
  // bundle's language at launch; App.SetLanguages does not change the bundle.
  // Declare the same single language as main.go so those texts are Simplified
  // Chinese from the first launch. See docs/references/mygo.md.
  macos: {
    infoPlist: {
      CFBundleDevelopmentRegion: "zh-Hans",
      CFBundleLocalizations: ["zh-Hans"],
    },
  },
  out: "build",
  ...(updatesDisabled ? {} : { updates }),
});
