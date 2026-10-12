import fs from 'node:fs';
import crypto from 'node:crypto';
const template=fs.readFileSync(new URL('./ai-workspace.html',import.meta.url),'utf8');
export function serveNativePromptConsole(response){const nonce=crypto.randomBytes(18).toString('base64');response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'`});response.end(template.replaceAll('__NONCE__',nonce));}
