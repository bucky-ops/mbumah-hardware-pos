#!/usr/bin/env python3
"""Vercel account ops: execute action-plan tasks 1-6, then run the weekly health check.

Tasks:
  T1: delete duplicate mbumah-hardware-pos-ltcm (after alias safety check)
  T2: diagnose failing `web` production builds (fix if config-only)
  T3: delete 4 no-git leftover projects
  T4: rename `web` -> kenya-malnutrition-predictor; attach nowa domains; try kmal alias
  T5: best-effort probe of usage notification settings API
  T6: (cron creation handled outside the script)
Then weekly-check phases W1..W6 per job 385248 spec.
"""
import json
import time
import urllib.parse
import urllib.request
import urllib.error
import datetime

TOKEN = open('/home/z/my-project/.vercel-usage-token').read().strip()
TEAM = 'team_VmVQcu8Piwz4KvXho7u8PEG1'
BASE = 'https://api.vercel.com'


def req(method, path, body=None, params=None):
    url = BASE + path
    if params:
        url += '?' + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers={
        'Authorization': f'Bearer {TOKEN}',
        'Content-Type': 'application/json',
    }, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt.strip() else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {'error': {'code': 'network', 'message': str(e)}}


def ts(days_ago=0, days_ahead=0, midnight=False):
    now = datetime.datetime.now(datetime.timezone.utc)
    d = now - datetime.timedelta(days=days_ago) + datetime.timedelta(days=days_ahead)
    if midnight:
        d = d.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(d.timestamp() * 1000)


def log_texts(ev):
    """Flatten /v2/deployments/{uid}/events payloads (body may be a bare array, nested)."""
    out = []
    def walk(item):
        if isinstance(item, list):
            for i in item:
                walk(i)
        elif isinstance(item, dict):
            if 'events' in item:
                walk(item['events'])
            pl = item.get('payload') or {}
            t = pl.get('text') or pl.get('errorMessage') or item.get('text') or ''
            if t:
                out.append(str(t))
    walk(ev)
    return out


def dep_row(x):
    t = datetime.datetime.fromtimestamp(x['created'] / 1000, datetime.timezone.utc)
    meta = x.get('meta') or {}
    return {
        'uid': x['uid'], 'date': t.strftime('%m-%d %H:%M'), 'project': x.get('name'),
        'target': x.get('target') or 'preview', 'state': x.get('state'),
        'msg': (meta.get('githubCommitMessage') or meta.get('gitlabCommitMessage') or '')[:60],
        'sha': (meta.get('githubCommitSha') or '')[:7],
        'url': x.get('url'),
    }


print('=' * 70)
print('PHASE 0: AUTH + SNAPSHOT')
print('=' * 70)
st, user = req('GET', '/v2/user')
if st in (401, 403):
    print(f'AUTH FAILED ({st}) -> CHECK SKIPPED')
    raise SystemExit(1)
print('auth OK:', user['user']['email'], '| plan:', user['user']['billing']['plan'])

st, projs = req('GET', '/v9/projects', params={'teamId': TEAM, 'limit': 100})
plist = projs.get('projects', [])
print(f'projects BEFORE: {len(plist)}')
for p in plist:
    link = p.get('link') or {}
    repo = f"{link.get('org', '')}/{link.get('repo', '')}" if link.get('repo') else '-no-git-'
    print(f"  {p['name']:38} {repo}")

P = {p['name']: p for p in plist}

print()
print('=' * 70)
print('PHASE A: SAFETY PRE-CHECKS')
print('=' * 70)

# A1: ltcm alias/domain safety check
ltcm_domains = []
if 'mbumah-hardware-pos-ltcm' in P:
    st, d = req('GET', f"/v9/projects/mbumah-hardware-pos-ltcm/domains", params={'teamId': TEAM})
    if st == 200:
        ltcm_domains = [x['name'] for x in d.get('domains', [])]
    print(f'A1 ltcm domains: {ltcm_domains}')
    st, latest = req('GET', '/v6/deployments', params={'teamId': TEAM, 'projectId': P['mbumah-hardware-pos-ltcm']['id'], 'target': 'production', 'limit': 1, 'state': 'READY'})
    lrow = dep_row(latest['deployments'][0]) if st == 200 and latest.get('deployments') else None
    print(f'A1 ltcm latest READY prod deploy: {lrow}')
else:
    print('A1 ltcm already absent')

# A2: main mbumah must own the production domain
st, d = req('GET', '/v9/projects/mbumah-hardware-pos/domains', params={'teamId': TEAM})
main_domains = [x['name'] for x in d.get('domains', [])] if st == 200 else []
print(f'A2 main mbumah domains: {main_domains}')
SAFE_T1 = ('mbumah-hardware-pos-one.vercel.app' in main_domains
           and all(x.startswith('mbumah-hardware-pos-ltcm') for x in ltcm_domains))
print(f'A2 SAFE to delete ltcm: {SAFE_T1}')

