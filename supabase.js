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

const SUPABASE_URL      = 'https://uawmekcnhlaktffvfrmb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kDDb5gtzxUIhISu_HVhK0Q_N8RAVLjt';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'implicit',
    detectSessionInUrl: true,
  },
});
