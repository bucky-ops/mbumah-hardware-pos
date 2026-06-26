#!/usr/bin/env python3
"""
Fix: the first pass placed `?` AFTER `@db.Decimal(...)` which is invalid Prisma
syntax. The `?` is part of the TYPE and must come immediately after `Decimal`,
BEFORE any `@` attributes.

This script re-reads the (already-converted) schema and rewrites any
`Decimal @db.Decimal(p, s)?` to `Decimal? @db.Decimal(p, s)`.

Also handles `Decimal @db.Decimal(p, s)?    @map(...)` → `Decimal? @db.Decimal(p, s)    @map(...)`.
"""
import re
from pathlib import Path

SCHEMA = Path("/home/z/my-project/prisma/schema.prisma")
text = SCHEMA.read_text()

# Pattern: "Decimal @db.Decimal(N, M)?" possibly followed by more attributes
# We need to move the "?" to right after "Decimal".
# Match: Decimal<space>@db.Decimal(<p>, <s>)?<rest>
# Replace: Decimal?<space>@db.Decimal(<p>, <s>)<rest>
pattern = re.compile(
    r"Decimal(\s+)@db\.Decimal\((\d+),\s*(\d+)\)\?(.*)"
)

def replacer(m):
    space = m.group(1)
    p = m.group(2)
    s = m.group(3)
    rest = m.group(4)
    return f"Decimal?{space}@db.Decimal({p}, {s}){rest}"

new_text, count = pattern.subn(replacer, text)
SCHEMA.write_text(new_text)
print(f"Fixed {count} optional Decimal field placements.")
