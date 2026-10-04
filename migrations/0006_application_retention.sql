-- ponytail: append-only D1 ROWID selects the latest application without
-- inventing a future timestamp. Preserve insertion order in table rebuilds;
-- add an explicit sequence if a future migration cannot preserve that order.
CREATE TRIGGER membership_application_retained_delete
BEFORE DELETE ON membership_application
BEGIN SELECT RAISE(ABORT, 'Application history is retained'); END;
