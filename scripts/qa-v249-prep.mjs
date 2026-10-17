// v2.49.0 E2E prep (curl side): login as owner → create SUPPLEMENTARY run on
// the OPEN October 2026 period → validate → submit → approve. The final POST
// (banner capture) happens in the browser as admin.
const BASE = 'http://localhost:3200';

let CSRF = '';
async function initCsrf() {
  const res = await fetch(`${BASE}/api/security/csrf-token`);
  const json = await res.json();
  CSRF = json.data?.token ?? '';
  if (!CSRF) throw new Error('no csrf token');
  // Double-submit: the X-CSRF-Token header must equal the csrf_token COOKIE,
  // so every request below carries Cookie: csrf_token=<token> as well.
}

function cookieHeader() {
  return `csrf_token=${CSRF}`;
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF, Cookie: cookieHeader() },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  const token = json.token ?? json.data?.token;
  if (!res.ok || !token) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return { token };
}

async function api(token, method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-CSRF-Token': CSRF,
      Cookie: cookieHeader(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

await initCsrf();
const owner = await login('owner@mbumahhardware.co.ke', 'password123');
console.log('owner logged in');

// 1. Find the OPEN October 2026 period
const periods = await api(owner.token, 'GET', '/api/payroll/periods');
const period = (periods.json.data ?? []).find((p) => p.name === 'October 2026' && p.status === 'OPEN');
if (!period) throw new Error('no OPEN October 2026 period: ' + JSON.stringify(periods.json).slice(0, 300));
console.log('period:', period.id, period.name, period.status);

// 2. Create the SUPPLEMENTARY run
const created = await api(owner.token, 'POST', '/api/payroll/runs', {
  payrollPeriodId: period.id,
  runType: 'OFF_CYCLE',
  note: 'v2.49.0 QA — employee payslip-issued notices E2E',
});
console.log('create:', created.status, JSON.stringify(created.json).slice(0, 300));
const runId = created.json.data?.id;
if (!runId) throw new Error('no run id');

// 3. Validate
const validated = await api(owner.token, 'POST', `/api/payroll/runs/${runId}/validate`, {});
console.log('validate:', validated.status, JSON.stringify(validated.json).slice(0, 260));

// 4. Submit
const submitted = await api(owner.token, 'POST', `/api/payroll/runs/${runId}/submit`, {});
console.log('submit:', submitted.status, JSON.stringify(submitted.json).slice(0, 200));

// 5. Approve as ADMIN (owner is the maker; maker-checker wants a second person)
const admin = await login('admin@mbumahhardware.co.ke', 'password123');
console.log('admin logged in');
const approved = await api(admin.token, 'POST', `/api/payroll/runs/${runId}/approve`, {});
console.log('approve:', approved.status, JSON.stringify(approved.json).slice(0, 200));

console.log('RUN_ID=' + runId);
