const fs = require('fs');
const path = require('path');

function redact(value) {
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value); }
  catch { text = '[unserializable]'; }
  return String(text ?? '')
    .replace(/("(?:[^"\\]*token|authorization|cookie|set-cookie|client_secret|password|code|ticket|session|sid)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"')
    .replace(/\b(cookie|set-cookie|authorization)\s*:\s*[^\r\n]+/gi, '$1: [REDACTED]')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:access|refresh)?_?token|cookie|client_secret|password|code)\s*[:=]\s*["']?[^\s,"'&}]+/gi, '$1=[REDACTED]')
    .replace(/([?&](?:[^&=]*token|code|ticket|auth|session|sid)=[^&\s]*)/gi, '[REDACTED_QUERY]');
}

function createLogger(app) {
  const directory = app.getPath('logs');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'blockcast.log');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      const previous = `${file}.1`;
      try { fs.unlinkSync(previous); } catch {}
      fs.renameSync(file, previous);
    }
  } catch {}

  const write = (level, event, data) => {
    const line = `${new Date().toISOString()} ${level} ${redact(event)}${data === undefined ? '' : ` ${redact(data)}`}\n`;
    try { fs.appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 }); } catch {}
  };
  return {
    directory,
    file,
    info: (event, data) => write('INFO', event, data),
    warn: (event, data) => write('WARN', event, data),
    error: (event, data) => write('ERROR', event, data)
  };
}

module.exports = { createLogger, redact };
