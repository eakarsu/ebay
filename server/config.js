function required(name, minimum = 1) {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimum) throw new Error(`${name} is required and must be at least ${minimum} characters`);
  return value;
}

export function loadConfig() {
  const production = process.env.NODE_ENV === 'production';
  const jwtSecret = required('COMMERCE_JWT_SECRET', 32);
  const webhookSecret = required('PROVIDER_WEBHOOK_SECRET', 32);
  const origins = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (production && (origins.includes('*') || origins.some((origin) => !origin.startsWith('https://')))) {
    throw new Error('Production ALLOWED_ORIGINS must contain exact HTTPS origins');
  }
  return { production, jwtSecret, webhookSecret, origins };
}
