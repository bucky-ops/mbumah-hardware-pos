#!/usr/bin/env python3
"""Seed realistic staff chat conversations for all 5 Mbumah stores via
POST /api/admin/bulk-seed (table=chats). Idempotent: deterministic ids
seedv_<code>_<NN> / seedmsg_<code>_<NN>_<MM>.
Themes per store (32 conversations):
  16 daily-sales updates (8 morning briefs + 8 evening closes),
  5 inventory/restock, 4 customer-service (typed CUSTOMER_SUPPORT),
  3 team meetings.
Run: python3 scripts/populate/seed_chats.py  (needs /tmp/qa_tok_admin.txt,
/tmp/qa_csrf.txt and /tmp/staff_store_*.json present; see worklog Task 28/29).
"""
import json, random, urllib.request, urllib.error, os
from datetime import datetime, timedelta, timezone

random.seed(42)

TOKEN_PATH = os.environ.get("MBM_TOKEN", "/tmp/qa_tok_admin.txt")
CSRF_PATH = os.environ.get("MBM_CSRF", "/tmp/qa_csrf.txt")
STAFF_DIR = os.environ.get("MBM_STAFF_DIR", "/tmp")
BASE = os.environ.get("MBM_BASE", "https://mbumah-hardware-pos-one.vercel.app")

TOKEN = open(TOKEN_PATH).read().strip()
CSRF = open(CSRF_PATH).read().strip()


