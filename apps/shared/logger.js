// Minimal JSON logger (one line per event) so `docker logs` output is easy to read.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const current = LEVELS[process.env.LOG_LEVEL || 'info'] || LEVELS.info;
const service = process.env.SERVICE_NAME || 'app';

function write(level, msg, extra) {
  if (LEVELS[level] < current) return;
  const line = { t: new Date().toISOString(), level, service, pid: process.pid, msg, ...extra };
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(JSON.stringify(line) + '\n');
}

module.exports = {
  debug: (msg, extra) => write('debug', msg, extra),
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra),
};
