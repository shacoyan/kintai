-- Migration 006: Add night_shift_enabled to tenant_members
ALTER TABLE tenant_members ADD COLUMN night_shift_enabled BOOLEAN DEFAULT false;
