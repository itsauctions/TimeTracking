const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const input = path.join(__dirname, "..", "assets", "app-icon.png");
const output = path.join(__dirname, "..", "assets", "app-icon.ico");
const tauriOutput = path.join(__dirname, "..", "src-tauri", "icons", "icon.ico");
const rgbaOutput = path.join(__dirname, "..", "assets", "app-icon-rgba.png");
const trayOutput = path.join(__dirname, "..", "assets", "app-icon-tray.png");
const sizes = [256, 128, 64, 48, 40, 32, 24, 20, 16];

function readPng(filePath) {
  const buffer = fs.readFileSync(filePath);
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error("Input is not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error("Only 8-bit RGB/RGBA non-interlaced PNGs are supported");
      }
    }

    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    unfilter(row, previous, channels, filter);

    for (let x = 0; x < width; x += 1) {
      const sourceIndex = x * channels;
      const targetIndex = (y * width + x) * 4;
      pixels[targetIndex] = row[sourceIndex];
      pixels[targetIndex + 1] = row[sourceIndex + 1];
      pixels[targetIndex + 2] = row[sourceIndex + 2];
      pixels[targetIndex + 3] = channels === 4 ? row[sourceIndex + 3] : 255;
    }

    previous = row;
  }

  return { width, height, pixels };
}

function unfilter(row, previous, channels, filter) {
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= channels ? row[i - channels] : 0;
    const up = previous[i] || 0;
    const upLeft = i >= channels ? previous[i - channels] || 0 : 0;

    if (filter === 1) row[i] = (row[i] + left) & 255;
    if (filter === 2) row[i] = (row[i] + up) & 255;
    if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 255;
    if (filter === 4) row[i] = (row[i] + paeth(left, up, upLeft)) & 255;
  }
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function resizeArea(image, size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scaleX = image.width / size;
  const scaleY = image.height / size;

  for (let y = 0; y < size; y += 1) {
    const sourceY0 = y * scaleY;
    const sourceY1 = sourceY0 + scaleY;
    const yStart = Math.floor(sourceY0);
    const yEnd = Math.min(image.height - 1, Math.ceil(sourceY1) - 1);

    for (let x = 0; x < size; x += 1) {
      const sourceX0 = x * scaleX;
      const sourceX1 = sourceX0 + scaleX;
      const xStart = Math.floor(sourceX0);
      const xEnd = Math.min(image.width - 1, Math.ceil(sourceX1) - 1);
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let weightTotal = 0;

      for (let sourceY = yStart; sourceY <= yEnd; sourceY += 1) {
        const yWeight = Math.min(sourceY + 1, sourceY1) - Math.max(sourceY, sourceY0);

        for (let sourceX = xStart; sourceX <= xEnd; sourceX += 1) {
          const xWeight = Math.min(sourceX + 1, sourceX1) - Math.max(sourceX, sourceX0);
          const weight = xWeight * yWeight;
          const sourceIndex = (sourceY * image.width + sourceX) * 4;
          const sourceAlpha = image.pixels[sourceIndex + 3] / 255;
          const alphaWeight = weight * sourceAlpha;

          red += image.pixels[sourceIndex] * alphaWeight;
          green += image.pixels[sourceIndex + 1] * alphaWeight;
          blue += image.pixels[sourceIndex + 2] * alphaWeight;
          alpha += image.pixels[sourceIndex + 3] * weight;
          weightTotal += weight;
        }
      }

      const targetIndex = (y * size + x) * 4;
      const normalizedAlpha = alpha / weightTotal;
      const colorDivisor = normalizedAlpha / 255;
      pixels[targetIndex] = colorDivisor > 0 ? clampByte(red / weightTotal / colorDivisor) : 0;
      pixels[targetIndex + 1] = colorDivisor > 0 ? clampByte(green / weightTotal / colorDivisor) : 0;
      pixels[targetIndex + 2] = colorDivisor > 0 ? clampByte(blue / weightTotal / colorDivisor) : 0;
      pixels[targetIndex + 3] = clampByte(normalizedAlpha);
    }
  }

  return { width: size, height: size, pixels };
}

