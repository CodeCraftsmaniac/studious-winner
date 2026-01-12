-- ============================================
-- Student Schedules Table (Spring 2026 Advising)
-- ============================================
-- This table stores individual student advising time slots
-- for the Spring 2026 registration period.
-- Data imported from students_final.csv

-- Create the table
CREATE TABLE IF NOT EXISTS student_schedules (
    student_id TEXT PRIMARY KEY,           -- 7-digit NSU student ID (e.g., "2321854")
    probation_flag TEXT NOT NULL,          -- "YES" or "NO"
    phase1_date DATE NOT NULL,             -- Phase 1 date (e.g., "2026-01-12")
    phase2_date DATE NOT NULL,             -- Phase 2 date (e.g., "2026-01-14")
    slot1_start_time TEXT NOT NULL,        -- Slot 1 start time (e.g., "8:32 AM")
    slot1_end_time TEXT NOT NULL,          -- Slot 1 end time (e.g., "8:52 AM")
    slot2_start_time TEXT NOT NULL,        -- Slot 2 start time (e.g., "4:02 PM")
    slot2_end_time TEXT NOT NULL,          -- Slot 2 end time (e.g., "4:22 PM")
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups by student ID
CREATE INDEX IF NOT EXISTS idx_student_schedules_student_id ON student_schedules(student_id);

-- Enable Row Level Security
ALTER TABLE student_schedules ENABLE ROW LEVEL SECURITY;

-- Allow public read access (anyone can check their slot)
CREATE POLICY "Anyone can view student schedules" ON student_schedules
    FOR SELECT USING (true);

-- ============================================
-- CSV Column Mapping
-- ============================================
-- CSV Header: StudentID,ProbationFlag,Phase1Date,Phase2Date,Slot1StartTime,Slot1EndTime,Slot2StartTime,Slot2EndTime
-- DB Columns: student_id,probation_flag,phase1_date,phase2_date,slot1_start_time,slot1_end_time,slot2_start_time,slot2_end_time
--
-- Sample CSV row:
-- 0910185,NO,2026-01-12,2026-01-14,8:32 AM,8:52 AM,4:02 PM,4:22 PM

-- ============================================
-- Import Instructions
-- ============================================
-- 1. Go to Supabase Dashboard > Table Editor
-- 2. Create table using schema above OR import CSV directly
-- 3. If importing CSV, Supabase will auto-convert column names to snake_case
-- 4. Verify column mapping matches the schema above

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE student_schedules IS 'Student advising time slots for Spring 2026 course registration';
COMMENT ON COLUMN student_schedules.student_id IS '7-digit NSU student ID';
COMMENT ON COLUMN student_schedules.probation_flag IS 'Whether student is on probation (YES/NO)';
COMMENT ON COLUMN student_schedules.phase1_date IS 'Phase 1 advising date';
COMMENT ON COLUMN student_schedules.phase2_date IS 'Phase 2 advising date';
COMMENT ON COLUMN student_schedules.slot1_start_time IS 'First slot start time (e.g., 8:32 AM)';
COMMENT ON COLUMN student_schedules.slot1_end_time IS 'First slot end time (e.g., 8:52 AM)';
COMMENT ON COLUMN student_schedules.slot2_start_time IS 'Second slot start time (e.g., 4:02 PM)';
COMMENT ON COLUMN student_schedules.slot2_end_time IS 'Second slot end time (e.g., 4:22 PM)';
