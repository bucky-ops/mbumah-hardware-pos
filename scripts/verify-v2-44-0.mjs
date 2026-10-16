#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.44.0 verification
// Scope: first sign-in password rotation — User.mustChangePassword column +
// migration, the server-wide 403 PASSWORD_CHANGE_REQUIRED gate in ALL THREE
// wrappers with the exempt allowlist, login/me payload surfacing, rotation
// semantics on create user / admin password reset / profile self-change, the
// forced "Set a new password" screen + the four client gates (root page,
// workspace gateway, login redirect skip, employee portal guard), the
// Settings → Users admin surface (rotation switch + Force reset + badge),
// the PortalLinkDialog rotation checkbox, the desk corrected-chip tooltip,
// tests, whats-new, version lockstep.
// Run: node scripts/verify-v2-44-0.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let failures = 0;

function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

console.log('== Schema & migration ==');
const SCHEMA = read('prisma/schema.prisma') ?? '';
check('User.mustChangePassword column', SCHEMA.includes('mustChangePassword  Boolean   @default(false)'));
const MIG = read('prisma/migrations/20261017210000_add_user_must_change_password/migration.sql') ?? '';
check('migration adds the column', MIG.includes('ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false'));

console.log('== Server gate: lib/auth.ts ==');
const AUTH = read('src/lib/auth.ts') ?? '';
check('AuthSession carries the flag (optional)', AUTH.includes('mustChangePassword?: boolean'));
check('request session reader selects + returns the flag', (AUTH.split('export async function getSessionFromRequest')[1] ?? '').split('getSessionFromCookies')[0].includes('mustChangePassword: true') && (AUTH.split('export async function getSessionFromRequest')[1] ?? '').split('getSessionFromCookies')[0].includes('mustChangePassword: session.user.mustChangePassword'));
check('RSC session reader selects + returns the flag', (AUTH.split('export async function getSessionFromCookies')[1] ?? '').includes('mustChangePassword: true') && (AUTH.split('export async function getSessionFromCookies')[1] ?? '').includes('mustChangePassword: session.user.mustChangePassword'));
check('PASSWORD_CHANGE_REQUIRED code exported', AUTH.includes("export const PASSWORD_CHANGE_REQUIRED_CODE = 'PASSWORD_CHANGE_REQUIRED'"));
check('exempt allowlist covers rotation + auth + csrf + errors', ['/api/profile/password', '/api/auth/me', '/api/auth/logout', '/api/security/csrf-token', '/api/client-error'].every((p) => AUTH.includes(`'${p}'`)));
check('assertPasswordRotation answers 403 with the code', (AUTH.split('export function assertPasswordRotation')[1] ?? '').includes('status: 403'));
check('gate wired into requireAuth', (AUTH.split('export function requireAuth')[1] ?? '').includes('assertPasswordRotation(request, session)'));
check('gate wired into withSessionAuth', (AUTH.split('export function withSessionAuth')[1] ?? '').includes('assertPasswordRotation(request, session)'));
check('gate wired into requireStoreAccess', (AUTH.split('export function requireStoreAccess')[1] ?? '').includes('assertPasswordRotation(request, session)'));

console.log('== Payloads: login / me / profile password ==');
const LOGIN = read('src/app/api/auth/login/route.ts') ?? '';
check('login response surfaces the flag', LOGIN.includes('mustChangePassword: user.mustChangePassword'));
const ME = read('src/app/api/auth/me/route.ts') ?? '';
check('me response surfaces the flag', ME.includes('mustChangePassword: user.mustChangePassword'));
const PW = read('src/app/api/profile/password/route.ts') ?? '';
check('self-change clears the flag in the rotation tx', PW.includes('mustChangePassword: false'));
check('self-change echoes the cleared flag', PW.includes('mustChangePassword: false },'));

console.log('== Provisioning: POST /api/users + PATCH /api/users/[id] ==');
const USERS = read('src/app/api/users/route.ts') ?? '';
check('create schema accepts the flag', (read('src/lib/validations.ts') ?? '').includes('mustChangePassword: z.boolean().optional()'));
check('create defaults the flag ON', USERS.includes('mustChangePassword: mustChangePassword ?? true'));
check('create response echoes the flag', USERS.includes('mustChangePassword: true,'));
const USERID = read('src/app/api/users/[id]/route.ts') ?? '';
check('PATCH accepts the flag toggle', USERID.includes('data.mustChangePassword = mustChangePassword'));
check('admin password reset forces rotation (opt-out wins)', USERID.includes('data.mustChangePassword = mustChangePassword ?? true'));
check('USER_SELECT exposes the flag', USERID.includes('mustChangePassword: true,'));

