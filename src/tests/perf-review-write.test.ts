// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.87.0: the review gets written, and its subject reads it.
 *
 * Two dead-ends close in one round:
 *   1. WRITE (manager side) — the HR review detail dialog was read-only;
 *      the service's UPDATE action had no UI, and canSubmit requires a
 *      rating nobody could write, so a fresh DRAFT review could never be
 *      completed. The dialog now flips into an edit form (interactive
 *      1–5 stars, capped narratives, Save draft → PATCH action UPDATE).
 *   2. READ (employee side) — "My reviews" rows carried only cycle name,
 *      status and dates, so an employee acknowledged a review they had
 *      never read. A subject-scoped GET route serves the review body on
 *      demand and each row expands to read it before acknowledging.
 *
 * These are file-level contracts (the run-history.test.ts pattern): the
 * service rules behind canEdit live in stage-g-performance.test.ts.
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('self-service review detail route (the subject reads their own review)', () => {
  const route = readRepo('src/app/api/self-service/me/reviews/[id]/route.ts');

  it('exists as a subject-scoped GET under the self-service guard', () => {
    expect(route).toContain("GET = selfServiceGuard('hr.performance.read.own')");
    expect(route).toContain('getReviewDetail');
    expect(route).toMatch(/me\/reviews\/\[id\]|params/);
  });

  it('draws the self-service boundary at isSelf — same-store reviewers read through the HR console, never here', () => {
    expect(route).toContain('if (!data.isSelf)');
    expect(route).toContain('NOT_THE_SUBJECT');
    expect(route).toMatch(/403/);
  });

  it('the acknowledge route stays the POST half of the loop', () => {
    const ack = readRepo('src/app/api/self-service/me/reviews/[id]/acknowledge/route.ts');
    expect(ack).toContain("action: 'ACKNOWLEDGE'");
    expect(ack).toContain('selfServiceGuard');
  });
});

describe('HR review dialog — the write half', () => {
  const page = readRepo('src/app/(shell)/hr/performance/page.tsx');

  it('carries canEdit into the view DTO and opens the edit form only from it', () => {
    expect(page).toContain('canEdit: boolean;');
    expect(page).toMatch(/detail\.canEdit \?/);
  });

  it('the edit affordance names its state: Write review on an unrated draft, Edit review after', () => {
    expect(page).toContain("'Write review' : 'Edit review'");
    expect(page).toContain('detail.overallRating === null');
  });

  it('the form: interactive rating radio group, capped textareas, live counters', () => {
    expect(page).toContain('role="radiogroup"');
    expect(page).toContain('data-testid={`perf-rating-option-${n}`}');
    expect(page).toContain('perf-strengths-input');
    expect(page).toContain('perf-improvements-input');
    expect(page).toContain('maxLength={NARRATIVE_MAX}');
    expect(page).toContain('{editStrengths.length}/{NARRATIVE_MAX}');
    expect(page).toContain('NARRATIVE_MAX = 4000');
    expect(page).toContain('RATING_MAX = 5');
  });

  it('Save draft PATCHes UPDATE with the full payload, and only with a rating chosen', () => {
    expect(page).toContain("action: 'UPDATE'");
    expect(page).toContain('overallRating: editRating');
    expect(page).toContain('strengths: editStrengths');
    expect(page).toContain('improvements: editImprovements');
    // disabled={busy || editRating === null} — the rating is not optional
    expect(page).toMatch(/disabled=\{busy \|\| editRating === null\}/);
    expect(page).toContain('perf-save-draft');
    expect(page).toContain('perf-cancel-edit');
  });

  it('editing seeds from the current detail, exits edit mode on open and on save', () => {
    expect(page).toContain('setEditRating(detail.overallRating)');
    expect(page).toContain('setEditStrengths(detail.strengths ?? \'\')');
    expect(page).toContain('setEditImprovements(detail.improvements ?? \'\')');
    expect(page).toMatch(/setDetail\(d\);\s*\n\s*setEditing\(false\)/);
  });

  it('the action row widens to include edit, and submit/calibrate keep their gates', () => {
    expect(page).toContain('detail.canEdit || detail.canSubmit || detail.canCalibrate');
    expect(page).toContain("action: 'SUBMIT'");
    expect(page).toContain("action: 'CALIBRATE'");
    expect(page).toContain('Submit for acknowledgement');
  });
});

describe('My reviews — the read half before the acknowledgement', () => {
  const view = readRepo('src/app/(selfservice)/employees/me/goals/goals-view.tsx');

  it('every review row gains a Read review toggle that expands an inline panel', () => {
    expect(view).toContain('Read review');
    expect(view).toContain('data-testid={`my-review-read-${r.id}`}');
    expect(view).toContain('aria-expanded={openReviewId === r.id}');
    expect(view).toContain('data-testid="my-review-panel"');
  });

  it('the panel body is fetched on demand from the subject-scoped route, fetched ONCE per review', () => {
    expect(view).toContain('apiGet<ReviewDetail>(`/api/self-service/me/reviews/${id}`)');
    expect(view).toContain('if (!reviewDetails[id])');
    expect(view).toContain('reviewDetails, setReviewDetails');
  });

  it('the panel reads the review: stars, strengths, improvements — same families as the dialog', () => {
    expect(view).toMatch(/fill-amber-400 text-amber-400/);
    expect(view).toMatch(/text-emerald-700 dark:text-emerald-400/);
    expect(view).toMatch(/text-amber-700 dark:text-amber-400/);
    expect(view).toContain('overallRating ?? \'Not set\'');
  });

  it('the acknowledgement itself is untouched: POST + router.refresh, gated to SUBMITTED', () => {
    expect(view).toContain("apiSend(`/api/self-service/me/reviews/${id}/acknowledge`, 'POST')");
    expect(view).toContain('router.refresh()');
    expect(view).toMatch(/r\.status === 'SUBMITTED' \? \(/);
  });

  it('the SSR list payload stays rating-free (the sensitive-data rule holds)', () => {
    // ReviewDto (the list item) must not grow rating/narrative fields.
    const dto = view.split('export interface ReviewDto {')[1].split('}')[0];
    expect(dto).not.toMatch(/overallRating|strengths|improvements/);
  });
});
