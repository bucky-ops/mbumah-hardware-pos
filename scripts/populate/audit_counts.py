#!/usr/bin/env python3
"""Accurate per-store data counts (full list lengths)."""
import json
from collections import Counter
from mbumah_client import Client, list_data

cl = Client(verbose=True)
s, p = cl.get("/api/branches")
stores = p["data"]

ENDPOINTS = [
    ("users", "/api/users"),
    ("categories", "/api/categories"),
    ("products", "/api/products"),
    ("customers", "/api/customers"),
    ("transactions", "/api/transactions"),
    ("suppliers", "/api/suppliers"),
    ("purchase-orders", "/api/purchase-orders"),
    ("expenses", "/api/expenses"),
    ("debt", "/api/debt"),
    ("rentals", "/api/rentals"),
    ("employees", "/api/employees"),
]

counts = {}
for name, ep in ENDPOINTS:
    try:
        rows = list_data(cl, ep)
        counts[name] = Counter((r.get("storeId") or "?") for r in rows)
    except Exception as e:
        counts[name] = f"ERR {e}"

print("\n=== per-store TRUE counts ===")
keys = [st["id"] for st in stores]
hdr = f"{'endpoint':16}" + "".join(f"{k.replace('store_','')[:10]:>12}" for k in keys) + f"{'TOTAL':>8}"
print(hdr)
for name, ep in ENDPOINTS:
    c = counts[name]
    if isinstance(c, str):
        print(f"{name:16}{c}")
        continue
    row = f"{name:16}"
    tot = 0
    for k in keys:
        n = c.get(k, 0)
        tot += n
        row += f"{n:>12}"
    other = sum(v for kk, v in c.items() if kk not in keys)
    row += f"{tot + other:>8}" + (f"  (+{other} other-store)" if other else "")
    print(row)

# sample: what do other stores have?
print("\n=== sample rows in non-juja stores ===")
for name, ep in ENDPOINTS:
    c = counts[name]
    if isinstance(c, str):
        continue
    for k in keys[1:]:
        if c.get(k, 0) > 1:
            rows = [r for r in list_data(cl, ep) if r.get("storeId") == k][:2]
            for r in rows:
                print(name, k, json.dumps({kk: r.get(kk) for kk in ("name", "sku", "email", "poNumber", "description", "category") if r.get(kk) is not None})[:160])
