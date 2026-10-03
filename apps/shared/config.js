// Small helper to read environment variables with a default value.
function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(name, fallback) {
  const v = Number.parseInt(env(name, ''), 10);
  return Number.isNaN(v) ? fallback : v;
}

module.exports = { env, envInt };
