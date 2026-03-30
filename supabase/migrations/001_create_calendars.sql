-- Kallendar: calendars table
-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/nrgxsvkjfbodervuvhpv/sql

create table if not exists public.calendars (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default '',
  url         text,
  color       text not null default '#3b82f6',
  type        text not null default 'url',
  created_at  timestamptz not null default now()
);

-- Row Level Security
alter table public.calendars enable row level security;

create policy "Users can read their own calendars"
  on public.calendars for select
  using (auth.uid() = user_id);

create policy "Users can insert their own calendars"
  on public.calendars for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own calendars"
  on public.calendars for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own calendars"
  on public.calendars for delete
  using (auth.uid() = user_id);
