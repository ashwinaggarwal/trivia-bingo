const os = require('os');

function lanAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// Best-effort base URL for the startup log, printed before any request has
// arrived — there's no request to derive this from yet, so this is just an
// informational guess. The authoritative origin used in join links/QR codes
// is requestOrigin() below, which reads it off each actual request instead
// of guessing.
function publicOrigin(port) {
  return `http://${lanAddress()}:${port}`;
}

// Base URL players/QR codes should use to reach this server, derived from
// the request itself. req.protocol/req.get('host') reflect exactly the
// host:port the client's browser already used to reach us — which is
// self-correcting across LAN IP changes, localhost vs. LAN access, and real
// deployed domains, as long as the app trusts its reverse proxy (see
// `app.set('trust proxy', ...)` in server.js) so Express reads
// X-Forwarded-Proto/Host instead of the proxy's internal values.
function requestOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = { lanAddress, publicOrigin, requestOrigin };
