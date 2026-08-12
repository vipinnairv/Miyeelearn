// MiyeeUpskill - Supabase connection config
// The publishable/anon key below is SAFE to expose publicly (e.g. on GitHub Pages).
// Real security comes from Row Level Security policies on the database, not from hiding this key.
// Never put a service_role / secret key in this file or anywhere in frontend code.

const SUPABASE_URL = "https://syswstdkoflfohbjugms.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_68xgYVhldSIj5142qJlKKg_LkOY7K0l";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
