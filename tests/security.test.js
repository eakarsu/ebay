import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('server entry hardening', () => {
  it('server exposes a health endpoint', () => {
    const body = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    expect(body.includes('/api/health')).toBe(true);
  });

  it('no hard-coded secret fallback in server entry', () => {
    const body = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
    expect(/process\.env\.(JWT_SECRET|SESSION_SECRET)\s*\|\|\s*['"][^'"]+['"]/.test(body)).toBe(false);
  });
});
