-- ALTER preserves existing receipts, actor/key indexes and immutable triggers.
ALTER TABLE `role_change_operation` ADD COLUMN `authority_kind` text
  CONSTRAINT `role_change_operation_authority_kind_check`
  CHECK (`authority_kind` IS NULL OR (`authority_kind` = 'department_manager' AND `command_family` = 'single' AND `role` IS NOT NULL AND `role` = 'program_leader'));
