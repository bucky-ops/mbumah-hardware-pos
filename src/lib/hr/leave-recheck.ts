// v2.59.0: the desk re-check heuristic — ONE shared definition of "this
// correction has not been seen by the desk yet".
//
// A leave request that was corrected in place (editedAt, v2.40.0) stays
// PENDING, so nothing about its row changes status-wise when the dates or
// days underneath an approval decision move. The re-check marker exists so
// the approvals desk can never mistake a stale read for a fresh one:
//
//   editedAt absent            -> false (never corrected — nothing to re-check)
//   deskReviewedAt absent      -> true  (corrected, never opened since)
//   deskReviewedAt < editedAt  -> true  (last desk visit PREDATES the edit)
//   deskReviewedAt >= editedAt -> false (the desk opened it after the edit)
//
// Boundary: a review stamped at the exact same millisecond as the edit
// counts as having seen it (>= , not >) — the stamp route runs strictly
// after the dialog opens, so an equal timestamp can only mean the desk
// opened THIS version of the request.

export function needsDeskRecheck(
  editedAt: Date | string | null | undefined,
  deskReviewedAt: Date | string | null | undefined,
): boolean {
  if (!editedAt) return false;
  if (!deskReviewedAt) return true;
  return new Date(deskReviewedAt).getTime() < new Date(editedAt).getTime();
}
