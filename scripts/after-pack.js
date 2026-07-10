const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Ad-hoc sign the packed macOS .app so Gatekeeper does not report a
 * downloaded build as "damaged". This does not replace Developer ID
 * signing/notarization; users still get an unidentified-developer prompt
 * they can bypass with right-click Open.
 *
 * Skip electron-builder's intermediate *-temp packs used to assemble a
 * universal binary — signing those changes CodeResources and breaks the merge.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  if (String(context.appOutDir).endsWith("-temp")) {
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  if (!fs.existsSync(appPath)) {
    throw new Error(`afterPack: expected app bundle at ${appPath}`);
  }

  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" }
  );

  execFileSync("codesign", ["--verify", "--verbose=2", appPath], {
    stdio: "inherit",
  });
};
