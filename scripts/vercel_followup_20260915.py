#!/usr/bin/env python3
"""Follow-up: correct W6 month count, find kmal.vercel.app owner, renamed-project domains."""
import json, urllib.parse, urllib.request, urllib.error, datetime
from collections import Counter

TOKEN = open('/home/z/my-project/.vercel-usage-token').read().strip()
TEAM = 'team_VmVQcu8Piwz4KvXho7u8PEG1'
BASE = 'https://api.vercel.com'

def req(method, path, body=None, params=None):
    url = BASE + path
    if params:
        url += '?' + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt.strip() else {})
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {'error': {'code': 'network', 'message': str(e)}}

# 1. month deployment count with correct since=Sept-1 + pagination
sept1 = int(datetime.datetime(2026, 9, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
all_rows, until = [], None
for _ in range(8):
    params = {'teamId': TEAM, 'limit': 100, 'since': sept1}
    if until: params['until'] = until
    st, d = req('GET', '/v6/deployments', params=params)
    if st != 200 or not d.get('deployments'): break
    all_rows += d['deployments']
    nxt = d.get('pagination', {}).get('next')
    if not nxt or nxt >= until if until else False: break
    if not nxt: break
    until = nxt
    if len(d['deployments']) < 100: break
now = datetime.datetime.now(datetime.timezone.utc)
day = now.day
pace = len(all_rows) / day * 30 if day else 0
print(f'MONTH deployments (since Sept 1): {len(all_rows)} -> projected ~{pace:.0f}/mo (flag >150)')
print('per-project:', dict(Counter(x.get('name') for x in all_rows)))
st_prod = sum(1 for x in all_rows if x.get('target') == 'production')
print(f'  production={st_prod} preview={len(all_rows)-st_prod}')
errs = [x for x in all_rows if x.get('state') == 'ERROR']
print(f'  errors this month: {len(errs)}')

# 2. find kmal.vercel.app owner
st, projs = req('GET', '/v9/projects', params={'teamId': TEAM, 'limit': 100})
for p in projs.get('projects', []):
    st, d = req('GET', f"/v9/projects/{p['name']}/domains", params={'teamId': TEAM})
    doms = [x['name'] for x in d.get('domains', [])] if st == 200 else None
    if doms is None:
        print(f"  {p['name']}: <query {st}>")
    elif doms:
        print(f"  {p['name']}: {doms}")

# 3. does kmal.vercel.app exist as alias at all?
st, d = req('GET', '/v4/domains', params={'teamId': TEAM, 'limit': 50})
if st == 200:
    print('registered external domains:', [x['name'] for x in d.get('domains', [])])

# 4. latest prod deployment per project (state)
for p in projs.get('projects', []):
    st, d = req('GET', '/v6/deployments', params={'teamId': TEAM, 'projectId': p['id'], 'target': 'production', 'limit': 1})
    if st == 200 and d.get('deployments'):
        x = d['deployments'][0]
        t = datetime.datetime.fromtimestamp(x['created']/1000, datetime.timezone.utc).strftime('%m-%d %H:%M')
        print(f"  LATEST-PROD {p['name']:36} {x.get('state'):7} {t}  {(x.get('meta') or {}).get('githubCommitSha','')[:7]}")
    else:
        print(f"  LATEST-PROD {p['name']:36} (none)")
