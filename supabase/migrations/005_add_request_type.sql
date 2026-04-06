-- Migration 005: Add request_type to correction_requests (correction or delete)
ALTER TABLE correction_requests ADD COLUMN request_type TEXT CHECK (request_type IN ('correction', 'delete')) DEFAULT 'correction';