# A3: web domains + latest prod state + recent errors
if 'web' in P:
    st, d = req('GET', '/v9/projects/web/domains', params={'teamId': TEAM})
    web_domains = [x['name'] for x in d.get('domains', [])] if st == 200 else []
    print(f'A3 web domains: {web_domains}')
    st, latest = req('GET', '/v6/deployments', params={'teamId': TEAM, 'projectId': P['web']['id'], 'target': 'production', 'limit': 1})
    wl = dep_row(latest['deployments'][0]) if st == 200 and latest.get('deployments') else None
    print(f'A3 web LATEST prod deploy: {wl}')
else:
    web_domains = []
    print('A3 web already absent/renamed')

# A4: leftover projects: confirm no domains, no git
leftovers = ['my-project', 'login-system', 'login-system1', 'v0-new-project-vugzc04ppeh']
for name in leftovers:
    if name not in P:
        print(f'A4 {name}: absent already'); continue
    link = P[name].get('link') or {}
    has_git = bool(link.get('repo'))
    st, d = req('GET', f'/v9/projects/{name}/domains', params={'teamId': TEAM})
    dl = [x['name'] for x in d.get('domains', [])] if st == 200 else ['<ERR>']
    print(f'A4 {name}: git={has_git} domains={dl}')
    if has_git or dl:
        print(f'  !! {name} NOT safe to delete (has git or domains)')

print()
print('=' * 70)
print('PHASE B: ACTIONS (user-approved tasks 1-6)')
print('=' * 70)

# T1: delete duplicate ltcm
if SAFE_T1:
    st, r = req('DELETE', '/v9/projects/mbumah-hardware-pos-ltcm', params={'teamId': TEAM})
    print(f'T1 DELETE mbumah-hardware-pos-ltcm -> HTTP {st} {"" if st in (200,204) else r}')
else:
    print('T1 SKIPPED (safety check failed)')

# T3: delete leftovers
for name in leftovers:
    if name not in P:
        print(f'T3 {name}: already absent'); continue
    st, d = req('GET', f'/v9/projects/{name}/domains', params={'teamId': TEAM})
    dl = [x['name'] for x in d.get('domains', [])] if st == 200 else ['<ERR>']
    link = P[name].get('link') or {}
    if not dl and not link.get('repo'):
        st, r = req('DELETE', f'/v9/projects/{name}', params={'teamId': TEAM})
        print(f'T3 DELETE {name} -> HTTP {st} {"" if st in (200,204) else r}')
    else:
        print(f'T3 {name} SKIPPED (git={bool(link.get("repo"))}, domains={dl})')

# T2: diagnose web errors (logs of most recent ERROR deploy)
if 'web' in P:
    st, errs = req('GET', '/v6/deployments', params={'teamId': TEAM, 'projectId': P['web']['id'], 'state': 'ERROR', 'limit': 3, 'since': ts(days_ago=10)})
    if st == 200 and errs.get('deployments'):
        print(f'T2 web ERROR deployments (last 10d): {len(errs["deployments"])}')
        for x in errs['deployments']:
            print('   -', dep_row(x))
        uid = errs['deployments'][0]['uid']
        st, ev = req('GET', f'/v2/deployments/{uid}/events', params={'teamId': TEAM, 'builds': 1, 'limit': 100})
        if st == 200:
            blob = '\n'.join(log_texts(ev))
            tail = blob[-1500:]
            print(f'T2 build-log tail of {uid}:')
            for line in tail.splitlines()[-25:]:
                print('   |', line[:150])
    else:
        print('T2 no web ERROR deployments found in last 10d')

# T4a: rename web -> kenya-malnutrition-predictor
RENAMED = False
if 'web' in P:
    st, r = req('PATCH', '/v9/projects/web', params={'teamId': TEAM}, body={'name': 'kenya-malnutrition-predictor'})
    RENAMED = st == 200
    print(f'T4a RENAME web -> kenya-malnutrition-predictor -> HTTP {st} {"" if st == 200 else r}')

# T4b: attach nowa domains to nowa-systems
for dom in ['nowa-systems.app', 'nowa-systems.org', 'nowa-systems-credit.app']:
    st, r = req('POST', '/v9/projects/nowa-systems/domains', params={'teamId': TEAM}, body={'name': dom})
    print(f'T4b ATTACH {dom} -> nowa-systems -> HTTP {st} {"" if st == 200 else json.dumps(r)[:160]}')

# T4c: try kmal.vercel.app alias on renamed project
target = 'kenya-malnutrition-predictor' if 'kenya-malnutrition-predictor' in P else ('web' if 'web' in P else None)
if target:
    st, r = req('POST', f'/v9/projects/{target}/domains', params={'teamId': TEAM}, body={'name': 'kmal.vercel.app'})
    print(f'T4c ADD kmal.vercel.app -> {target} -> HTTP {st} {"" if st == 200 else json.dumps(r)[:160]}')

# T5: probe notification-settings endpoints (best effort)
for ep in ['/v2/user/notification-settings', f'/v3/teams/{TEAM}/notification-settings']:
    st, r = req('GET', ep)
    print(f'T5 PROBE GET {ep} -> HTTP {st} {json.dumps(r)[:120] if st != 200 else "OK"}')

