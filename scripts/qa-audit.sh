#!/bin/bash
# Self-contained API QA for the audit patches (boot → test → kill in ONE call).
cd /home/z/my-project

echo "── 0. stop supervisor-owned dev server"
pkill -f "next dev -p 3000" 2>/dev/null; sleep 2
pkill -f "next-server" 2>/dev/null; sleep 1

echo "── 1. boot fresh dev server (heap-capped)"
export NODE_OPTIONS=--max-old-space-size=1536
nohup bun run dev > /tmp/qa-audit.log 2>&1 &
SERVER_PID=$!
READY=0
for i in $(seq 1 90); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null)
  if [ "$CODE" = "200" ]; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ]; then echo "SERVER FAILED TO BOOT"; tail -30 /tmp/qa-audit.log; kill $SERVER_PID 2>/dev/null; exit 1; fi
echo "server ready after ${i}s"

echo "── 2. owner login"
curl -s -c /tmp/owner.jar -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@mbumah.co.ke","password":"Mbumah@2025"}' | head -c 160; echo

echo "── 3. GUARDRAIL-4 check: customers list must show MASKED pins"
curl -s -b /tmp/owner.jar 'localhost:3000/api/customers' | python3 -c "
import json,sys
d=json.load(sys.stdin)
for c in d['items']:
    print(f\"  {c['name']:28s} kraPin={c['kraPin']}\")"

echo "── 4. single-customer GET ([id]) — masked pin expected"
CID=$(curl -s -b /tmp/owner.jar 'localhost:3000/api/customers' | python3 -c "import json,sys; d=json.load(sys.stdin); print([c['id'] for c in d['items'] if c['kraPin']][0])")
curl -s -b /tmp/owner.jar "localhost:3000/api/customers/$CID" | python3 -c "import json,sys; c=json.load(sys.stdin)['customer']; print('  kraPin:', c['kraPin'])"

echo "── 5. GUARDRAIL-1 check: proxy layer 1 RBAC"
curl -s -c /tmp/cash.jar -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"cashier@mbumah.co.ke","password":"Mbumah@2025"}' -o /dev/null
for ep in /api/users /api/branches /api/audit /api/v1/reports/eod /api/v1/credit/aging /api/v1/drawer; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/cash.jar "localhost:3000$ep")
  echo "  cashier GET $ep → $CODE (expect 403)"
done
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/cash.jar -X POST localhost:3000/api/v1/credit/repay -H 'Content-Type: application/json' -d '{}')
echo "  cashier POST /api/v1/credit/repay → $CODE (expect 400/404 — repay is any-role)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "localhost:3000/api/v1/sales")
echo "  anonymous GET /api/v1/sales → $CODE (expect 401)"

echo "── 6. checkout smoke: CAS stock decrement + receipt buyerPin decrypt"
PID=$(curl -s -b /tmp/cash.jar 'localhost:3000/api/products?limit=1' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['items'][0]['id'])")
curl -s -b /tmp/cash.jar -X POST localhost:3000/api/v1/sales/checkout \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: MBM-HQ-QATEST-001' \
  -d "{\"items\":[{\"productId\":\"$PID\",\"qty\":1,\"discountPct\":0}],\"payments\":[{\"method\":\"CASH\",\"amount\":10000}],\"vatInclusive\":true}" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
t=d.get('transaction',{})
r=d.get('receipt',{})
print('  ref:', t.get('ref'), '| status:', t.get('status'), '| total:', t.get('totalAmount'))
print('  buyerPin on receipt:', r.get('buyerPin'), '(walk-in → None expected)')"

echo "── 7. duplicate idempotency key → same sale, no double charge"
curl -s -b /tmp/cash.jar -X POST localhost:3000/api/v1/sales/checkout \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: MBM-HQ-QATEST-001' \
  -d "{\"items\":[{\"productId\":\"$PID\",\"qty\":1,\"discountPct\":0}],\"payments\":[{\"method\":\"CASH\",\"amount\":10000}],\"vatInclusive\":true}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('  duplicate:', d.get('duplicate'), '| ref:', d.get('transaction',{}).get('ref'))"

echo "── 8. reprint path (sales/[id]) decrypts buyerPin from ciphertext"
SALE_ID=$(curl -s -b /tmp/owner.jar 'localhost:3000/api/v1/sales?limit=1' | python3 -c "import json,sys; d=json.load(sys.stdin); items=d.get('items') or d.get('sales') or []; print(items[0]['id'] if items else '')")
if [ -n "$SALE_ID" ]; then
  curl -s -b /tmp/owner.jar "localhost:3000/api/v1/sales/$SALE_ID" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  reprint ref:', d.get('ref'), '| buyerPin:', d.get('buyerPin'), '| branch kraPin:', d.get('kraPin'))"
fi

echo "── 9. stale-compile canary: server log tail"
rg -i "error|unknown arg" /tmp/qa-audit.log | rg -v "warn" | head -5 || echo "  (no errors in server log)"

echo "── 10. stop server (protocol: reaper kills it anyway at call end)"
kill $SERVER_PID 2>/dev/null
pkill -f "next dev -p 3000" 2>/dev/null
echo "QA DONE"
