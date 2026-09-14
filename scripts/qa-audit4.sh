#!/bin/bash
# Final verification v2: Kamau reprint decrypt + Customers tab + errors.
cd /home/z/my-project
pkill -f "next dev -p 3000" 2>/dev/null; sleep 2; pkill -f "next-server" 2>/dev/null; sleep 1
export NODE_OPTIONS=--max-old-space-size=1536
nohup bun run dev > /tmp/qa-audit4.log 2>&1 &
SERVER_PID=$!
for i in $(seq 1 90); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null)
  [ "$CODE" = "200" ] && break; sleep 1
done
echo "server ready after ${i}s"

echo "── A. reprint a Kamau Construction sale (verbatim buyerPin decrypt)"
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
found = None
for offset in (0, 50, 100, 150, 200):
    d = get(f"/api/v1/sales?limit=50&offset={offset}", cookie)
    items = d.get("items") or d.get("sales") or []
    if not items: break
    for s in items:
        cust = s.get("customer")
        name = cust if isinstance(cust, str) else (cust or {}).get("name")
        if name == "Kamau Construction Ltd":
            found = s; break
    if found: break
if not found:
    print("  no Kamau sale found anywhere — list may only include recent sales")
else:
    r = get(f"/api/v1/sales/{found['id']}", cookie)
    print(f"  reprint ref={r['ref']} customer={r['customerName']}")
    print(f"  buyerPin={r['buyerPin']} (expect P051988776Q)")
    assert r["buyerPin"] == "P051988776Q", "DECRYPT MISMATCH"
    print("  ✔ sales/[id] verbatim decrypt OK (eTIMS reprint path)")
EOF

echo "── B. credit checkout with Kamau (STORE_CREDIT gate + receipt buyerPin)"
python3 - <<'EOF'
import json, urllib.request
def req(url, cookie=None, data=None):
    r = urllib.request.Request("http://localhost:3000" + url,
        data=json.dumps(data).encode() if data else None,
        headers={"Content-Type":"application/json"})
    if cookie: r.add_header("Cookie", cookie)
    return urllib.request.urlopen(r)
login = req("/api/auth/login", data={"email":"owner@mbumah.co.ke","password":"Mbumah@2025"})
cookie = login.headers["Set-Cookie"].split(";")[0]
prods = json.load(req("/api/products?limit=1", cookie))
pid = prods["items"][0]["id"]
custs = json.load(req("/api/customers", cookie))
kamau = next(c for c in custs["items"] if c["name"] == "Kamau Construction Ltd")
body = {"items":[{"productId":pid,"qty":1,"discountPct":0}],
        "payments":[{"method":"STORE_CREDIT","amount":500}],
        "customerId":kamau["id"], "vatInclusive":True}
res = json.load(req("/api/v1/sales/checkout", cookie, body))
r = res["receipt"]
print(f"  ref={res['transaction']['ref']} status={res['transaction']['status']}")
print(f"  buyerPin on NEW credit receipt: {r['buyerPin']} (expect P051988776Q)")
assert r["buyerPin"] == "P051988776Q", "CHECKOUT RECEIPT DECRYPT FAILED"
print("  ✔ checkout receipt verbatim decrypt OK — eTIMS B2B invoice intact")
print(f"  riskScore returned: {res.get('riskScore')}")
EOF

echo "── C. browser: Customers tab masked PIN + console/page errors"
agent-browser open --session qa24 http://localhost:3000 > /dev/null 2>&1
sleep 3
agent-browser fill --session qa24 'input[type="email"]' "owner@mbumah.co.ke" > /dev/null 2>&1
agent-browser fill --session qa24 'input[type="password"]' "Mbumah@2025" > /dev/null 2>&1
agent-browser click --session qa24 'button[type="submit"]' > /dev/null 2>&1
sleep 4
agent-browser click --session qa24 'button[role="tab"]:has-text("Customers")' > /dev/null 2>&1 || \
  agent-browser click --session qa24 '[role="tab"] >> text=Customers' > /dev/null 2>&1
sleep 2
echo "  masked PINs visible in Customers tab:"
agent-browser snapshot --session qa24 2>&1 | rg -o 'P0\*\*\*[0-9A-Z]{3}|\*{8}[0-9A-Z]{3}' | head -8
agent-browser screenshot --session qa24 /home/z/my-project/download/qa23-customers-masked-pins.png > /dev/null 2>&1
echo "  page errors:"
agent-browser errors --session qa24 2>&1 | head -6 || true
echo "  console errors:"
agent-browser console --session qa24 2>&1 | rg -i "error" | head -6 || echo "  (none)"

pkill -f "next dev -p 3000" 2>/dev/null; pkill -f "next-server" 2>/dev/null
kill $SERVER_PID 2>/dev/null
echo "FINAL QA V2 DONE"
