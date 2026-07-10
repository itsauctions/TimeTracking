const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { signAsync } = require("@electron/osx-sign");

/**
 * Ad-hoc sign the packed macOS .app so Gatekeeper does not report a
 * downloaded build as "damaged". Uses @electron/osx-sign (inside-out,
 * per-helper) instead of `codesign --deep`, which can break Electron's
 * renderer/GPU helpers so the main process runs with no visible window.
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

  await signAsync({
    app: appPath,
    identity: "-",
    identityValidation: false,
    preEmbedProvisioningProfile: false,
    preAutoEntitlements: false,
    optionsForFile: () => ({
      hardenedRuntime: false,
      timestamp: "none"
    })
  });

  execFileSync("codesign", ["--verify", "--verbose=2", appPath], {
    stdio: "inherit"
  });
};
