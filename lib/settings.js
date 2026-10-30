const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({ schemaVersion: 1, windowBounds: null });

function createSettings(app, logger) {
  const file = path.join(app.getPath('userData'), 'settings.json');
  let state = { ...DEFAULTS };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && parsed.schemaVersion === 1) state = { ...DEFAULTS, ...parsed };
  } catch {}

  function save() {
    const temp = `${file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temp, file);
    } catch (error) { logger?.error('settings.save_failed', { message: error.message }); }
  }
  return {
    get: key => state[key],
    set: (key, value) => { state[key] = value; save(); },
    file
  };
}

module.exports = { createSettings };
