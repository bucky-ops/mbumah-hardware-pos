#!/bin/bash
cd /home/z/my-project
ref_of() { agent-browser snapshot --session "$SESS" 2>/dev/null | grep -F "$1" | grep -oE 'ref=e[0-9]+' | head -1 | sed 's/ref=//'; }
SESS=q13d

NODE_OPTIONS=--max-old-space-size=1280 nohup bun run dev >/dev/null 2>&1 < /dev/null &
for i in $(seq 1 30); do sleep 2; c=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health); [ "$c" = "200" ] && break; done
curl -s -o /dev/null -w "warm:%{http_code}\n" http://localhost:3000/; sleep 2

agent-browser open "http://localhost:3000" --session $SESS 2>&1 | tail -1; sleep 6
R=$(ref_of "Jane Mbumah"); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 1
R=$(ref_of "Sign in"); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 5

echo "=== DEBUG NEW PRODUCT DIALOG"
R=$(ref_of "tab \"Inventory\""); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 3
R=$(ref_of "Create a new product"); echo "btn-ref:$R"
agent-browser eval "window.__clicks=[]; document.querySelector(\"button[aria-label='Create a new product']\").addEventListener('click',()=>window.__clicks.push(1)); 'hooked'" --session $SESS 2>&1 | tail -1
agent-browser click "button[aria-label='Create a new product']" --session $SESS 2>&1 | tail -1
sleep 2
echo "clicks-fired: $(agent-browser eval 'window.__clicks.length' --session $SESS 2>&1 | tail -1)"
echo "dialog-present: $(agent-browser eval '!!document.querySelector("[role=dialog]")' --session $SESS 2>&1 | tail -1)"
agent-browser console --session $SESS 2>&1 | grep -iE "error|warn" | tail -6
agent-browser screenshot /tmp/q13d-dialog.png --session $SESS 2>&1 | tail -1
agent-browser snapshot --session $SESS 2>&1 | grep -iE "dialog|np-name|Create product" | head -6

echo "=== RECEIPT REPRINT (fixed ref pattern)"
agent-browser press Escape --session $SESS 2>&1 >/dev/null
R=$(ref_of "tab \"Admin\""); agent-browser click @$R --session $SESS 2>&1 | tail -1; sleep 3
R=$(ref_of "Reprint receipt for"); echo "reprint-ref:$R"
agent-browser click @$R --session $SESS 2>&1 | tail -1
sleep 3
agent-browser screenshot /tmp/q13d-reprint.png --session $SESS 2>&1 | tail -1
agent-browser snapshot --session $SESS 2>&1 | grep -iE "REPRINT|KRA PIN|TOTAL|dialog \"" | head -8
agent-browser console --session $SESS 2>&1 | grep -iE "error" | tail -4
agent-browser press Escape --session $SESS 2>&1 >/dev/null

echo "=== TEARDOWN"
agent-browser close --session $SESS 2>&1 | tail -1
pkill -f "next dev"; pkill -f "bun run dev"
echo DEBUG-DONE