print()
print('=' * 70)
print('PHASE C: WEEKLY HEALTH CHECK (post-actions, job 385248 spec)')
print('=' * 70)

time.sleep(2)
st, projs = req('GET', '/v9/projects', params={'teamId': TEAM, 'limit': 100})
plist = projs.get('projects', [])
print(f'W1 project count: {len(plist)} (expected 8)')
repo_map = {}
for p in plist:
    link = p.get('link') or {}
    if link.get('repo'):
        repo_map.setdefault(f"{link.get('org')}/{link.get('repo')}", []).append(p['name'])
dups = {k: v for k, v in repo_map.items() if len(v) > 1}
print(f'W1 duplicate-repo groups: {dups if dups else "NONE (PASS)"}')
for p in plist:
    print(f'  - {p["name"]}')

# W2: deployments last 7d
st, w = req('GET', '/v6/deployments', params={'teamId': TEAM, 'limit': 100, 'since': ts(days_ago=7)})
rows = [dep_row(x) for x in w.get('deployments', [])] if st == 200 else []
prod = [r for r in rows if r['target'] == 'production']
prev = [r for r in rows if r['target'] == 'preview']
errs7 = [r for r in rows if r['state'] == 'ERROR']
print(f'W2 last-7d deployments: total={len(rows)} prod={len(prod)} preview={len(prev)} errors={len(errs7)}')
from collections import Counter
print('W2 per-project:', dict(Counter(r['project'] for r in rows)))
for r in errs7:
    print('W2 ERROR:', r)

# W3: logs for the newest error (any project)
if errs7:
    uid = errs7[0]['uid']
    st, ev = req('GET', f'/v2/deployments/{uid}/events', params={'teamId': TEAM, 'builds': 1, 'limit': 100})
    if st == 200:
        blob = '\n'.join(log_texts(ev))
        print(f'W3 newest-error log tail ({uid}):')
        for line in blob[-1400:].splitlines()[-22:]:
            print('   |', line[:150])

# W5b: latest production deployment state for the renamed project + mbumah
for pname in ['kenya-malnutrition-predictor', 'mbumah-hardware-pos']:
    st, latest = req('GET', '/v6/deployments', params={'teamId': TEAM, 'projectId': P[pname]['id'], 'target': 'production', 'limit': 3})
    if st == 200 and latest.get('deployments'):
        print(f'W5b latest prod deploys of {pname}:')
        for x in latest['deployments'][:3]:
            print('   ', dep_row(x))

# W4: domain attachments
st, d = req('GET', '/v9/projects/nowa-systems/domains', params={'teamId': TEAM})
nd = sorted(x['name'] for x in d.get('domains', [])) if st == 200 else ['<ERR>']
print(f'W4 nowa-systems domains: {nd} (expect 3 nowa domains)')
kt = 'kenya-malnutrition-predictor' if RENAMED else 'web'
st, d = req('GET', f'/v9/projects/{kt}/domains', params={'teamId': TEAM})
kd = sorted(x['name'] for x in d.get('domains', [])) if st == 200 else ['<ERR>']
print(f'W4 {kt} domains: {kd}')

# W5: mbumah prod domain + latest prod READY
st, d = req('GET', '/v9/projects/mbumah-hardware-pos/domains', params={'teamId': TEAM})
md = [x['name'] for x in d.get('domains', [])] if st == 200 else []
print(f'W5 mbumah-hardware-pos domains: {md}')
print(f'W5 mbumah-hardware-pos-one.vercel.app intact: {"mbumah-hardware-pos-one.vercel.app" in md}')
st, latest = req('GET', '/v6/deployments', params={'teamId': TEAM, 'projectId': 'prj_QRudtTd5IjPzxtf1MWL5ECSBFLXf', 'target': 'production', 'limit': 1})
lr = dep_row(latest['deployments'][0]) if st == 200 and latest.get('deployments') else None
print(f'W5 latest mbumah prod deploy: {lr}')

# W6: build pace this month
st, m = req('GET', '/v6/deployments', params={'teamId': TEAM, 'limit': 100, 'since': ts(midnight=True, days_ahead=0)})
month_rows = []
if st == 200:
    month_rows = list(m.get('deployments', []))
    # paginate if needed
    guard = 0
    while m.get('pagination', {}).get('next') and len(month_rows) < 400 and guard < 5:
        until = m['pagination']['next']
        st, m = req('GET', '/v6/deployments', params={'teamId': TEAM, 'limit': 100, 'since': ts(midnight=True), 'until': until})
        if st != 200 or not m.get('deployments'):
            break
        month_rows += m['deployments']
        guard += 1
now = datetime.datetime.now(datetime.timezone.utc)
day_of_month = now.day
pace = len(month_rows) / day_of_month * 30 if day_of_month else 0
print(f'W6 deployments this month so far: {len(month_rows)} (day {day_of_month}) -> projected ~{pace:.0f}/mo (flag if >150)')
print('W6 per-project month:', dict(Counter(x.get('name') for x in month_rows)))

print()
print('DONE')
