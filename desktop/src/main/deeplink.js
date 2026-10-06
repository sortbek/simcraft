const PROTOCOL = "simhammer";
const LINK_RE = /^simhammer:\/\/sim\/([A-Za-z0-9]{10})\/?$/i;

function parseDeepLink(url) {
  const m = typeof url === "string" ? url.trim().match(LINK_RE) : null;
  return m ? m[1] : null;
}

function findDeepLinkInArgv(argv) {
  for (const arg of argv) {
    const id = parseDeepLink(arg);
    if (id) return id;
  }
  return null;
}

module.exports = { PROTOCOL, parseDeepLink, findDeepLinkInArgv };