function blendPixel(image, x, y, color, coverage = 1) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height || coverage <= 0) return;

  const targetIndex = (y * image.width + x) * 4;
  const sourceAlpha = (color[3] / 255) * Math.min(1, coverage);
  const targetAlpha = image.pixels[targetIndex + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);

  if (outAlpha <= 0) return;

  image.pixels[targetIndex] = clampByte((color[0] * sourceAlpha + image.pixels[targetIndex] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  image.pixels[targetIndex + 1] = clampByte((color[1] * sourceAlpha + image.pixels[targetIndex + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  image.pixels[targetIndex + 2] = clampByte((color[2] * sourceAlpha + image.pixels[targetIndex + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  image.pixels[targetIndex + 3] = clampByte(outAlpha * 255);
}

function drawCircle(image, centerX, centerY, radius, color) {
  const minX = Math.floor(centerX - radius - 1);
  const maxX = Math.ceil(centerX + radius + 1);
  const minY = Math.floor(centerY - radius - 1);
  const maxY = Math.ceil(centerY + radius + 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      blendPixel(image, x, y, color, radius + 0.5 - distance);
    }
  }
}

function drawLine(image, startX, startY, endX, endY, width, color) {
  const halfWidth = width / 2;
  const minX = Math.floor(Math.min(startX, endX) - halfWidth - 1);
  const maxX = Math.ceil(Math.max(startX, endX) + halfWidth + 1);
  const minY = Math.floor(Math.min(startY, endY) - halfWidth - 1);
  const maxY = Math.ceil(Math.max(startY, endY) + halfWidth + 1);
  const lineX = endX - startX;
  const lineY = endY - startY;
  const lengthSquared = lineX * lineX + lineY * lineY;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const pixelX = x + 0.5;
      const pixelY = y + 0.5;
      const t = Math.max(0, Math.min(1, ((pixelX - startX) * lineX + (pixelY - startY) * lineY) / lengthSquared));
      const closestX = startX + lineX * t;
      const closestY = startY + lineY * t;
      const distance = Math.hypot(pixelX - closestX, pixelY - closestY);
      blendPixel(image, x, y, color, halfWidth + 0.5 - distance);
    }
  }
}

function createSmallWindowsIcon(size) {
  const image = { width: size, height: size, pixels: Buffer.alloc(size * size * 4) };
  const center = size / 2;
  const outerRadius = size * 0.47;
  const ringWidth = Math.max(3, size * 0.18);
  const innerRadius = outerRadius - ringWidth;
  const navy = [8, 52, 70, 255];
  const teal = [27, 145, 169, 255];
  const pale = [252, 255, 255, 255];
  const hand = [6, 27, 38, 255];
  const shadow = [4, 24, 32, 95];

  drawCircle(image, center, center + Math.max(1, size * 0.045), outerRadius, shadow);
  drawCircle(image, center, center, outerRadius, navy);
  drawCircle(image, center, center, outerRadius - Math.max(1, ringWidth * 0.42), teal);
  drawCircle(image, center, center, innerRadius, pale);

  drawLine(image, center, center, center - size * 0.16, center - size * 0.13, Math.max(2.8, size * 0.13), hand);
  drawLine(image, center, center, center + size * 0.18, center - size * 0.25, Math.max(2.8, size * 0.13), hand);
  drawCircle(image, center, center, Math.max(2, size * 0.085), hand);

  return image;
}

function makeIcoFrame(_source, size) {
  return createSmallWindowsIcon(size);
}

function writePng(image) {
  const rows = [];
  const stride = image.width * 4;
  for (let y = 0; y < image.height; y += 1) {
    rows.push(Buffer.from([0]));
    rows.push(image.pixels.subarray(y * stride, (y + 1) * stride));
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeIco(filePath, images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let imageOffset = 6 + directory.length;
  images.forEach((image, index) => {
    const offset = index * 16;
    directory[offset] = image.size === 256 ? 0 : image.size;
    directory[offset + 1] = image.size === 256 ? 0 : image.size;
    directory[offset + 2] = 0;
    directory[offset + 3] = 0;
    directory.writeUInt16LE(1, offset + 4);
    directory.writeUInt16LE(32, offset + 6);
    directory.writeUInt32LE(image.data.length, offset + 8);
    directory.writeUInt32LE(imageOffset, offset + 12);
    imageOffset += image.data.length;
  });

  fs.writeFileSync(filePath, Buffer.concat([header, directory, ...images.map((image) => image.data)]));
}

const source = readPng(input);
const images = sizes.map((size) => ({ size, data: writePng(makeIcoFrame(source, size)) }));
writeIco(output, images);
writeIco(tauriOutput, images);
fs.writeFileSync(rgbaOutput, writePng(source));
fs.writeFileSync(trayOutput, writePng(createSmallWindowsIcon(32)));
console.log(`Wrote ${output}`);
console.log(`Wrote ${tauriOutput}`);
console.log(`Wrote ${rgbaOutput}`);
console.log(`Wrote ${trayOutput}`);
