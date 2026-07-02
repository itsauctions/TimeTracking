const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.join(__dirname, "..");
const rgbaInput = path.join(projectRoot, "assets", "app-icon-rgba.png");
const pngInput = path.join(projectRoot, "assets", "app-icon.png");
const input = fs.existsSync(rgbaInput) ? rgbaInput : pngInput;
const iconset = path.join(projectRoot, "assets", "app-icon.iconset");
const output = path.join(projectRoot, "assets", "app-icon.icns");

const variants = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024]
];

if (!fs.existsSync(input)) {
  throw new Error(`Missing source icon: ${input}`);
}

fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset, { recursive: true });

for (const [filename, size] of variants) {
  execFileSync("sips", ["-z", String(size), String(size), input, "--out", path.join(iconset, filename)], {
    stdio: "ignore"
  });
}

execFileSync("iconutil", ["--convert", "icns", "--output", output, iconset], {
  stdio: "inherit"
});

console.log(`Wrote ${output}`);
console.log(`Wrote ${iconset}`);
