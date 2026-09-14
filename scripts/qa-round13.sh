#!/bin/bash
# Round 13 QA v2 — ref-driven clicks, all inside one call.
cd /home/z/my-project
ref_of() { agent-browser snapshot --session "$SESS" 2>/dev/null | grep -F "$1" | grep -oE 'ref=e[0-9]+' | head -1 | sed 's/ref=//'; }

SESS=q13r
echo "=== [1] SERVER"
NODE_OPTIONS=--max-old-space-size=1280 nohup bun run dev >/dev/null 2>&1 < /dev/null &
for i in $(seq 1 30); do sleep 2; c=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health); [ "$c" = "200" ] && break; done
curl -s -o /dev/null -w "warm:%{http_code}\n" http://localhost:3000/; sleep 2

echo "=== [2] LOGIN OWNER (refs)"
agent-browser open "http://localhost:3000" --session $SESS 2>&1 | tail -1
sleep 6
R=$(ref_of "Jane Mbumah"); echo "demo-ref:$R"; agent-browser click @$R --session $SESS 2>&1 | tail -1
sleep 1
R=$(ref_of "Sign in" | tail -1); echo "signin-ref:$R"; agent-browser click @$R --session $SESS 2>&1 | tail -1
sleep 5
agent-browser snapshot --session $SESS 2>&1 | grep -E "tab \"|Low stock|takings|Receivables|Transactions" | head -10

echo "=== [3] POS KPI STRIP + screenshot"
agent-browser screenshot /tmp/q13r-pos.png --session $SESS 2>&1 | tail -1

echo "=== [4] NEW PRODUCT E2E"
R=$(ref_of "tab \"Inventory\""); agent-browser click @$R --session $SESS 2>&1 | tail -1
sleep 3
R=$(ref_of "Create a new product"); echo "newprod-btn:$R"; agent-browser click @$R --session $SESS 2>&1 | tail -1
sleep 2
agent-browser fill "#np-name" "Bosch GWS 750 4inch Angle Grinder" --session $SESS 2>&1 | tail -1
agent-browser fill "#np-buy" "1450" --session $SESS 2>&1 | tail -1
agent-browser fill "#np-sell" "2199" --session $SESS 2>&1 | tail -1
agent-browser fill "#np-stock" "25" --session $SESS 2>&1 | tail -1
agent-browser screenshot /tmp/q13r-newprod.png --session $SESS 2>&1 | tail -1
R=$(ref_of "Create product"); echo "create-btn:$R"; agent-browser click @$R --session $SESS 2>&1 | tail -1
sleep 3
agent-browser snapshot --session $SESS 2>&1 | grep -iE "Bosch GWS|created|Margin" | head -5

echo "=== [5] MOVEMENTS LOG"
agent-browser snapshot --session $SESS 2>&1 | grep -iE "Recent stock movements|RESTOCK|Bosch GWS|WRITE" | head -6

echo "=== [6] ADMIN + SALES HISTORY"
R=$(ref_of "tab \"Admin\""); agent-browser click @$R --session $SESS 2>&1 | tail -1
sleep 3
agent-browser screenshot /tmp/q13r-admin.png --session $SESS 2>&1 | tail -1
agent-browser snapshot --session $SESS 2>&1 | grep -iE "Sales history|Receipt\"|MBM-HQ-2026" | head -6
R=$(ref_of '"Receipt"'); echo "receipt-btn:$R"; agent-browser click @$R --session $SESS 2>&1 | tail -1
sleep 3
agent-browser screenshot /tmp/q13r-reprint.png --session $SESS 2>&1 | tail -1
agent-browser snapshot --session $SESS 2>&1 | grep -iE "REPRINT|KRA PIN|TOTAL" | head -6
agent-browser press Escape --session $SESS 2>&1 | tail -1

echo "=== [7] SHORTCUTS DIALOG"
R=$(ref_of "Keyboard shortcuts"); agent-browser click @$R --session $SESS 2>&1 | tail -1
sleep 2
agent-browser screenshot /tmp/q13r-shortcuts.png --session $SESS 2>&1 | tail -1
agent-browser snapshot --session $SESS 2>&1 | grep -iE "Pro tip|Everywhere|merge" | head -5
agent-browser press Escape --session $SESS 2>&1 | tail -1

echo "=== [8] TEARDOWN"
agent-browser close --session $SESS 2>&1 | tail -1
pkill -f "next dev"; pkill -f "bun run dev"
echo "QA-V2-DONE"