console.log('== Forced screen + client gates ==');
const SCREEN = read('src/components/change-password-screen.tsx') ?? '';
check("screen exists ('use client')", SCREEN.startsWith("'use client'"));
check('screen imports the pure strength module', SCREEN.includes("import { evaluatePasswordStrength } from '@/lib/password-strength';"));
const STRENGTH = read('src/lib/password-strength.ts') ?? '';
check('strength evaluator is a pure module (testable)', STRENGTH.includes('export function evaluatePasswordStrength'));
check('screen posts to the self-change endpoint', SCREEN.includes('profileApi.changePassword(currentPassword, newPassword)'));
check('screen re-fetches the user after success', SCREEN.includes('await fetchUser()'));
check('screen offers sign-out escape hatch', SCREEN.includes('handleSignOut'));
const PAGE = read('src/app/(shell)/page.tsx') ?? '';
check('root gate renders the screen when flagged', PAGE.includes('if (rotationPending) return <ChangePasswordScreen />;'));
const WG = read('src/components/workspace/workspace-gateway.tsx') ?? '';
check('branch workspace gate renders the screen', WG.includes('if (isAuthenticated && rotationPending) return <ChangePasswordScreen />;'));
const LS = read('src/components/login-screen.tsx') ?? '';
check('login skips the post-login redirect when flagged', LS.includes('if (flaggedUser?.mustChangePassword) return;'));
const SP = read('src/app/(selfservice)/employees/me/self-portal.tsx') ?? '';
check('employee portal guard renders the screen (RSC)', SP.includes('return { ok: false, note: <ChangePasswordScreen /> };'));
const STORES = read('src/lib/stores.ts') ?? '';
check('store listens for mid-session flips', STORES.includes("window.addEventListener('mbt:password-change-required'"));
const API = read('src/lib/api.ts') ?? '';
check('api layer dispatches on the 403 code', API.includes("rotationBody?.code === 'PASSWORD_CHANGE_REQUIRED'"));

console.log('== Admin surface: Settings → Users ==');
const ADMIN = read('src/app/(shell)/tabs/admin-tab.tsx') ?? '';
check('new-user rotation switch (default ON)', ADMIN.includes('mustChangePassword: true })'));
check('Force password reset row action', ADMIN.includes('forceResetMutation'));
check('violet "Rotation due" badge', ADMIN.includes('Rotation due'));
check('usersApi.create/update accept the flag', (read('src/lib/api.ts') ?? '').includes('mustChangePassword?: boolean }) =>') || (read('src/lib/api.ts') ?? '').includes('mustChangePassword?: boolean'));

console.log('== HR desk: PortalLinkDialog + corrected chip ==');
const PORTALACC = read('src/lib/hr/portal-account.ts') ?? '';
check('CreateLinkFormState carries the flag', PORTALACC.includes('mustChangePassword?: boolean'));
const PAYROLL = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('create-&-link sends the flag (default true)', PAYROLL.includes('mustChangePassword: form.mustChangePassword !== false'));
check('desk corrected chip uses a Tooltip', PAYROLL.includes('<Tooltip>') && PAYROLL.includes('Corrected by {l.editedByName}'));
check('tooltip carries the note', PAYROLL.includes('{l.editNote ? ('));
check('tooltip formatter uses editedAt', PAYROLL.includes("new Date(l.editedAt).toLocaleDateString('en-GB'"));

console.log('== Types ==');
const TYPES = read('src/lib/types.ts') ?? '';
check('AuthUser carries the flag', TYPES.includes('mustChangePassword?: boolean'));

console.log('== Tests, whats-new, version lockstep ==');
const T = read('src/tests/auth-password-rotation.test.ts') ?? '';
check('rotation test file exists', T !== null && T.length > 0);
check('rotation tests cover the server gate', T.includes('assertPasswordRotation') || T.includes('PASSWORD_CHANGE_REQUIRED'));
check('whats-new has the 2.44.0 entry', (read('src/lib/whats-new.ts') ?? '').includes("version: '2.44.0'"));
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json is 2.44.0', PKG.version === '2.44.0');
check('mbumah.releaseVersion lockstep', PKG.mbumah?.releaseVersion === '2.44.0');
check('verify:v2-44-0 registered', typeof PKG.scripts?.['verify:v2-44-0'] === 'string');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
