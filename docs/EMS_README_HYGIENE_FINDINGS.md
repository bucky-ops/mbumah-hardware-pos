# EMS README Hygiene Findings

Scope: README and docs issues relevant to EMS onboarding, collected read-only at 6dbce961 (v2.18.4). Fixes are bundled into maintenance or EMS releases, not the audit commit.

## Findings

1. README is broad and mixes quick start, deployment, troubleshooting, and module documentation. The docs folder already contains the split targets (local-offline-setup, lan-deployment, online-hosting, troubleshooting-and-faq, release-process). Action during EMS releases: slim README to overview plus pointers, as done for earlier splits. P2.
2. Demo account table: prior releases standardized the canonical domain mbumahhardware.co.ke across seed, docs, and README (v2.18.3.3 line of work). Current README table uses the canonical domain; seed uses the same domain. Consistent. No action.
3. RBAC table format: README permission tables use text role values rather than checkmark glyphs. Consistent with the no-decorative-emoji rule. No action.
4. Logo references: prior releases consolidated brand assets under public/ with docs/BRAND.md (v2.18.3 reconciliation). No png versus svg conflict found in README references at this HEAD. No action.
5. Em dash and en dash scan: the repo-wide scan for decorative dashes in prose shows remaining hits in archived docs only; active docs conform. EMS docs follow the comma, colon, and parenthesis rule with technical hyphens preserved. No action needed for EMS work; archive cleanup stays P2.
6. Troubleshooting content already lives in docs/troubleshooting-and-faq.md; README links rather than duplicates. No action.
7. UPDATE_ON_START is not listed in .env.example although deployment docs reference it. Add during the 2.18.5 release (P2, one-line addition).
8. Employee data handling guidance is absent from user-facing docs until EMS ships. docs/hr/data-protection.md lands with 2.18.5 and the privacy notes are referenced from README during 2.19.0.

## Rule application to EMS deliverables

1. No decorative emojis in any EMS doc, UI string, comment, commit message, or release note.
2. No AI-style dash characters in prose; technical hyphens preserved in identifiers.
3. Calm, professional, technical language.
4. Code and command output outrank README claims; mismatches are documented in the audit evidence file.
