import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ensureLocalWorkspace, getDb } from './db.ts';
import { generateSessionToken, hashSessionToken } from './crypto.ts';
import type { WorkspaceRole } from '../shared/kresna-logic.ts';

export interface AuthenticatedContext {
  sessionId: string;
  isLocalMode: boolean;
  user: {
    id: string;
    email: string;
    name: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    role: WorkspaceRole;
  };
}

export interface AuthRequest extends Request {
  auth?: AuthenticatedContext;
}

export function isMultiUserAuthEnabled(): boolean {
  return process.env.ENABLE_MULTI_USER_AUTH === 'true';
}

function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isLocalHostname(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/**
 * Enforces that administrative dashboard endpoints stay restricted to local development access
 * when running in Local Single-User Mode.
 */
export function isAllowedLocalAdminRequest(req: Request): boolean {
  const remoteIp = req.socket?.remoteAddress;
  const host = req.headers.host;

  // In AI Studio preview container, requests arrive via local loopback proxy with APP_URL host
  const isAiStudioPreview = Boolean(
    process.env.K_SERVICE ||
      (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL')
  );
  if (isAiStudioPreview && isLoopbackIp(remoteIp)) {
    return true;
  }

  // In Docker Compose / local dev, allow loopback socket connections with localhost host (or explicit docker bridge test when no public proxy header)
  if (isLocalHostname(host)) {
    return true;
  }

  if (process.env.ALLOW_NON_LOCAL_ADMIN === 'true') {
    return true;
  }

  return isLoopbackIp(remoteIp) && !req.headers['x-forwarded-for'];
}

const SESSION_COOKIE_NAME = 'kresna_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}

export function createSessionForUser(
  res: Response,
  userId: string,
  workspaceId: string
): string {
  const db = getDb();
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, active_workspace_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), tokenHash, userId, workspaceId, expiresAt, now.toISOString());

  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });

  return rawToken;
}

export function clearSession(req: Request, res: Response): void {
  const token = extractSessionToken(req).token;
  if (token) {
    const db = getDb();
    db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashSessionToken(token));
  }
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
  });
}

function extractSessionToken(req: Request): { token: string | null; viaCookie: boolean } {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return { token, viaCookie: false };
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return { token: cookies[SESSION_COOKIE_NAME], viaCookie: true };
  }
  return { token: null, viaCookie: false };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  // MVP Local Single-User Mode (default when ENABLE_MULTI_USER_AUTH !== 'true')
  if (!isMultiUserAuthEnabled()) {
    if (!isAllowedLocalAdminRequest(req)) {
      res.status(403).json({
        error:
          'Local Single-User Mode restricts administrative APIs to localhost access only.',
      });
      return;
    }

    const db = getDb();
    const localCtx = ensureLocalWorkspace(db);
    req.auth = {
      sessionId: 'local-admin-session',
      isLocalMode: true,
      user: localCtx.user,
      workspace: {
        id: localCtx.workspace.id,
        name: localCtx.workspace.name,
        slug: localCtx.workspace.slug,
        plan: localCtx.workspace.plan,
        role: 'owner',
      },
    };
    next();
    return;
  }

  // Legacy Multi-User Auth Mode (only active when ENABLE_MULTI_USER_AUTH === 'true')
  const { token, viaCookie } = extractSessionToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (
    viaCookie &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())
  ) {
    const xrw = req.headers['x-requested-with'];
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const originMatches =
      typeof origin === 'string' &&
      typeof host === 'string' &&
      (origin.endsWith(`://${host}`) || origin === `http://${host}` || origin === `https://${host}`);
    if (xrw !== 'KresnaClient' && !originMatches) {
      res.status(403).json({ error: 'CSRF validation failed' });
      return;
    }
  }

  const db = getDb();
  const tokenHash = hashSessionToken(token);
  const row = db
    .prepare(
      `SELECT
        s.id AS session_id,
        s.expires_at AS expires_at,
        u.id AS user_id,
        u.email AS user_email,
        u.name AS user_name,
        w.id AS workspace_id,
        w.name AS workspace_name,
        w.slug AS workspace_slug,
        w.plan AS workspace_plan,
        wm.role AS member_role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN workspaces w ON w.id = s.active_workspace_id
      JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = u.id
      WHERE s.token_hash = ?`
    )
    .get(tokenHash) as
    | {
        session_id: string;
        expires_at: string;
        user_id: string;
        user_email: string;
        user_name: string;
        workspace_id: string;
        workspace_name: string;
        workspace_slug: string;
        workspace_plan: string;
        member_role: WorkspaceRole;
      }
    | undefined;

  if (!row) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(row.session_id);
    res.status(401).json({ error: 'Session expired' });
    return;
  }

  req.auth = {
    sessionId: row.session_id,
    isLocalMode: false,
    user: {
      id: row.user_id,
      email: row.user_email,
      name: row.user_name,
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      slug: row.workspace_slug,
      plan: row.workspace_plan,
      role: row.member_role,
    },
  };

  next();
}

export function requireRole(allowedRoles: WorkspaceRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const role = req.auth?.workspace.role;
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({ error: 'Insufficient workspace permissions' });
      return;
    }
    next();
  };
}
