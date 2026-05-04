-- Run this in your Supabase SQL Editor if the 'students' table already exists
-- This adds the 'name_edited' column to track whether a student has already changed their name

ALTER TABLE students
ADD COLUMN IF NOT EXISTS name_edited boolean DEFAULT false;
