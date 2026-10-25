DROP TRIGGER person_profile_preserves_last_admin_update;
--> statement-breakpoint
DROP TRIGGER person_profile_preserves_last_admin_delete;
--> statement-breakpoint
DROP TRIGGER user_preserves_last_admin_delete;
--> statement-breakpoint
CREATE TRIGGER person_profile_preserves_last_admin_update
BEFORE UPDATE OF account_role,membership_status,banned_at ON person_profile
WHEN OLD.account_role='admin' AND OLD.membership_status='active' AND OLD.banned_at IS NULL
 AND (NEW.account_role<>'admin' OR NEW.membership_status<>'active' OR NEW.banned_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM person_profile p INNER JOIN account a ON a.user_id=p.user_id AND a.account_id=p.user_id AND a.provider_id='credential'
  WHERE p.user_id<>OLD.user_id AND p.account_role='admin' AND p.membership_status='active' AND p.banned_at IS NULL AND a.password IS NOT NULL AND a.password<>'' AND a.temporary_password_expires_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Last effective administrator'); END;
--> statement-breakpoint
CREATE TRIGGER person_profile_preserves_last_admin_delete
BEFORE DELETE ON person_profile
WHEN OLD.account_role='admin' AND OLD.membership_status='active' AND OLD.banned_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM person_profile p INNER JOIN account a ON a.user_id=p.user_id AND a.account_id=p.user_id AND a.provider_id='credential'
  WHERE p.user_id<>OLD.user_id AND p.account_role='admin' AND p.membership_status='active' AND p.banned_at IS NULL AND a.password IS NOT NULL AND a.password<>'' AND a.temporary_password_expires_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Last effective administrator'); END;
--> statement-breakpoint
CREATE TRIGGER user_preserves_last_admin_delete
BEFORE DELETE ON user
WHEN EXISTS(SELECT 1 FROM person_profile WHERE user_id=OLD.id AND account_role='admin' AND membership_status='active' AND banned_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM person_profile p INNER JOIN account a ON a.user_id=p.user_id AND a.account_id=p.user_id AND a.provider_id='credential'
  WHERE p.user_id<>OLD.id AND p.account_role='admin' AND p.membership_status='active' AND p.banned_at IS NULL AND a.password IS NOT NULL AND a.password<>'' AND a.temporary_password_expires_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Last effective administrator'); END;
