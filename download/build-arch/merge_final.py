#!/usr/bin/env python3
"""Merge cover (Playwright) + body (ReportLab) into the final architecture plan PDF."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

COVER = '/home/z/my-project/download/build-arch/cover.pdf'
BODY = '/home/z/my-project/download/build-arch/body.pdf'
OUT = '/home/z/my-project/download/mbumah-architecture-plan.pdf'


def normalize_page_to_a4(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page


writer = PdfWriter()
writer.add_page(normalize_page_to_a4(PdfReader(COVER).pages[0]))
for page in PdfReader(BODY).pages:
    writer.add_page(normalize_page_to_a4(page))
writer.add_metadata({
    '/Title': 'Mbumah Hardware POS - Reliability Architecture Plan: '
              'Automatic Updates, Rollback and Backup',
    '/Author': 'Z.ai',
    '/Creator': 'Z.ai',
    '/Subject': 'Architecture plan: automatic GitHub updates, one-click '
                'rollback and automatic database backup for a five-store '
                'POS system',
})
with open(OUT, 'wb') as f:
    writer.write(f)
print('merged ->', OUT, '| pages:', len(writer.pages))
