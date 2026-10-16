-- v2.44.0: first sign-in password rotation.
-- User.mustChangePassword (default false — existing accounts are untouched;
-- admins can force-reset them via PATCH /api/users/[id]).
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
