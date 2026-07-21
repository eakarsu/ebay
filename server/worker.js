import { pool } from './db.js';
import { createHttpProvider } from './providers.js';
import { processNextOperation } from './orders.js';

const providers = {};
for (const name of ['inventory', 'tax', 'payment', 'shipping']) {
  const prefix = `PROVIDER_${name.toUpperCase()}`;
  const baseUrl = process.env[`${prefix}_URL`];
  const token = process.env[`${prefix}_TOKEN`];
  if (!baseUrl || !token) throw new Error(`${prefix}_URL and ${prefix}_TOKEN are required`);
  providers[name] = createHttpProvider({ baseUrl, token });
}

let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; });
while (!stopped) {
  const result = await processNextOperation(providers, `worker-${process.pid}`);
  if (!result) await new Promise((resolve) => setTimeout(resolve, 500));
}
await pool.end();
