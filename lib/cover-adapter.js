const fs = require('fs');
const path = require('path');

const TARGET_WIDTH = 1200;
const TARGET_HEIGHT = 900;
const TARGET_RATIO = TARGET_WIDTH / TARGET_HEIGHT;
const RATIO_TOLERANCE = 0.02;
const BACKGROUND_SAMPLE_WIDTH = 32;
const BACKGROUND_SAMPLE_HEIGHT = 24;

function validDimension(value) {
  return Number.isFinite(value) && value > 0;
}

function isNearRatio(width, height, targetRatio = TARGET_RATIO, tolerance = RATIO_TOLERANCE) {
  if (!validDimension(width) || !validDimension(height) || !validDimension(targetRatio)) return false;
  return Math.abs((width / height) / targetRatio - 1) <= tolerance;
}

function fittedRect(sourceWidth, sourceHeight, targetWidth = TARGET_WIDTH, targetHeight = TARGET_HEIGHT) {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(validDimension)) throw new Error('图片尺寸无效');
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.floor((targetWidth - width) / 2),
    y: Math.floor((targetHeight - height) / 2),
    width,
    height
  };
}

function coveringRect(sourceWidth, sourceHeight, targetWidth = TARGET_WIDTH, targetHeight = TARGET_HEIGHT) {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(validDimension)) throw new Error('图片尺寸无效');
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = Math.max(targetWidth, Math.round(sourceWidth * scale));
  const height = Math.max(targetHeight, Math.round(sourceHeight * scale));
  return {
    width,
    height,
    cropX: Math.floor((width - targetWidth) / 2),
    cropY: Math.floor((height - targetHeight) / 2)
  };
}

function derivedFilePath(sourcePath, outputDirectory, timestamp = Date.now()) {
  const stem = path.basename(sourcePath, path.extname(sourcePath)).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'cover';
  return path.join(outputDirectory, `${stem}-bilibili-4x3-${timestamp}.png`);
}

function writeUniquePng(sourcePath, outputDirectory, png, timestamp) {
  const preferred = derivedFilePath(sourcePath, outputDirectory, timestamp);
  const extension = path.extname(preferred);
  const stem = preferred.slice(0, -extension.length);
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidate = attempt === 1 ? preferred : `${stem}-${attempt}${extension}`;
    try {
      fs.writeFileSync(candidate, png, { flag: 'wx', mode: 0o600 });
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('无法为 B 站派生封面分配唯一文件名');
}

function previewDataUrl(image) {
  return image.resize({ width: 480, height: 360, quality: 'best' }).toDataURL();
}

function loadSource(sourcePath, nativeImage) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || !fs.existsSync(sourcePath)) throw new Error('封面文件不存在');
  const source = nativeImage.createFromPath(sourcePath);
  if (!source || source.isEmpty()) throw new Error('无法读取封面图片');
  const size = source.getSize();
  if (!validDimension(size.width) || !validDimension(size.height)) throw new Error('无法读取封面尺寸');
  if (size.width * size.height > 40000000 || size.width > 20000 || size.height > 20000 || Math.max(size.width / size.height, size.height / size.width) > 30) throw new Error('封面尺寸或长宽比过大，请缩小图片后重试');
  return { source, size };
}

function darkenBitmap(bitmap, strength = 0.48) {
  for (let index = 0; index + 3 < bitmap.length; index += 4) {
    bitmap[index] = Math.round(bitmap[index] * strength);
    bitmap[index + 1] = Math.round(bitmap[index + 1] * strength);
    bitmap[index + 2] = Math.round(bitmap[index + 2] * strength);
    bitmap[index + 3] = 255;
  }
}

function compositeBitmap(background, foreground, rect, canvasWidth) {
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const sourceIndex = (y * rect.width + x) * 4;
      const targetIndex = ((rect.y + y) * canvasWidth + rect.x + x) * 4;
      const alpha = foreground[sourceIndex + 3] / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        background[targetIndex + channel] = Math.round(
          foreground[sourceIndex + channel] * alpha + background[targetIndex + channel] * (1 - alpha)
        );
      }
      background[targetIndex + 3] = 255;
    }
  }
}

function prepareBilibiliCover({ sourcePath, outputDirectory, nativeImage, timestamp = Date.now() }) {
  if (!nativeImage?.createFromPath || !nativeImage?.createFromBitmap) throw new Error('本机图片处理能力不可用');
  const { source, size } = loadSource(sourcePath, nativeImage);
  const compatible = isNearRatio(size.width, size.height);

  if (compatible) {
    return {
      ok: true,
      generated: false,
      path: sourcePath,
      name: path.basename(sourcePath),
      sourceWidth: size.width,
      sourceHeight: size.height,
      width: size.width,
      height: size.height,
      ratio: size.width / size.height,
      previewDataUrl: previewDataUrl(source)
    };
  }

  const cover = coveringRect(size.width, size.height);
  const backgroundCrop = source
    .resize({ width: cover.width, height: cover.height, quality: 'best' })
    .crop({ x: cover.cropX, y: cover.cropY, width: TARGET_WIDTH, height: TARGET_HEIGHT });
  const backgroundImage = backgroundCrop
    .resize({ width: BACKGROUND_SAMPLE_WIDTH, height: BACKGROUND_SAMPLE_HEIGHT, quality: 'best' })
    .resize({ width: TARGET_WIDTH, height: TARGET_HEIGHT, quality: 'best' });
  const backgroundBitmap = Buffer.from(backgroundImage.toBitmap({ scaleFactor: 1 }));
  if (backgroundBitmap.length !== TARGET_WIDTH * TARGET_HEIGHT * 4) throw new Error('生成背景时像素尺寸不一致');
  darkenBitmap(backgroundBitmap);

  const fit = fittedRect(size.width, size.height);
  const foregroundImage = source.resize({ width: fit.width, height: fit.height, quality: 'best' });
  const foregroundBitmap = foregroundImage.toBitmap({ scaleFactor: 1 });
  if (foregroundBitmap.length !== fit.width * fit.height * 4) throw new Error('生成前景时像素尺寸不一致');
  compositeBitmap(backgroundBitmap, foregroundBitmap, fit, TARGET_WIDTH);

  const resultImage = nativeImage.createFromBitmap(backgroundBitmap, {
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    scaleFactor: 1
  });
  if (!resultImage || resultImage.isEmpty()) throw new Error('B 站封面生成失败');

  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = writeUniquePng(sourcePath, outputDirectory, resultImage.toPNG(), timestamp);

  return {
    ok: true,
    generated: true,
    path: outputPath,
    name: path.basename(outputPath),
    sourceWidth: size.width,
    sourceHeight: size.height,
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    ratio: TARGET_RATIO,
    previewDataUrl: previewDataUrl(resultImage)
  };
}

module.exports = {
  TARGET_WIDTH,
  TARGET_HEIGHT,
  TARGET_RATIO,
  RATIO_TOLERANCE,
  BACKGROUND_SAMPLE_WIDTH,
  BACKGROUND_SAMPLE_HEIGHT,
  isNearRatio,
  fittedRect,
  coveringRect,
  derivedFilePath,
  writeUniquePng,
  prepareBilibiliCover
};