def post_bulk(table, rows):
    body = json.dumps({"table": table, "rows": rows}).encode()
    req = urllib.request.Request(BASE + "/api/admin/bulk-seed", data=body, method="POST", headers={
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json",
        "X-CSRF-Token": CSRF, "Origin": BASE, "Referer": BASE + "/",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"success": False, "status": e.code, "error": e.read().decode()[:300]}


def staff_path(sid):
    return os.path.join(STAFF_DIR, f"staff_{sid}.json")


STORES = {
    "store_juja_main": dict(code="juj", staff=json.load(open(staff_path("store_juja_main")))),
    "store_nairobi_cbd": dict(code="nai", staff=json.load(open(staff_path("store_nairobi_cbd")))),
    "store_nakuru": dict(code="nak", staff=json.load(open(staff_path("store_nakuru")))),
    "store_ruiru": dict(code="rui", staff=json.load(open(staff_path("store_ruiru")))),
    "store_thika": dict(code="thi", staff=json.load(open(staff_path("store_thika")))),
}


def build_conversations(sid, d):
    code = d["code"]
    staff = d["staff"]
    owner = next((u for u in staff if u["role"] == "STORE_OWNER"), None)
    mgrs = [u for u in staff if u["role"] == "BRANCH_MANAGER"]
    cashiers = [u for u in staff if u["role"] == "CASHIER"]
    acct = next((u for u in staff if u["role"] == "ACCOUNTANT"), None)
    if not mgrs or not cashiers:
        return []
    mgr = mgrs[0]
    everyone = [u["id"] for u in staff if u["role"] != "SUPER_ADMIN"]
    now = datetime.now(timezone.utc)
    convs = []

    def mk(idx, ctype, title, parts, msgs_meta, base_dt):
        """msgs_meta: list of (sender_name, text, minutes_offset)"""
        msgs, first, last = [], None, None
        for mi, (sname, text, mins) in enumerate(msgs_meta):
            s = next((u for u in staff if u["name"] == sname), None)
            if s is None:
                s = mgr if mi % 2 == 0 else cashiers[0]
            at = base_dt + timedelta(minutes=mins)
            mid = f"seedmsg_{code}_{idx:03d}_{mi:03d}"
            msgs.append({"id": mid, "senderId": s["id"], "content": text,
                         "messageType": "TEXT",
                         "sentAt": at.strftime("%Y-%m-%dT%H:%M:%S.000Z")})
            if first is None:
                first = at
            last = at
        convs.append({
            "id": f"seedv_{code}_{idx:03d}", "storeId": sid, "type": ctype, "title": title,
            "participantIds": json.dumps(parts),
            "createdAt": first.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "updatedAt": last.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "lastMessageAt": last.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "lastMessagePreview": msgs_meta[-1][1][:120],
            "messages": msgs,
        })

    def eat_utc(day_back, hour, minute):
        dt = now - timedelta(days=day_back)
        dt = dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
        return dt - timedelta(hours=3)

    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    # ── 16 daily-sales updates (morning brief + evening close pairs) ──
    for k in range(8):
        db = 1 + k  # days back: 1..8
        c1, c2 = cashiers[k % len(cashiers)], cashiers[(k + 1) % len(cashiers)]
        day = day_names[eat_utc(db, 8, 0).weekday()]
        sales = random.randint(38, 96)
        revenue = random.randint(68000, 189000)
        mpesa_pct = random.randint(52, 78)
        cement = random.randint(24, 85)
        grinders = random.randint(2, 9)
        paint = random.randint(1, 6)
        debt_cust = random.randint(1, 4)
        m = [
            (mgr["name"], f"Good morning team. Quick briefing before we open: yesterday we served {sales} customers, {random.randint(3, 9)} quotes still pending. Let's have a strong day — floor stock check first, then tills.", 0),
            (c1["name"], "Sawa. I've checked aisle one — cement pallets look low, only about 40 bags on display.", 7),
            (c2["name"], "Paint section is fine. I'll face up the shelves before 8, then open till 2.", 12),
            (mgr["name"], f"Noted. Focus items today: Savannah Cement moving fast, push the 10-bag discount. Also remind customers about free delivery within town for orders above KES 30,000.", 18),
            (c1["name"], "Understood. Hardware counter ready, float counted.", 25),
        ]
        mk(k * 2, "INTERNAL", f"Morning briefing — {day} {eat_utc(db, 8, 0).strftime('%d %b')}", everyone,
           m, eat_utc(db, 7, 45 + (k % 3) * 5))
        m = [
            (mgr["name"], f"Closing summary {day}: total sales KES {revenue:,}. {mpesa_pct}% MPESA, rest cash. Well done team.", 0),
            (c2["name"], f"Till 2 reconciled, variance zero. Handing over keys.", 9),
            (c1["name"], f"Till 1 done too. {debt_cust} customers took goods on credit today, all within limits and forms signed.", 15),
            (mgr["name"], f"Great. Top movers: {cement} bags cement, {grinders} angle grinders, {paint} paint buckets. Tomorrow we push wheelbarrows — supplier confirmed delivery by 9am.", 22),
            (owner["name"] if owner else mgr["name"], f"Good numbers. Keep the credit register clean — accountant will review tomorrow morning.", 35),
        ] + ([(acct["name"], "Debt ledger reviewed, everything checks out.", 44)] if acct else [])
        mk(k * 2 + 1, "INTERNAL", f"Daily sales close — {day} {eat_utc(db, 18, 0).strftime('%d %b')}", everyone,
           m, eat_utc(db, 18, 5 + (k % 4) * 5))

    # ── 5 inventory / restocking threads ──
    inv_topics = [
        ("Cement & ballast delivery — supplier coordination", [
            (mgr["name"], "Warehouse: tomorrow's delivery is confirmed with the supplier — 600 bags Savannah + 200 bags ballast. Ebu make space in bay 2 today.", 0),
            (cashiers[0]["name"], "Space almost ready. Old pallets moved, floor swept. Do we have the delivery note template printed?", 14),
            (mgr["name"], "Yes, printed at the office. Count every bag at the gate before signing — last time we were 12 bags short.", 20),
            (cashiers[1]["name"] if len(cashiers) > 1 else cashiers[0]["name"], "Understood. I'll be at the gate from 7:30.", 27),
            (owner["name"] if owner else mgr["name"], "Also verify the batch numbers, cement older than 3 months goes to the front for quick sale.", 40),
        ]),
        ("Stock count — tools aisle (grinders, drills, saws)", [
            (mgr["name"], "Team, monthly stock count of the power tools aisle starts Saturday 7am. First two cashiers take grinders and drills, the rest take saws and accessories.", 0),
            (cashiers[2]["name"] if len(cashiers) > 2 else cashiers[0]["name"], "Sawa. Do we count display units too or shelf stock only?", 11),
            (mgr["name"], "Both. Display units are sellable stock. Mark any damaged or missing with a red sticker and report to me.", 17),
            (cashiers[0]["name"], "Noted. One demo unit has a faulty switch — should we tag it for repair?", 26),
            (mgr["name"], "Yes, tag it. I'll book it with the service centre on Monday.", 33),
        ]),
        ("Paint reorder — Dulux & Crown running low", [
            (cashiers[1]["name"] if len(cashiers) > 1 else cashiers[0]["name"], f"Heads up: Dulux Weathershield 20L is down to {random.randint(6, 14)} buckets. Customers keep asking for white and cream.", 0),
            (mgr["name"], "Thanks for flagging. I'll raise a PO to the distributor today — 80 buckets mixed colours plus 40 Crown Silk Vinyl.", 8),
            (cashiers[0]["name"], "Should we tell customers it will arrive in 2 days?", 15),
            (mgr["name"], "Yes, promise Thursday morning. Take deposits for the big orders so we hold their stock.", 21),
            (owner["name"] if owner else mgr["name"], "Agreed. Also add a small counter-top display for the new Crown colours once it lands.", 30),
        ]),
        ("Weekend restock & planogram", [
            (mgr["name"], "Weekend push: Nails, hoop iron and wheelbarrows must be front-facing by Friday evening. Those three bring the most walk-in traffic.", 0),
            (cashiers[3]["name"] if len(cashiers) > 3 else cashiers[0]["name"], "On it. Wheelbarrow corner is also where the new cement display will go — should I hold off?", 12),
            (mgr["name"], "Yes, hold off until the display stand arrives. Restock nails first, we sold 300 packets last weekend.", 19),
            (cashiers[0]["name"], "Roger that. I'll also bundle tape measures with the hammers — they pair well.", 27),
        ]),
        ("Supplier follow-up — delayed delivery", [
            (mgr["name"], "The scaffolding supplier hasn't confirmed dispatch yet. Customer is waiting for the 4m tower he paid a deposit on.", 0),
            (cashiers[2]["name"] if len(cashiers) > 2 else cashiers[0]["name"], "He called again this morning. I told him we're following up — can we give a firm date?", 9),
            (mgr["name"], "I've pushed the supplier, truck leaves their yard this afternoon. Tell the customer delivery is tomorrow before noon, we absorb the transport cost this time.", 16),
            (cashiers[2]["name"] if len(cashiers) > 2 else cashiers[0]["name"], "Pole sana for him. I'll call him now and confirm in writing on WhatsApp.", 24),
            (mgr["name"], "Thanks. Note the delay on the PO so we track supplier performance this quarter.", 31),
        ]),
    ]
    for i, (title, msgs) in enumerate(inv_topics):
        mk(16 + i, "INTERNAL", title, everyone, msgs, eat_utc(2 + i * 2, 9 + i, 10))

    # ── 4 customer service threads (CUSTOMER_SUPPORT type) ──
    cs_topics = [
        ("Customer complaint — late delivery (Kariuki Mwangi)", [
            (cashiers[0]["name"], "Customer Kariuki Mwangi is here — his ballast delivery promised yesterday at 2pm arrived at 6pm. He is not happy.", 0),
            (mgr["name"], "Pole for that. Apologise on our behalf, and offer free offloading plus KES 500 off his next purchase.", 6),
            (cashiers[0]["name"], "He also wants to know if we can deliver cement to Kigongo site on Friday instead.", 13),
            (mgr["name"], "Yes — book it for Friday 10am, 150 bags. Confirm his deposit covers transport. I'll update the delivery board.", 19),
            (cashiers[0]["name"], "Done. He is smiling now, said asante. Logged the complaint and resolution in the book.", 28),
        ]),
        ("Warranty claim — angle grinder motor burnt", [
            (cashiers[1]["name"] if len(cashiers) > 1 else cashiers[0]["name"], "A customer brought back the DeWalt angle grinder bought 3 weeks ago — motor burnt while cutting steel. He has the receipt.", 0),
            (mgr["name"], "Check the serial against our sales record first, then process the warranty claim form. DeWalt covers motor faults.", 7),
            (cashiers[1]["name"] if len(cashiers) > 1 else cashiers[0]["name"], "Serial matches our records, bought on the 22nd. Form filled, customer signed.", 16),
            (mgr["name"], "Good. Give him a loaner grinder for the week — we have the display unit. Service centre pickup is Tuesday.", 23),
            (owner["name"] if owner else mgr["name"], "Please also log it so we can track warranty claims per brand this quarter.", 30),
        ]),
        ("Contractor bulk order — quote for 3-storey project", [
            (mgr["name"], "Eng. Otieno wants a quote: 2,000 bags cement, 3 lorries ballast, 400 lengths hoop iron, plus reinforcement. Anyone free to prepare it?", 0),
            (cashiers[2]["name"] if len(cashiers) > 2 else cashiers[0]["name"], "I can draft it today. Do we apply the contractor discount tier — 8% on bulk?", 12),
            (mgr["name"], "Yes, 8% on materials, transport at cost plus 10%. Payment 50% upfront, balance in 30 days — he is a repeat customer, debt limit can hold.", 18),
            (acct["name"] if acct else mgr["name"], "I'll verify his debt balance before we commit — will confirm in an hour.", 26),
            (cashiers[2]["name"] if len(cashiers) > 2 else cashiers[0]["name"], "Quote drafted and sent to his email. Total KES 3,240,000 after discount.", 41),
            (mgr["name"], "Excellent work. Follow up Thursday morning if he hasn't confirmed.", 47),
        ]),
        ("Return handling — wrong paint colour", [
            (cashiers[3]["name"] if len(cashiers) > 3 else cashiers[0]["name"], "Customer wants to return 3 buckets of Crown Matte — she was given grey but wanted silver. Unopened, receipt available.", 0),
            (mgr["name"], "That's an exchange, not a return — take back the grey, issue silver. No restocking fee since it was our picking error.", 8),
            (cashiers[3]["name"] if len(cashiers) > 3 else cashiers[0]["name"], "Exchanged and shelves updated. Also apologised to her.", 17),
            (mgr["name"], "Good. Double-check picking slips with colour codes from now on — third mix-up this month.", 23),
        ]),
    ]
    for i, (title, msgs) in enumerate(cs_topics):
        mk(24 + i, "CUSTOMER_SUPPORT", title, everyone, msgs, eat_utc(3 + i * 2, 11 + i, 20))

    # ── 3 team meetings (sales strategy & promotions) ──
    tm = [
        ("Weekly team meeting — sales strategy & targets", [
            (mgr["name"], "Weekly meeting agenda: 1) this week's target, 2) new promo, 3) staffing for the month-end rush, 4) AOB. Let's start.", 0),
            (mgr["name"], f"Target this week: KES {random.randint(900000, 1400000):,} across the store. Hardware counter carries 45%, building materials 35%, paint and finishes 20%.", 3),
            (cashiers[0]["name"], "Cement competitors near the highway are doing KES 740 per bag. Should we match?", 15),
            (mgr["name"], "We hold at 760 but bundle free delivery within 5km for 20+ bags. Value beats price war.", 22),
            (owner["name"] if owner else mgr["name"], "Agreed. Also, the new promo: 'Mbau Package' — cement, ballast, sand and hoop iron bundled for a 1-bedroom foundation. First cashier on the list will design the flyer.", 30),
            (cashiers[1]["name"] if len(cashiers) > 1 else cashiers[0]["name"], "I'll have flyer drafts by Wednesday for review.", 38),
            (mgr["name"], "Perfect. Month-end staffing: all hands on deck Friday and Saturday, no leave requests those days. AOB? None? Meeting closed — asante team.", 47),
        ]),
        ("Month-end promotion planning — tools & paint", [
            (mgr["name"], "Month-end promo planning: 10% off all Ingco power tools, free brush set with every 20L paint purchase. Duration: last 5 days of the month.", 0),
            (cashiers[2]["name"] if len(cashiers) > 2 else cashiers[0]["name"], "Can we banner it on WhatsApp status and the noticeboard? Last promo brought many walk-ins that way.", 10),
            (mgr["name"], "Yes — draft the banner today. Also SMS blast to our top 200 loyalty customers on Thursday.", 17),
            (acct["name"] if acct else mgr["name"], "Promo margin check done — at 10% off we still keep 22% gross margin on Ingco. Approved from finance side.", 25),
            (owner["name"] if owner else mgr["name"], "Great teamwork. Let's also track redemptions per till so we learn what converts.", 33),
        ]),
        ("Huddle — Saturday peak readiness", [
            (mgr["name"], "Quick huddle: Saturday is a peak day — two lorries delivering construction materials and a wedding-tent order pickup. Tills 1 and 2 open by 7:45 sharp.", 0),
            (cashiers[0]["name"], "Float confirmed with the accountant. I'll pre-open the yard gate at 7:30.", 8),
            (cashiers[1]["name"] if len(cashiers) > 1 else cashiers[0]["name"], "I'll handle the tent order paperwork in the morning, then join till 2 after 10am.", 15),
            (mgr["name"], "Water point for customers stays stocked — small thing but customers remember. Any questions? None — great, let's have a big weekend.", 22),
        ]),
    ]
    for i, (title, msgs) in enumerate(tm):
        mk(28 + i, "INTERNAL", title, everyone, msgs, eat_utc(4 + i * 3, 17, 0))

    return convs


total_conv, total_msg = 0, 0
for sid, d in STORES.items():
    convs = build_conversations(sid, d)
    total_conv += len(convs)
    total_msg += sum(len(c["messages"]) for c in convs)
    for i in range(0, len(convs), 8):
        chunk = convs[i:i + 8]
        res = post_bulk("chats", chunk)
        dd = res.get("data", {})
        print(f"{sid} chunk {i//8}: submitted={dd.get('submitted')} inserted={dd.get('inserted')} "
              f"skipped={dd.get('skipped')} ok={res.get('success')}")
        if not res.get("success"):
            print("  ERROR:", str(res)[:500])

print(f"\nTOTAL: {total_conv} conversations, {total_msg} messages")
