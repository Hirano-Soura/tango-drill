// Static file server for checking the app in a browser (no build step). Serves the repository root.
// Usage: node Tools/Dev/serve.mjs [port] [host]   (default 8765 127.0.0.1)
//   node Tools/Dev/serve.mjs 8765 0.0.0.0   -> also reachable from a phone on the same Wi-Fi (prints the URLs)
// Never serves node_modules, Temp or dot entries (.git, .github, ...), since host 0.0.0.0 exposes it to the LAN.
// Keep this file ASCII-only (UE-1).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.argv[2] ?? 8765);
const host = process.argv[3] ?? '127.0.0.1';
const HIDDEN = new Set(['node_modules', 'Temp']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep)) throw new Error('outside');
    if (relative(root, file).split(sep).some((s) => s.startsWith('.') || HIDDEN.has(s))) throw new Error('hidden');
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, host, () => {
  console.log(`serving ${root} on http://${host}:${port}/`);
  if (host === '0.0.0.0') {
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) console.log(`  from the same network: http://${a.address}:${port}/`);
    }
  }
});
