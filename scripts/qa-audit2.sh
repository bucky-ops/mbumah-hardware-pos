#!/bin/bash
# Combined verification: verbatim buyerPin decrypt + browser UI QA (one call).
cd /home/z/my-project
pkill -f "next dev -p 3000" 2>/dev/null; sleep 2; pkill -f "next-server" 2>/dev/null; sleep 1
export NODE_OPTIONS=--max-old-space-size=1536
nohup bun run dev > /tmp/qa-audit2.log 2>&1 &
SERVER_PID=$!
for i in $(seq 1 90); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null)
  [ "$CODE" = "200" ] && break; sleep 1
done
echo "server ready after ${i}s"

echo "── A. verbatim buyerPin decrypt on a KRA-registered customer's sale"
curl -s -c /tmp/owner.jar -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@mbumah.co.ke","password":"Mbumah@2025"}' -o /dev/null
python3 - <<'EOF'
import json, urllib.request
def get(url, cookie):
    req = urllib.request.Request("http://localhost:3000" + url)
    req.add_header("Cookie", cookie)
    return json.load(urllib.request.urlopen(req))
login = urllib.request.urlopen(urllib.request.Request(
    "http://localhost:3000/api/auth/login",
    data=json.dumps({"email":"owner@mbumah.co.ke","password":"Mbumah@2025"}).encode(),
    headers={"Content-Type":"application/json"}))
cookie = login.headers["Set-Cookie"].split(";")[0]
sales = get("/api/v1/sales?limit=100", cookie)
items = sales.get("items") or sales.get("sales") or []
target = next((s for s in items if s.get("customerName") == "Kamau Construction Ltd"), None)
if not target:
    print("  no Kamau sale found in first page — SKIP")
else:
    r = get(f"/api/v1/sales/{target['id']}", cookie)
    print(f"  ref={r['ref']} customerName={r['customerName']}")
    print(f"  buyerPin={r['buyerPin']}  (expect P051988776Q verbatim)")
    assert r["buyerPin"] == "P051988776Q", "BUYER PIN DECRYPT FAILED"
    print("  ✔ verbatim decrypt OK — eTIMS reprint intact")
EOF

echo "── B. browser UI QA (fresh session qa23)"
agent-browser open --session qa23 http://localhost:3000 2>&1 | tail -2
agent-browser snapshot --session qa23 2>&1 | head -30
echo "── login as owner"
agent-browser fill --session qa23 'input[type="email"]' "owner@mbumah.co.ke" 2>&1 | tail -1
agent-browser fill --session qa23 'input[type="password"]' "Mbumah@2025" 2>&1 | tail -1
agent-browser click --session qa23 'button[type="submit"]' 2>&1 | tail -1
sleep 4
agent-browser snapshot --session qa23 2>&1 | head -40

pkill -f "next dev -p 3000" 2>/dev/null; pkill -f "next-server" 2>/dev/null
kill $SERVER_PID 2>/dev/null
echo "COMBINED QA DONE"
