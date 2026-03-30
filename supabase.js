/**
 * supabase.js — Kallendar Supabase client
 *
 * The @supabase/supabase-js UMD bundle is loaded from CDN in index.html,
 * exposing `window.supabase`. This module creates the singleton client used
 * throughout app.js.
 *
 * Both credentials below are the publishable anon key — safe to ship in
 * browser code.  Row Level Security on the `calendars` table ensures each
 * user can only access their own rows.
 */

const SUPABASE_URL      = 'https://nrgxsvkjfbodervuvhpv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yZ3hzdmtqZmJvZGVydnV2aHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MjkzMjksImV4cCI6MjA5MDEwNTMyOX0.mhUWbH-fxUPJ-iT1RzOKPWcDxb7SVy4wP5u8bywT7dA';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
