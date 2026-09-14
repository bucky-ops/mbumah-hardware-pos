#!/bin/bash
cd /home/z/my-project
ref_of() { agent-browser snapshot --session "$SESS" 2>/dev/null | grep -F "$1" | grep -oE 'ref=e[0-9]+' | head -1 | sed 's/ref=//'; }
SESS=q13f

NODE_OPTIONS=--max-old-space-size=1280 nohup bun run dev >/dev/null 2>&1 < /dev/null &
for i in $(seq 1 30); do sleep 2; c=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health); [ "$c" = "200" ] && break; done
curl -s -o /dev/null -w "warm:%{http_code}\n" http://localhost:3000/; sleep 2

echo "=== [A] OWNER: NEW PRODUCT E2E"
agent-browser open "http://localhost:3000" --session $SESS 2>&1 | tail -1; sleep 6
R=$(ref_of "Jane Mbumah"); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 1
R=$(ref_of "Sign in"); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 5
R=$(ref_of "tab \"Inventory\""); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 3
R=$(ref_of "Create a new product"); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 2
echo "dialog: $(agent-browser eval '!!document.querySelector("[role=dialog]")' --session $SESS 2>&1 | tail -1)"
agent-browser fill "#np-name" "Bosch GWS 750 4inch Angle Grinder" --session $SESS 2>&1 | tail -1
agent-browser fill "#np-buy" "1450" --session $SESS 2>&1 | tail -1
agent-browser fill "#np-sell" "2199" --session $SESS 2>&1 | tail -1
agent-browser fill "#np-stock" "25" --session $SESS 2>&1 | tail -1
agent-browser screenshot /tmp/q13f-dialog.png --session $SESS 2>&1 | tail -1
R=$(ref_of "Create product"); echo "create-ref:$R"; agent-browser click @$R --session $SESS 2>&1 | tail -1
sleep 4
agent-browser snapshot --session $SESS 2>&1 | grep -iE "Bosch GWS|created|Margin|RESTOCK" | head -8
agent-browser screenshot /tmp/q13f-created.png --session $SESS 2>&1 | tail -1

echo "=== [B] LOGOUT -> CASHIER DEGRADATION"
R=$(ref_of "Log out"); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 3
R=$(ref_of "Lucy Wanjiru"); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 1
R=$(ref_of "Sign in"); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 5
agent-browser screenshot /tmp/q13f-cashier-pos.png --session $SESS 2>&1 | tail -1
agent-browser snapshot --session $SESS 2>&1 | grep -iE "Manager view|Low stock|takings" | head -6
R=$(ref_of "tab \"Credit & Debts\""); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 2
agent-browser snapshot --session $SESS 2>&1 | grep -iE "Restricted|MANAGER and OWNER" | head -4
agent-browser screenshot /tmp/q13f-cashier-credit.png --session $SESS 2>&1 | tail -1

echo "=== [C] TEARDOWN"
agent-browser close --session $SESS 2>&1 | tail -1
pkill -f "next dev"; pkill -f "bun run dev"
echo FINAL-QA-DONE
