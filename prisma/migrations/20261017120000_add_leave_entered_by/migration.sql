-- v2.38.0: on-behalf leave requests ("Entered by HR").
--
-- The portal files requests for the employee themself; HR needs to file in
-- an employee's name too (phone-in, walk-up, paper form). Both new columns
-- stay NULL for self-filed requests; when HR files on behalf they carry the
-- filer's user id (audit link) and display name (denormalised so every list
-- surface can render the "Entered by HR" chip without a join). Nullable:
-- legacy rows converge to the self-filed interpretation.
ALTER TABLE "leave_requests" ADD COLUMN "enteredById" TEXT;
ALTER TABLE "leave_requests" ADD COLUMN "enteredByName" TEXT;
