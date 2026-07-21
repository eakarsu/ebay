import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { loadConfig } from './config.js';

export async function authenticate(request, response, next) {
  try {
    const authorization = request.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return response.status(401).json({ error: 'authentication_required' });
    const claims = jwt.verify(authorization.slice(7), loadConfig().jwtSecret, {
      algorithms: ['HS256'], issuer: 'governed-commerce', audience: 'commerce-api',
    });
    if (typeof claims !== 'object' || !claims.sub || !claims.tenant || !claims.role || !claims.ver) {
      return response.status(401).json({ error: 'invalid_identity' });
    }
    const found = await pool.query(
      `SELECT id, tenant_id, email, role, token_version FROM commerce_identities
       WHERE id=$1 AND tenant_id=$2 AND active=true`, [claims.sub, claims.tenant],
    );
    if (!found.rowCount || found.rows[0].role !== claims.role || found.rows[0].token_version !== claims.ver) {
      return response.status(401).json({ error: 'identity_revoked' });
    }
    request.identity = {
      id: found.rows[0].id, tenantId: found.rows[0].tenant_id,
      email: found.rows[0].email, role: found.rows[0].role,
    };
    next();
  } catch {
    response.status(401).json({ error: 'invalid_token' });
  }
}

export function requireRoles(...roles) {
  return (request, response, next) => roles.includes(request.identity?.role)
    ? next() : response.status(403).json({ error: 'forbidden' });
}
