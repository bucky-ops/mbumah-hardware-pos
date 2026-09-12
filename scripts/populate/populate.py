#!/usr/bin/env python3
"""
Mbumah Hardware POS — database population via production APIs.

Phases: users, categories, products, customers, suppliers, pos, sales,
        expenses, rentals, employees, verify
Targets per store: 10 users, 10 categories, 40 products, 30 customers,
60 sales, 3 suppliers, 10 POs, 20 expenses, 20 debt ledgers, 10 rentals,
5 employees.

Usage: python3 populate.py --phase <phase> [--store <storeId>] [--yes]
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from mbumah_client import Client, BASE
import catalog as C

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(HERE, "state.json")
NOW = datetime.now(timezone.utc)
LOG = os.path.join(HERE, "populate.log")

TARGETS = {
    "users": 10, "categories": 10, "products": 40, "customers": 30,
    "sales": 60, "suppliers": 3, "pos": 10, "expenses": 20,
    "debt": 20, "rentals": 10, "employees": 5,
}

def log(msg):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")

def load_state():
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH) as f:
            return json.load(f)
    return {}

def save_state(state):
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=1)

def r2(x):
    return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

def money(x):
    return float(Decimal(str(x)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


class Populator:
    def __init__(self, only_store=None):
        self.cl = Client()
        self.only = only_store
        self.state = load_state()
        s, p = self.cl.get("/api/branches")
        self.stores = [st for st in p["data"] if not self.only or st["id"] == self.only]
        self.org = "org_mbumah"
        self.state.setdefault("created", {})

    def st_ok(self, r, label, treat_409_ok=True):
        s, p = r
        if s in (200, 201):
            return (p.get("data") or {})
        if s == 409 and treat_409_ok:
            log(f"  SKIP {label}: already exists (409)")
            return {}
        log(f"  FAIL {label}: {s} {json.dumps(p, default=str)[:220]}")
        return None

    # ---------- shared fetchers ----------
    def get_users(self):
        s, p = self.cl.get("/api/users")
        return p["data"] if s == 200 else []

    def get_per_store(self, path, key="storeId"):
        out = {}
        for st in self.stores:
            s, p = self.cl.get(f"{path}?{key}={st['id']}&limit=500")
            if s != 200:
                log(f"GET {path} store={st['id']} -> {s} {str(p)[:150]}")
                out[st["id"]] = []
                continue
            d = p.get("data")
            if isinstance(d, dict):
                for v in d.values():
                    if isinstance(v, list):
                        d = v
                        break
            out[st["id"]] = d if isinstance(d, list) else []
        return out

    # ---------- PHASE: users ----------
    PLAN_USERS = {
        "store_juja_main":   ["BRANCH_MANAGER", "CASHIER"],
        "store_nairobi_cbd": ["STORE_OWNER", "BRANCH_MANAGER", "CASHIER", "CASHIER", "CASHIER", "CASHIER", "CASHIER", "BRANCH_MANAGER"],
        "store_nakuru":      ["STORE_OWNER", "BRANCH_MANAGER", "CASHIER", "CASHIER", "CASHIER", "CASHIER", "CASHIER"],
        "store_ruiru":       ["STORE_OWNER", "BRANCH_MANAGER", "CASHIER", "CASHIER", "CASHIER", "CASHIER", "CASHIER", "BRANCH_MANAGER"],
        "store_thika":       ["STORE_OWNER", "BRANCH_MANAGER", "CASHIER", "CASHIER", "CASHIER", "CASHIER", "CASHIER", "BRANCH_MANAGER"],
    }

    def phase_users(self):
        users = self.get_users()
        by_store = {}
        emails = {u["email"].lower() for u in users}
        for u in users:
            by_store.setdefault(u.get("storeId"), []).append(u)
        created = self.state["created"].setdefault("users", [])
        for st in self.stores:
            sid, code, city = st["id"], st["id"].replace("store_", "")[:3], st.get("location", "")
            existing = len(by_store.get(sid, []))
            plan = self.PLAN_USERS.get(sid, [])[: max(0, TARGETS["users"] - existing)]
            if not plan:
                log(f"users {sid}: already at target ({existing})")
                continue
            rng = C.rng_for(f"users-{sid}-{len(plan)}")
            log(f"users {sid}: +{len(plan)}")
            for i, role in enumerate(plan):
                for attempt in range(4):
                    fn = rng.choice(C.FIRST_M if i % 2 == 0 else C.FIRST_F)
                    ln = rng.choice(C.LAST)
                    email = f"{fn}.{ln}.{code}".lower().replace("'", "") + "@mbumahhardware.co.ke"
                    if email not in emails:
                        break
                    email = f"{fn}.{ln}{rng.randint(10,99)}.{code}".lower() + "@mbumahhardware.co.ke"
                emails.add(email)
                phone = rng.choice(C.PHONE_PREFIX) + f"{rng.randint(0, 9999999):07d}"
                name = f"{fn} {ln}"
                body = {"name": name, "email": email, "role": role,
                        "password": "password123", "phone": phone,
                        "storeId": sid, "organizationId": self.org}
                d = self.st_ok(self.cl.post("/api/users", body), f"user {name} {role}")
                if d:
                    created.append({"id": d.get("id"), "storeId": sid, "role": role,
                                    "email": email, "name": name, "inventory": False})
                    log(f"  + user {name} {role} ({email})")
                time.sleep(0.12)
        save_state(self.state)

    # ---------- PHASE: categories ----------
    def phase_categories(self):
        existing = self.get_per_store("/api/categories")
        created = self.state["created"].setdefault("categories", [])
        for st in self.stores:
            sid = st["id"]
            names = {c["name"].strip().lower() for c in existing[sid]}
            missing = [(n, ic, col, d) for n, ic, col, d in C.CATEGORIES if n.lower() not in names]
            if not missing:
                log(f"categories {sid}: complete ({len(existing[sid])})")
                continue
            log(f"categories {sid}: +{len(missing)}")
            for idx, (n, ic, col, d) in enumerate(missing, 1):
                body = {"storeId": sid, "name": n, "description": d,
                        "icon": ic, "color": col, "sortOrder": len(existing[sid]) + idx}
                r = self.st_ok(self.cl.post("/api/categories", body), f"category {n}")
                if r:
                    created.append({"id": r.get("id"), "storeId": sid, "name": n})
                    log(f"  + category {n}")
                time.sleep(0.1)
        save_state(self.state)

    # ---------- PHASE: products ----------
    QTY_BY_UNIT = {"BAG": (6, 45), "KILOGRAM": (2, 25), "METER": (2, 14),
                   "LITER": (2, 12), "BOX": (2, 9), "SET": (1, 4), "PIECE": (1, 8)}
    STOCK_BY_CAT = {
        "Power Tools": (8, 22), "Hand Tools": (14, 45), "Building Materials": (60, 160),
        "Electrical Supplies": (20, 70), "Plumbing Supplies": (18, 60),
        "Paint & Finishes": (15, 55), "Hardware & Fasteners": (40, 140),
        "Garden & Outdoor": (8, 26), "Safety & Workwear": (18, 60), "Home Appliances": (5, 16),
    }
    RENTAL_POOL = [t for t in C.PRODUCTS if t[5]]

    def phase_products(self):
        prods = self.get_per_store("/api/products")
        cats = self.get_per_store("/api/categories")
        all_skus = {p_["sku"] for rows in prods.values() for p_ in rows}
        all_barcodes = {p_["barcode"] for rows in prods.values() for p_ in rows if p_.get("barcode")}
        created = self.state["created"].setdefault("products", [])
        for si, st in enumerate(self.stores):
            sid, code, city = st["id"], st["id"].replace("store_", "")[:3].upper(), C.STORES[si % len(C.STORES)]["city"]
            have = prods[sid]
            existing_count = len(have)
            names_in_store = {p_["name"].strip().lower() for p_ in have}
            rental_count = sum(1 for p_ in have if p_.get("isRental"))
            cat_id = {c["name"]: c["id"] for c in cats[sid]}
            gap = TARGETS["products"] - existing_count
            if gap <= 0:
                log(f"products {sid}: already at target ({existing_count})")
                continue
            rng = C.rng_for(f"prod-{sid}")
            # choose templates: rental first (need >=3 rental-capable), then rotation
            picks = []
            need_rental = max(0, 3 - rental_count)
            rental_pool = list(self.RENTAL_POOL)
            rng.shuffle(rental_pool)
            for t in rental_pool[:need_rental]:
                picks.append(t)
            general = [t for t in C.PRODUCTS if not t[5]]
            start = (si * 5) % len(general)
            i = start
            while len(picks) < gap:
                t = general[i % len(general)]
                if t[0].lower() not in names_in_store and t not in picks:
                    picks.append(t)
                i += 1
                if i - start > len(general) * 2:  # safety
                    break
            picks = picks[:gap]
            log(f"products {sid}: +{len(picks)} (rental-capable among them: {sum(1 for t in picks if t[5])})")
            for k, (name, cat, unit, price, spec, is_rental) in enumerate(picks):
                seq = rng.randint(1000, 9899)
                while f"MBM-{code}-{seq}" in all_skus:
                    seq = rng.randint(1000, 9899)
                sku = f"MBM-{code}-{seq}"
                all_skus.add(sku)
                bc = f"61{rng.randint(10**8, 10**9 - 1)}"
                while bc in all_barcodes:
                    bc = f"61{rng.randint(10**8, 10**9 - 1)}"
                all_barcodes.add(bc)
                jitter = 0.92 + (k % 5) * 0.04  # 0.92..1.08 deterministic
                price2 = money(price * jitter)
                if price2 >= 1000:
                    price2 = money(round(price2 / 5) * 5)
                cost = r2(price2 * (0.60 + 0.05 * ((k + si) % 5)))
                if is_rental:
                    stock, reorder = rng.randint(4, 7), 2
                else:
                    lo, hi = self.STOCK_BY_CAT.get(cat, (10, 40))
                    stock, reorder = rng.randint(lo, hi), rng.randint(8, 25)
                desc = f"{spec}. {city} branch stock item. VAT 16% included in marked price."
                body = {"storeId": sid, "categoryId": cat_id.get(cat), "sku": sku,
                        "barcode": bc, "name": name, "description": desc, "unitType": unit,
                        "quantityInStock": stock, "reorderLevel": reorder,
                        "pricePerUnit": price2, "costPrice": cost, "taxRate": 16,
                        "isRental": is_rental}
                d = self.st_ok(self.cl.post("/api/products", body), f"product {sku} {name}")
                if d:
                    created.append({"id": d.get("id"), "storeId": sid, "name": name,
                                    "sku": sku, "price": price2, "cost": cost,
                                    "unit": unit, "isRental": is_rental,
                                    "stock": stock, "categoryId": cat_id.get(cat)})
                    log(f"  + {sku} {name} @ {price2:.0f} (stock {stock})")
                time.sleep(0.1)
        save_state(self.state)

    # ---------- PHASE: customers ----------
    def phase_customers(self):
        custs = self.get_per_store("/api/customers")
        created = self.state["created"].setdefault("customers", [])
        for si, st in enumerate(self.stores):
            sid, city = st["id"], C.STORES[si % len(C.STORES)]["city"]
            have = custs[sid]
            gap = TARGETS["customers"] - len(have)
            if gap <= 0:
                log(f"customers {sid}: already at target ({len(have)})")
                continue
            rng = C.rng_for(f"cust-{sid}")
            estates = C.ESTATES.get(city, ["Town Centre"])
            log(f"customers {sid}: +{gap}")
            for i in range(gap):
                fn = rng.choice(C.FIRST_M if i % 2 else C.FIRST_F)
                ln = rng.choice(C.LAST)
                name = f"{fn} {ln}"
                phone = rng.choice(C.PHONE_PREFIX) + f"{rng.randint(0, 9999999):07d}"
                email = f"{fn.lower()}.{ln.lower()}{rng.randint(2, 98)}@gmail.com" if rng.random() < 0.55 else None
                body = {"storeId": sid, "name": name, "phone": phone,
                        "email": email or "",
                        "address": f"{rng.choice(estates)}, {city}",
                        "idNumber": str(rng.randint(21000000, 39999999)),
                        "debtLimit": rng.choice([20000, 30000, 50000, 65000, 80000])}
                d = self.st_ok(self.cl.post("/api/customers", body), f"customer {name}")
                if d:
                    created.append({"id": d.get("id"), "storeId": sid, "name": name,
                                    "phone": phone, "debtLimit": body["debtLimit"],
                                    "balance": 0})
                    log(f"  + {name} {phone} limit {body['debtLimit']}")
                time.sleep(0.1)
        save_state(self.state)

    # ---------- PHASE: suppliers ----------
    def phase_suppliers(self):
        sups = self.get_per_store("/api/suppliers")
        created = self.state["created"].setdefault("suppliers", [])
        for si, st in enumerate(self.stores):
            sid = st["id"]
            have = sups[sid]
            names = {s_["name"].strip().lower() for s_ in have}
            gap = max(0, TARGETS["suppliers"] - len(have))
            if gap <= 0:
                log(f"suppliers {sid}: already at target ({len(have)})")
                continue
            log(f"suppliers {sid}: +{gap}")
            k = 0
            for j in range(len(C.SUPPLIERS)):
                if k >= gap:
                    break
                idx = (si + j) % len(C.SUPPLIERS)
                name, person, phone, city, supply, terms, rating = C.SUPPLIERS[idx]
                if name.lower() in names:
                    continue
                body = {"storeId": sid, "name": name,
                        "email": f"sales@{name.split()[0].lower()}supplies.co.ke",
                        "phone": phone, "address": f"{city} Industrial Area", "city": city,
                        "contactPerson": person, "taxPin": f"P0{rng_supp(idx)}{chr(65 + idx)}",
                        "paymentTerms": terms, "rating": rating,
                        "notes": f"Supplies: {supply}"}
                d = self.st_ok(self.cl.post("/api/suppliers", body), f"supplier {name}")
                if d:
                    created.append({"id": d.get("id"), "storeId": sid, "name": name, "supply": supply})
                    log(f"  + {name} ({terms})")
                    k += 1
                time.sleep(0.1)
        save_state(self.state)

    # ---------- PHASE: purchase orders ----------
    PO_PLAN = ["DRAFT", "DRAFT", "PENDING_APPROVAL", "PENDING_APPROVAL", "APPROVED",
               "APPROVED", "SENT", "SENT", "CONFIRMED", "CONFIRMED"]

    def _po_transitions(self, po_id, target):
        chain = {
            "DRAFT": [],
            "PENDING_APPROVAL": ["PENDING_APPROVAL"],
            "APPROVED": ["PENDING_APPROVAL", "APPROVED"],
            "SENT": ["PENDING_APPROVAL", "APPROVED", "SENT"],
            "CONFIRMED": ["PENDING_APPROVAL", "APPROVED", "SENT", "CONFIRMED"],
        }[target]
        for nxt in chain:
            r = self.st_ok(self.cl.put(f"/api/purchase-orders/{po_id}", {"status": nxt}),
                           f"PO {po_id[:8]} -> {nxt}")
            if not r and nxt != "DRAFT":
                return False
            time.sleep(0.08)
        return True

    def phase_pos(self):
        prods = self.get_per_store("/api/products")
        sups = self.get_per_store("/api/suppliers")
        users = self.get_users()
        mgrs = {}
        for u in users:
            if u.get("role") in ("BRANCH_MANAGER", "STORE_OWNER", "SUPER_ADMIN"):
                mgrs.setdefault(u.get("storeId"), []).append(u["id"])
        created = self.state["created"].setdefault("pos", [])
        for si, st in enumerate(self.stores):
            sid = st["id"]
            have = sups[sid]
            pp = [p_ for p_ in prods[sid] if not p_.get("isRental")] or prods[sid]
            rng = C.rng_for(f"po-{sid}")
            # count existing POs
            s, p = self.cl.get(f"/api/purchase-orders?storeId={sid}&limit=500")
            d = p.get("data") if s == 200 else None
            if isinstance(d, dict):
                for v in d.values():
                    if isinstance(v, list):
                        d = v
                        break
            have_pos = d if isinstance(d, list) else []
            gap = TARGETS["pos"] - len(have_pos)
            if gap <= 0 or not have:
                log(f"pos {sid}: gap={gap} suppliers={len(have)} — skip")
                continue
            plan = self.PO_PLAN[:gap] if sid == "store_juja_main" else self.PO_PLAN[:gap]
            log(f"pos {sid}: +{len(plan)}")
            for k, target in enumerate(plan):
                n_items = rng.randint(2, 5)
                chosen = rng.sample(pp, min(n_items, len(pp)))
                items = []
                for pr in chosen:
                    qty = rng.choice([10, 15, 20, 25, 30, 40, 50, 60, 80, 100])
                    cost = r2(float(pr.get("costPrice") or 0) * (0.95 + rng.random() * 0.1)) or r2(float(pr.get("pricePerUnit") or 100) * 0.7)
                    items.append({"productId": pr["id"], "quantity": qty, "unitCost": cost})
                sup = rng.choice(have)
                expected = (NOW + timedelta(days=rng.randint(7, 21))).strftime("%Y-%m-%dT%H:%M:%SZ")
                body = {"storeId": sid, "supplierId": sup["id"], "items": items,
                        "expectedDate": expected,
                        "notes": f"Replenishment order {k + 1} — {sup.get('name', 'supplier')}"}
                d = self.st_ok(self.cl.post("/api/purchase-orders", body), f"PO #{k + 1} {sid}")
                if d:
                    pid = d.get("id")
                    ok = self._po_transitions(pid, target) if target != "DRAFT" else True
                    created.append({"id": pid, "storeId": sid, "status": target,
                                    "poNumber": d.get("poNumber"), "advanced": ok})
                    log(f"  + {d.get('poNumber')} {target}{'✓' if ok else ' (status chain partial)'}")
                time.sleep(0.12)
        save_state(self.state)

    # ---------- PHASE: sales ----------
    def phase_sales(self):
        prods = self.get_per_store("/api/products")
        custs = self.get_per_store("/api/customers")
        users = self.get_users()
        created = self.state["created"].setdefault("sales", [])
        nonce = self.state.setdefault("sales_nonce", str(int(time.time()))[-6:])
        seq = 0
        for si, st in enumerate(self.stores):
            sid = st["id"]
            code = st["id"].replace("store_", "")[:3].upper()
            rng = C.rng_for(f"sales-{sid}")
            sellable = [p_ for p_ in prods[sid] if not p_.get("isRental") and float(p_.get("pricePerUnit") or 0) > 0]
            stock = {p_["id"]: int(float(p_.get("quantityInStock") or 0)) for p_ in sellable}
            cashiers = [u["id"] for u in users if u.get("storeId") == sid and u.get("role") in ("CASHIER", "BRANCH_MANAGER", "STORE_OWNER")]
            if not cashiers:
                log(f"sales {sid}: no cashier users — skip")
                continue
            # current debt per customer
            s, p = self.cl.get(f"/api/debt?storeId={sid}&limit=500")
            d = p.get("data") if s == 200 else None
            if isinstance(d, dict):
                for v in d.values():
                    if isinstance(v, list):
                        d = v
                        break
            debts = d if isinstance(d, list) else []
            debt_by_cust = {}
            for dl in debts:
                cid = dl.get("customerId")
                debt_by_cust[cid] = debt_by_cust.get(cid, 0) + float(dl.get("balance") or 0)
            customer_info = {}
            for cu in custs[sid]:
                lim = float(cu.get("debtLimit") or 50000)
                cur = float(cu.get("currentDebtBalance") or 0)
                customer_info[cu["id"]] = {"name": cu["name"], "phone": cu.get("phone"),
                                           "limit": lim, "used": max(cur, debt_by_cust.get(cu["id"], 0))}
            # how many do we need?
            s, p = self.cl.get(f"/api/transactions?storeId={sid}&limit=500")
            d = p.get("data") if s == 200 else None
            if isinstance(d, dict):
                for v in d.values():
                    if isinstance(v, list):
                        d = v
                        break
            have_sales = d if isinstance(d, list) else []
            gap_total = TARGETS["sales"] - len(have_sales)
            debt_gap = max(0, TARGETS["debt"] - len(debts))
            if gap_total <= 0:
                log(f"sales {sid}: already at target ({len(have_sales)})")
                continue
            debt_gap = min(debt_gap, gap_total)
            non_debt = gap_total - debt_gap
            cash_n = round(non_debt * 0.55)
            mpesa_n = round(non_debt * 0.30)
            split_n = non_debt - cash_n - mpesa_n
            methods = (["CASH"] * cash_n + ["MPESA"] * mpesa_n + ["SPLIT"] * split_n + ["DEBT"] * debt_gap)
            rng.shuffle(methods)
            log(f"sales {sid}: +{gap_total} (CASH {cash_n}, MPESA {mpesa_n}, SPLIT {split_n}, DEBT {debt_gap})")
            debt_ok = debt_gap
            for k, method in enumerate(methods):
                if method == "DEBT" and debt_ok <= 0:
                    method = "CASH"
                # build basket
                basket, attempts = None, 0
                cap = 15000 if method == "DEBT" else 130000
                while attempts < 6 and basket is None:
                    attempts += 1
                    n_items = rng.randint(1, 2) if method == "DEBT" else rng.randint(1, 4)
                    chosen = rng.sample(sellable, min(n_items, len(sellable)))
                    items, est = [], 0.0
                    ok = True
                    for pr in chosen:
                        unit = pr.get("unitType") or "PIECE"
                        lo, hi = self.QTY_BY_UNIT.get(unit, (1, 6))
                        qty = rng.randint(lo, hi)
                        price = float(pr.get("pricePerUnit"))
                        if price > 20000:
                            qty = min(qty, 2)
                        if stock.get(pr["id"], 0) < qty:
                            ok = False
                            break
                        disc = rng.choice([0, 0, 0, 0, 0, 5, 10])
                        line = r2(qty * price * (1 - disc / 100.0))
                        est += line
                        items.append({"productId": pr["id"], "productName": pr["name"],
                                      "sku": pr["sku"], "quantity": qty, "unitType": unit,
                                      "pricePerUnit": price, "costPrice": float(pr.get("costPrice") or 0),
                                      "discountPercent": disc, "taxRate": 16, "lineTotal": line})
                    if not ok or not items or est > cap or est < 200:
                        continue
                    basket = items
                if basket is None:
                    # last resort: single cheapest in-stock item
                    cand = sorted(sellable, key=lambda q: float(q.get("pricePerUnit") or 9e9))
                    pr = next((q for q in cand if stock.get(q["id"], 0) >= 1), None)
                    if not pr:
                        log(f"  sale {k + 1}: could not build basket — skip")
                        continue
                    price = float(pr.get("pricePerUnit"))
                    qty = 1 if method == "DEBT" else min(rng.randint(1, 5), stock.get(pr["id"], 1))
                    line = r2(qty * price)
                    basket = [{"productId": pr["id"], "productName": pr["name"],
                               "sku": pr["sku"], "quantity": qty,
                               "unitType": pr.get("unitType") or "PIECE",
                               "pricePerUnit": price, "costPrice": float(pr.get("costPrice") or 0),
                               "discountPercent": 0, "taxRate": 16, "lineTotal": line}]
                    est_total = line
                est_total = sum(i["lineTotal"] for i in basket)
                customer_id = None
                if method == "DEBT":
                    cand = [cid for cid, inf in customer_info.items()
                            if inf["limit"] - inf["used"] >= est_total + 500]
                    if not cand:
                        method = "CASH"
                    else:
                        cand.sort(key=lambda cid: customer_info[cid]["limit"] - customer_info[cid]["used"], reverse=True)
                        customer_id = cand[k % min(6, len(cand))]
                elif rng.random() < 0.6 and custs[sid]:
                    customer_id = custs[sid][rng.randrange(len(custs[sid]))]["id"]
                seq += 1
                key = f"POP26-{code}-{nonce}-{seq:04d}"
                details = {}
                if method == "CASH":
                    notes_den = [50, 100, 200, 500, 1000]
                    tender = next((n for n in notes_den if n >= est_total), None)
                    if tender is None:
                        tender = int((est_total // 1000 + 1) * 1000)
                    details = {"cashAmount": float(tender)}
                elif method == "MPESA":
                    phone = (customer_info.get(customer_id, {}).get("phone")
                             or f"07{rng.randint(10**8, 10**9 - 1)}"[0:10])
                    details = {"mpesaPhone": phone}
                elif method == "SPLIT":
                    cash_leg = r2(est_total * 0.6)
                    mpesa_leg = r2(est_total - cash_leg)
                    details = {"splits": [{"method": "CASH", "amount": cash_leg},
                                          {"method": "MPESA", "amount": mpesa_leg}]}
                body = {"storeId": sid,
                        "cashierId": cashiers[k % len(cashiers)],
                        "idempotencyKey": key, "items": basket,
                        "paymentMethod": method, "paymentDetails": details}
                if customer_id:
                    body["customerId"] = customer_id
                s, p = self.cl.post("/api/transactions", body)
                if s in (200, 201):
                    dd = p.get("data") or {}
                    receipt = dd.get("receiptNumber")
                    total = float(dd.get("totalAmount") or est_total)
                    created.append({"id": dd.get("id"), "storeId": sid, "receipt": receipt,
                                    "method": method, "total": total, "customerId": customer_id})
                    if method == "DEBT" and customer_id:
                        customer_info[customer_id]["used"] += total
                        debt_ok -= 1
                    for it in basket:
                        stock[it["productId"]] -= it["quantity"]
                    log(f"  + {receipt} {method:6} KES {total:>10,.2f} ({len(basket)} items)")
                else:
                    log(f"  FAIL sale {key}: {s} {json.dumps(p, default=str)[:200]}")
                time.sleep(0.25)
        save_state(self.state)

    # ---------- PHASE: expenses ----------
    EXP_PLAN = ([("RENT", 2)] + [("UTILITIES", 4)] + [("SALARIES", 3)] +
                [("TRANSPORT", 4)] + [("MAINTENANCE", 3)] + [("SUPPLIES", 3)] + [("OTHER", 1)])

    def phase_expenses(self):
        users = self.get_users()
        created = self.state["created"].setdefault("expenses", [])
        desc = {
            "RENT": ["Monthly shop rent — {m}", "Premises rent {m} (landlord J. Kamau)"],
            "UTILITIES": ["KPLC electricity bill — {m}", "Nairobi Water bill — {m}",
                          "Internet & fibre (Faiba 30Mbps) — {m}", "Garbage collection — {m}"],
            "SALARIES": ["Casual wages fortnight 1 — {m}", "Casual wages fortnight 2 — {m}",
                         "Staff lunch & welfare allowance — {m}"],
            "TRANSPORT": ["Delivery truck diesel — {m}", "Boda deliveries float — {m}",
                          "Matatu courier to site — {m}", "Vehicle service & tyres — {m}"],
            "MAINTENANCE": ["Forklift service & oil — {m}", "Shop repainting & signage touch-up — {m}",
                            "Security lights & gate repair — {m}"],
            "SUPPLIES": ["Packaging materials (bags, tape) — {m}", "Office stationery & receipt rolls — {m}",
                         "Cleaning supplies — {m}"],
            "OTHER": ["County single business permit — {m}"],
        }
        amount = {"RENT": (35000, 62000), "UTILITIES": (1800, 18500), "SALARIES": (9500, 42000),
                  "TRANSPORT": (1800, 7800), "MAINTENANCE": (2800, 14500),
                  "SUPPLIES": (1200, 5600), "OTHER": (2500, 9500)}
        months = ["June 2026", "July 2026", "August 2026", "September 2026"]
        created_n = 0
        for si, st in enumerate(self.stores):
            sid = st["id"]
            s, p = self.cl.get(f"/api/expenses?storeId={sid}&limit=500")
            d = p.get("data") if s == 200 else None
            if isinstance(d, dict):
                for v in d.values():
                    if isinstance(v, list):
                        d = v
                        break
            have = d if isinstance(d, list) else []
            gap = TARGETS["expenses"] - len(have)
            if gap <= 0:
                log(f"expenses {sid}: already at target ({len(have)})")
                continue
            rng = C.rng_for(f"exp-{sid}")
            mgr = next((u["id"] for u in users if u.get("storeId") == sid and u.get("role") in ("BRANCH_MANAGER", "STORE_OWNER")), None) or \
                  next((u["id"] for u in users if u.get("storeId") == sid), None)
            log(f"expenses {sid}: +{gap} (paidBy {mgr})")
            k = 0
            for cat, n in self.EXP_PLAN:
                while n > 0 and k < gap:
                    n -= 1
                    k += 1
                    lo, hi = amount[cat]
                    amt = money(rng.uniform(lo, hi))
                    tmpl = rng.choice(desc[cat])
                    method = rng.choice(["MPESA", "CASH", "BANK_TRANSFER"])
                    body = {"storeId": sid, "description": tmpl.format(m=months[k % 4]),
                            "amount": amt, "category": cat, "paidBy": mgr,
                            "paymentMethod": method,
                            "notes": f"Populated operational expense ({cat.lower()})"}
                    r = self.st_ok(self.cl.post("/api/expenses", body), f"expense {cat} {amt:.0f}")
                    if r:
                        created.append({"id": r.get("id"), "storeId": sid, "category": cat, "amount": amt})
                        created_n += 1
                        log(f"  + {cat:12} KES {amt:>10,.2f} {method}")
                    time.sleep(0.12)
        save_state(self.state)

    # ---------- PHASE: rentals ----------
    def phase_rentals(self):
        prods = self.get_per_store("/api/products")
        custs = self.get_per_store("/api/customers")
        created = self.state["created"].setdefault("rentals", [])
        for si, st in enumerate(self.stores):
            sid = st["id"]
            rental_products = [p_ for p_ in prods[sid] if p_.get("isRental")]
            have_customers = custs[sid]
            s, p = self.cl.get(f"/api/rentals?storeId={sid}&limit=500")
            d = p.get("data") if s == 200 else None
            if isinstance(d, dict):
                for v in d.values():
                    if isinstance(v, list):
                        d = v
                        break
            have = d if isinstance(d, list) else []
            gap = TARGETS["rentals"] - len(have)
            if gap <= 0 or not rental_products or not have_customers:
                log(f"rentals {sid}: gap={gap} products={len(rental_products)} — skip")
                continue
            rng = C.rng_for(f"rent-{sid}")
            log(f"rentals {sid}: +{gap} over {len(rental_products)} rental products")
            overdue_planned = min(2, gap)
            returned_planned = min(2, max(0, gap - overdue_planned))
            for k in range(gap):
                pr = rental_products[k % len(rental_products)]
                price = float(pr.get("pricePerUnit") or 10000)
                day = money(max(600, price * 0.025))
                cu = have_customers[rng.randrange(len(have_customers))]
                deposit = money(day * 5)
                if k < overdue_planned:
                    exp = (NOW - timedelta(days=rng.randint(2, 5))).strftime("%Y-%m-%dT%H:%M:%SZ")
                else:
                    exp = (NOW + timedelta(days=rng.randint(3, 21))).strftime("%Y-%m-%dT%H:%M:%SZ")
                body = {"storeId": sid, "productId": pr["id"], "customerId": cu["id"],
                        "expectedReturnDate": exp, "securityDeposit": deposit,
                        "ratePerDay": day, "ratePerWeek": money(day * 5.5),
                        "ratePerMonth": money(day * 20),
                        "notes": f"Site hire — {cu.get('name', 'customer')}"}
                r = self.st_ok(self.cl.post("/api/rentals", body), f"rental {pr['name']}")
                if r:
                    rid = r.get("id")
                    entry = {"id": rid, "storeId": sid, "product": pr["name"],
                             "ratePerDay": day, "customerId": cu["id"]}
                    if k >= overdue_planned and k < overdue_planned + returned_planned:
                        rr = self.cl.post(f"/api/rentals/{rid}/return",
                                          {"damageAssessment": "NONE", "damageCharge": 0})
                        entry["returned"] = rr[0] in (200, 201)
                        log(f"  + {pr['name']} → RETURNED (charge path {rr[0]})")
                    else:
                        log(f"  + {pr['name']} @ KES {day:,.0f}/day deposit {deposit:,.0f}")
                    created.append(entry)
                time.sleep(0.15)
        save_state(self.state)

    # ---------- PHASE: employees ----------
    def phase_employees(self):
        users = self.get_users()
        emps = self.get_per_store("/api/employees")
        # which users already have employee profiles?
        s, p = self.cl.get("/api/employees?limit=500")
        linked = set()
        if s == 200:
            d = p.get("data")
            if isinstance(d, list):
                linked = {e.get("userId") for e in d if e.get("userId")}
        created = self.state["created"].setdefault("employees", [])
        for si, st in enumerate(self.stores):
            sid, code = st["id"], st["id"].replace("store_", "")[:3].lower()
            have = emps[sid]
            gap = TARGETS["employees"] - len(have)
            if gap <= 0:
                log(f"employees {sid}: already at target ({len(have)})")
                continue
            rng = C.rng_for(f"emp-{sid}")
            su = [u for u in users if u.get("storeId") == sid and u["id"] not in linked]
            mgr = next((u for u in su if u.get("role") == "BRANCH_MANAGER"), None)
            cashiers = [u for u in su if u.get("role") == "CASHIER"]
            log(f"employees {sid}: +{gap} (unlinked users {len(su)})")
            templates = [
                ("Store Manager", "MANAGER", "PERMANENT", (65000, 95000), mgr),
                ("Senior Cashier", "CASHIER", "PERMANENT", (32000, 42000), cashiers[0] if cashiers else None),
                ("Inventory Clerk (Storekeeper)", "STAFF", "PERMANENT", (25000, 33000), cashiers[1] if len(cashiers) > 1 else None),
                ("Shop Floor Sales Assistant", "STAFF", "PERMANENT", (18000, 28000), cashiers[2] if len(cashiers) > 2 else None),
                ("Casual Site Cleaner", "STAFF", "CASUAL", (12000, 15000), None),
            ]
            for k in range(gap):
                t_idx = k if gap > 1 else 4  # single-slot refill = standalone casual
                title, role, etype, (lo, hi), user = templates[t_idx]
                if k >= 4:
                    user = None  # 5th slot is always a standalone casual worker
                elif user is None and k > 0:
                    user = next((u for u in cashiers if u["id"] not in linked), None)
                if user:
                    fn, ln = user["name"].split(" ", 1)[0], user["name"].split(" ", 1)[-1]
                    email = user["email"]
                else:
                    fn, ln = rng.choice(C.FIRST_M), rng.choice(C.LAST)
                    email = f"{fn.lower()}.{ln.lower()}.{code}{rng.randint(2, 40)}@mbumahhardware.co.ke"
                hire = NOW - timedelta(days=rng.randint(120, 2500))
                basic = money(rng.uniform(lo, hi))
                casual = etype == "CASUAL"
                body = {"storeId": sid, "firstName": fn, "lastName": ln,
                        "email": email, "phone": rng.choice(C.PHONE_PREFIX) + f"{rng.randint(0, 9999999):07d}",
                        "nationalId": str(rng.randint(21000000, 38999999)),
                        "kraPin": f"P0{rng.randint(10**7, 10**8 - 1)}{chr(65 + rng.randint(0, 25))}",
                        "nssfNumber": str(rng.randint(10**7, 10**8 - 1)),
                        "nhifNumber": str(rng.randint(10**7, 10**8 - 1)),
                        "jobTitle": title, "role": role, "employmentType": etype,
                        "hireDate": hire.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "basicSalary": 0 if casual else basic,
                        "hourlyRate": money(basic / 176) if casual else None,
                        "houseAllowance": 0 if casual else money(basic * 0.15),
                        "transportAllowance": money(basic * 0.06) if not casual else 0,
                        "medicalAllowance": money(basic * 0.05) if not casual else 0,
                        "bankName": rng.choice(["Equity Bank", "KCB Bank", "Co-operative Bank", "NCBA Bank"]),
                        "bankAccountName": f"{fn} {ln}".upper(),
                        "bankAccountNumber": str(rng.randint(10**9, 10**10 - 1)),
                        "emergencyContactName": f"{rng.choice(C.FIRST_F)} {ln}",
                        "emergencyContactPhone": rng.choice(C.PHONE_PREFIX) + f"{rng.randint(0, 9999999):07d}",
                        "emergencyContactRelation": rng.choice(["Spouse", "Sibling", "Parent"]),
                        "notes": f"Populated HR record — {title}"}
                if user and user["id"] not in linked:
                    body["userId"] = user["id"]
                    linked.add(user["id"])
                r = self.st_ok(self.cl.post("/api/employees", body), f"employee {fn} {ln} {title}")
                if r:
                    created.append({"id": r.get("id"), "storeId": sid, "title": title,
                                    "userId": body.get("userId")})
                    log(f"  + {fn} {ln} — {title} ({etype}, KES {basic:,.0f}/mo{' hourly' if casual else ''})")
                time.sleep(0.12)
        save_state(self.state)

    # ---------- PHASE: verify ----------
    def phase_verify(self):
        rows = {}
        eps = [("users", "/api/users"), ("categories", "/api/categories"),
               ("products", "/api/products"), ("customers", "/api/customers"),
               ("transactions", "/api/transactions"), ("suppliers", "/api/suppliers"),
               ("purchase-orders", "/api/purchase-orders"), ("expenses", "/api/expenses"),
               ("debt", "/api/debt"), ("rentals", "/api/rentals"), ("employees", "/api/employees")]
        for name, ep in eps:
            if ep == "/api/users":
                rows[name] = self.get_per_store_org(ep)
            elif ep == "/api/employees":
                rows[name] = self.get_per_store("/api/employees")
            else:
                rows[name] = self.get_per_store(ep)
        print(f"\n{'endpoint':14}" + "".join(f"{s['id'].replace('store_', '')[:11]:>12}" for s in self.stores) + f"{'TOTAL':>8}")
        ok = True
        for name, _ in eps:
            tot = 0
            line = f"{name:14}"
            for st in self.stores:
                n = len(rows[name].get(st["id"], []))
                tot += n
                line += f"{n:>12}"
            print(line + f"{tot:>8}")
        # debt per store
        print(f"{'debt ledgers':14}" + "".join(f"{len(rows['debt'].get(s['id'], [])):>12}" for s in self.stores))
        # health
        s, p = self.cl.get("/api/health")
        checks = (p.get("checks") or {})
        print("\nhealth:", p.get("status"))
        for k in ("database_stats", "financial_integrity"):
            print(f"  {k}: {checks.get(k, {}).get('detail')}")
        return ok

    def get_per_store_org(self, ep):
        out = {}
        rows = self.get_users() if ep == "/api/users" else None
        if rows is None:
            s, p = self.cl.get(f"{ep}?limit=1000")
            rows = (p.get("data") or []) if s == 200 else []
        for st in self.stores:
            out[st["id"]] = [r for r in rows if r.get("storeId") == st["id"]]
        return out

    def run(self, phase):
        fn = {
            "users": self.phase_users, "categories": self.phase_categories,
            "products": self.phase_products, "customers": self.phase_customers,
            "suppliers": self.phase_suppliers, "pos": self.phase_pos,
            "sales": self.phase_sales, "expenses": self.phase_expenses,
            "rentals": self.phase_rentals, "employees": self.phase_employees,
            "verify": self.phase_verify,
        }.get(phase)
        if not fn:
            print("unknown phase", phase)
            sys.exit(1)
        log(f"=== PHASE {phase} ===")
        t0 = time.time()
        fn()
        log(f"=== PHASE {phase} done in {time.time() - t0:.1f}s ===")


def rng_supp(i):
    import random
    return random.Random(i).randint(10**7, 10**8 - 1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", required=True,
                    choices=["users", "categories", "products", "customers", "suppliers",
                             "pos", "sales", "expenses", "rentals", "employees", "verify"])
    ap.add_argument("--store", default=None)
    args = ap.parse_args()
    Populator(args.store).run(args.phase)
