const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, nativeImage } = require('electron');
const { prepareBilibiliCover, TARGET_WIDTH, TARGET_HEIGHT } = require('../lib/cover-adapter');

function digest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

app.whenReady().then(() => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'blockcast-cover-test-'));
  try {
    const width = 360;
    const height = 640;
    const bitmap = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        bitmap[index] = Math.round(255 * x / width);
        bitmap[index + 1] = Math.round(255 * y / height);
        bitmap[index + 2] = x > 80 && x < 280 && y > 120 && y < 520 ? 240 : 50;
        bitmap[index + 3] = 255;
      }
    }

    const sourcePath = path.join(temporaryRoot, 'vertical-source.png');
    const sourceImage = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
    fs.writeFileSync(sourcePath, sourceImage.toPNG());
    const sourceDigest = digest(sourcePath);

    const result = prepareBilibiliCover({
      sourcePath,
      outputDirectory: path.join(temporaryRoot, 'derived'),
      nativeImage,
      timestamp: 12345
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.generated, true);
    assert.notStrictEqual(result.path, sourcePath);
    assert.strictEqual(result.width, TARGET_WIDTH);
    assert.strictEqual(result.height, TARGET_HEIGHT);
    assert(result.previewDataUrl.startsWith('data:image/png;base64,'), 'Preview must be an in-memory PNG data URL');
    assert.strictEqual(digest(sourcePath), sourceDigest, 'Source file must remain byte-for-byte unchanged');

    const generated = nativeImage.createFromPath(result.path);
    assert.strictEqual(generated.isEmpty(), false);
    assert.deepStrictEqual(generated.getSize(), { width: TARGET_WIDTH, height: TARGET_HEIGHT });

    const duplicate = prepareBilibiliCover({
      sourcePath,
      outputDirectory: path.join(temporaryRoot, 'derived'),
      nativeImage,
      timestamp: 12345
    });
    assert.strictEqual(duplicate.generated, true);
    assert.notStrictEqual(duplicate.path, result.path, 'Repeated preparation must allocate a unique derived filename');

    const passthrough = prepareBilibiliCover({
      sourcePath: result.path,
      outputDirectory: path.join(temporaryRoot, 'derived'),
      nativeImage,
      timestamp: 12346
    });
    assert.strictEqual(passthrough.generated, false, 'An existing 4:3 image must not be regenerated');
    assert.strictEqual(passthrough.path, result.path, 'Compatible 4:3 image must keep its original path');
    const artifactPath = process.env.BLOCKCAST_COVER_ARTIFACT;
    if (artifactPath) {
      assert(path.isAbsolute(artifactPath), 'Artifact output path must be absolute');
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      fs.copyFileSync(result.path, artifactPath);
    }
    console.log('cover-image-integration: PASS');
  } finally {
    const resolved = path.resolve(temporaryRoot);
    const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (resolved.startsWith(tempBase) && path.basename(resolved).startsWith('blockcast-cover-test-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}).then(() => app.quit()).catch(error => {
  console.error(error);
  app.exit(1);
});
