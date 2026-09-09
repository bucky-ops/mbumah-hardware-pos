-- Task 12-d (debt-plan audit): record WHEN a payment plan was approved.
-- Complements approvedById (WHO) so the segregation-of-duties audit trail
-- captures the full approval metadata. Nullable: PENDING_APPROVAL plans and
-- legacy rows have no approval timestamp.
ALTER TABLE "debt_payment_plans" ADD COLUMN "approvedAt" TIMESTAMP(3);
