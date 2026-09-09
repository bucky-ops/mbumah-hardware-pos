// Shared resolution of the on-disk directory used to store generated
// data-export files (CSV/JSON) — used by /api/data-exports and
// /api/data-exports/[id].
//
// AUDIT FIX (Finding 1.2 family — hardcoded developer path removed):
// Both routes previously hardcoded `EXPORTS_DIR = '/home/z/my-project/
// download/exports'`. That path (a) leaked the original developer's home
// directory into source control and (b) does not exist on Vercel serverless,
// where the only writable location is the ephemeral function tmp directory —
// so EVERY export request failed at the fs.mkdir/writeFile step and the
// export row was marked FAILED.
//
// Resolution order:
//   1. `EXPORTS_DIR` env var (self-hosted / Docker deployments can pin a
//      persistent volume, e.g. EXPORTS_DIR=/data/mbumah/exports).
//   2. `<os.tmpdir()>/mbumah-exports` — writable on Vercel/Lambda. Files are
//      ephemeral by design there: the DataExport DB row remains the source
//      of truth, and the DELETE route already treats a missing file as a
//      best-effort no-op.

import os from 'os';
import path from 'path';

export function resolveExportsDir(): string {
  return process.env.EXPORTS_DIR || path.join(os.tmpdir(), 'mbumah-exports');
}
