-- ============================================================
-- Migration: Create `papers` table for dynamic paper management
-- Run this in your Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS papers (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    paper_number TEXT UNIQUE NOT NULL,      -- e.g. "Black Paper 30", "Custom Exam A"
    category    TEXT NOT NULL DEFAULT 'Custom',  -- e.g. "Black Paper", "Special", "Custom"
    unique_code TEXT,                       -- Optional short code, e.g. "BP30", "SP01"
    is_active   BOOLEAN DEFAULT TRUE,
    sort_order  INT DEFAULT 100,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with existing default papers (skip if already exist)
INSERT INTO papers (paper_number, category, sort_order) VALUES
('Black Paper 30',  'Black Paper', 1),
('Black Paper 31',  'Black Paper', 2),
('Black Paper 32',  'Black Paper', 3),
('Black Paper 33',  'Black Paper', 4),
('Black Paper 34',  'Black Paper', 5),
('Black Paper 35',  'Black Paper', 6),
('Black Paper 36',  'Black Paper', 7),
('Black Paper 37',  'Black Paper', 8),
('Black Paper 38',  'Black Paper', 9),
('Black Paper 39',  'Black Paper', 10),
('Black Paper 40',  'Black Paper', 11),
('Black Paper 41',  'Black Paper', 12),
('Black Paper 42',  'Black Paper', 13),
('Black Paper 43',  'Black Paper', 14),
('Black Paper 44',  'Black Paper', 15),
('Black Paper 45',  'Black Paper', 16),
('Black Paper 46',  'Black Paper', 17),
('Black Paper 47',  'Black Paper', 18),
('Black Paper 48',  'Black Paper', 19),
('Black Paper 49',  'Black Paper', 20),
('Black Paper 50',  'Black Paper', 21),
('Black Paper 51',  'Black Paper', 22),
('Black Paper 52',  'Black Paper', 23),
('Black Paper 53',  'Black Paper', 24),
('Black Paper 54',  'Black Paper', 25),
('Black Paper 55',  'Black Paper', 26),
('Black Paper 56',  'Black Paper', 27),
('Black Paper 57',  'Black Paper', 28),
('Black Paper 58',  'Black Paper', 29),
('Black Paper 59',  'Black Paper', 30),
('Black Paper 60',  'Black Paper', 31),
('Special Paper',   'Special',     50),
('Rank Paper',      'Rank',        51),
('Other',           'Other',       99)
ON CONFLICT (paper_number) DO NOTHING;
