const assert = require('assert');
const path = require('path');
const {
  TARGET_WIDTH,
  TARGET_HEIGHT,
  isNearRatio,
  fittedRect,
  coveringRect,
  derivedFilePath
} = require('../lib/cover-adapter');

assert.strictEqual(TARGET_WIDTH / TARGET_HEIGHT, 4 / 3, 'Bilibili target must be 4:3');
assert.strictEqual(isNearRatio(1200, 900), true, 'Exact 4:3 image must be accepted');
assert.strictEqual(isNearRatio(1190, 900), true, 'A small ratio deviation must be accepted');
assert.strictEqual(isNearRatio(1080, 1920), false, '9:16 image must require adaptation');

assert.deepStrictEqual(
  fittedRect(1080, 1920),
  { x: 347, y: 0, width: 506, height: 900 },
  'Vertical source must be fully contained and centered'
);
assert.deepStrictEqual(
  fittedRect(1200, 900),
  { x: 0, y: 0, width: 1200, height: 900 },
  '4:3 source must fill the target'
);
assert.deepStrictEqual(
  coveringRect(1080, 1920),
  { width: 1200, height: 2133, cropX: 0, cropY: 616 },
  'Vertical source must produce a centered background crop'
);

const generated = derivedFilePath('C:\\素材\\舞蹈 封面.jpg', 'C:\\derived', 12345);
assert.strictEqual(path.basename(generated), '舞蹈-封面-bilibili-4x3-12345.png');
assert.notStrictEqual(generated, 'C:\\素材\\舞蹈 封面.jpg', 'Derived cover must never overwrite the source');

console.log('cover-adapter-check: PASS');
