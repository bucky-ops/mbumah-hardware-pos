#!/usr/bin/env python3
"""Merge cover (page 0) + ReportLab body into the final deliverable PDF."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

COVER_PDF = '/home/z/my-project/download/build/cover.pdf'
BODY_PDF = '/home/z/my-project/download/build/body.pdf'
FINAL_PDF = '/home/z/my-project/download/mbumah-v2.8.0-fix-checklist.pdf'


def normalize_page_to_a4(page):
    """Scale a page to A4 if its dimensions differ by more than 2pt."""
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.5 or abs(h - A4_H) > 0.5:
        page.scale_to(A4_W, A4_H)
    return page


writer = PdfWriter()
cover_page = PdfReader(COVER_PDF).pages[0]
writer.add_page(normalize_page_to_a4(cover_page))
for page in PdfReader(BODY_PDF).pages:
    writer.add_page(normalize_page_to_a4(page))

writer.add_metadata({
    '/Title': 'Mbumah Hardware POS - Version 2.8.0 Fixes & Acceptance Checklist',
    '/Author': 'Z.ai',
    '/Creator': 'Z.ai',
    '/Subject': 'Version 2.8.0 fixes, changes and acceptance tests for client sign-off',
})
with open(FINAL_PDF, 'wb') as f:
    writer.write(f)

r = PdfReader(FINAL_PDF)
print('final pages:', len(r.pages))
for i, p in enumerate(r.pages):
    print(' page', i + 1, round(float(p.mediabox.width), 2), 'x',
          round(float(p.mediabox.height), 2))
print('saved:', FINAL_PDF)
