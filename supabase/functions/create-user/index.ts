// MiyeeUpskill - create-user Edge Function
//
// Creates a new Supabase Auth user (founder or mentor) with an
// admin-chosen password, plus the matching profiles row.
//
// This must run server-side because it needs the service_role key,
// which must never be shipped in frontend code (config.js only ever
// carries the anon/publishable key). Supabase provides SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to every Edge
// Function automatically at runtime, there is nothing to configure.
//
// Deploy with: supabase functions deploy create-user --project-ref <project-ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200){
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if(req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try{
    const authHeader = req.headers.get('Authorization');
    if(!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Identify the caller from their own session JWT. This client has no
    // elevated privileges, it only tells us who is making the request.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if(callerErr || !callerData?.user){
      return json({ error: 'Invalid or expired session' }, 401);
    }

    // Elevated client. Only used after we've confirmed the caller is an admin.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile, error: profErr } = await adminClient
      .from('profiles')
      .select('role, org_id')
      .eq('id', callerData.user.id)
      .single();
    if(profErr || !callerProfile || callerProfile.role !== 'admin'){
      return json({ error: 'Only admins can create accounts' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const fullName = String(body.full_name || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'mentor' ? 'mentor' : 'founder';

    if(!email || !fullName){
      return json({ error: 'Email and full name are required.' }, 400);
    }
    if(password.length < 6){
      return json({ error: 'Password must be at least 6 characters.' }, 400);
    }

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if(createErr){
      return json({ error: createErr.message }, 400);
    }

    const { error: insertErr } = await adminClient.from('profiles').insert({
      id: created.user.id,
      org_id: callerProfile.org_id,
      full_name: fullName,
      role,
    });
    if(insertErr){
      // Roll back the orphaned auth user so a failed profile insert doesn't
      // leave behind a login with no profile row.
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: 'Could not create profile: ' + insertErr.message }, 400);
    }

    return json({ id: created.user.id, email, full_name: fullName, role });
  }catch(e){
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
