-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Table: instructors
create table instructors (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    avatar_url text,
    password_hash text,
    temp_password boolean default true,
    webauthn_credential jsonb,
    reset_requested boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Table: students
create table students (
    class_id text primary key,
    first_name text,
    last_name text,
    nic text,
    email text,
    nic_edited boolean default false,
    email_edited boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Table: attendance
create table attendance (
    id uuid primary key default uuid_generate_v4(),
    class_id text references students(class_id) on delete cascade,
    paper_number text not null,
    note text, -- Additional notes for Special/Ranking/Other
    month text not null, -- e.g., '2026-05'
    scanned_by uuid references instructors(id) on delete set null,
    scanned_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Insert a default admin instructor for testing
insert into instructors (name, password_hash, temp_password)
values ('Admin Instructor', '1234', true);
