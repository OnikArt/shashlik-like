-- Application rollback is code-only. Keep the table and replay records intact.
-- No schema reversal is required for the previous application version.
BEGIN;
SELECT 1;
COMMIT;
