// MiyeeUpskill - shared helpers

function esc(s){
  if(s==null) return '';
  return (''+s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function toast(msg, kind){
  let t=document.getElementById('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent=msg;
  t.className='toast show'+(kind==='err'?' err':'');
  clearTimeout(t._hideTimer);
  t._hideTimer=setTimeout(()=>{ t.className='toast'; }, 3200);
}

// Returns the logged-in user's session + profile (role, org_id, full_name), or null if not logged in.
async function getCurrentProfile(){
  const { data: { session } } = await sb.auth.getSession();
  if(!session) return null;
  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();
  if(error || !profile) return null;
  return { session, profile };
}

// Guards a page: redirects to login if not authenticated, or to the wrong-role page if role doesn't match.
// requiredRole: 'admin' | 'founder' | null (null = any logged-in user)
async function requireAuth(requiredRole){
  const ctx = await getCurrentProfile();
  if(!ctx){ window.location.href = 'index.html'; return null; }
  if(requiredRole && ctx.profile.role !== requiredRole && !(requiredRole==='admin' && ctx.profile.role==='mentor')){
    // wrong role trying to access a page not meant for them
    window.location.href = ctx.profile.role === 'founder' ? 'dashboard.html' : 'admin.html';
    return null;
  }
  return ctx;
}

async function logout(){
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

function initials(name){
  return (name||'U').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
}

function topbarHTML(profile, activeLink){
  const isAdmin = profile.role==='admin' || profile.role==='mentor';
  const links = isAdmin
    ? `<a href="admin.html">Admin Console</a>`
    : `<a href="dashboard.html">My Courses</a> <a href="account.html">My Account</a>`;
  return `<div class="topbar"><div class="topbar-inner">
    <div class="brand"><img src="assets/logo.svg"><div class="brand-txt"><b>MiyeeUpskill</b>Learn &middot; Assess &middot; Certify</div></div>
    <div class="nav-user">${links}
      <div class="avatar">${initials(profile.full_name)}</div>
      <div style="line-height:1.2"><div style="font-weight:600;font-size:13px">${esc(profile.full_name)}</div><div style="font-size:11px;color:var(--muted)">${isAdmin?'Administrator':'Founder'}</div></div>
      <button class="btn btn-ghost btn-sm" onclick="logout()">Logout</button>
    </div></div></div>`;
}

function devCreditHTML(){
  return `<div class="dev-credit">Developed by Vipin Nair</div>`;
}

// Fetches a course's full semester -> module -> lesson tree in one nested query, sorted by order_index.
async function fetchCourseTree(courseId){
  const { data, error } = await sb.from('semesters')
    .select('id,course_id,name,order_index,pass_mark,duration_mins,modules(id,semester_id,name,order_index,lessons(id,module_id,title,ltype,mins,video_url,body,fields,order_index))')
    .eq('course_id', courseId);
  if(error) throw error;
  const semesters = (data||[]).slice().sort((a,b)=>a.order_index-b.order_index);
  semesters.forEach(s=>{
    s.modules = (s.modules||[]).slice().sort((a,b)=>a.order_index-b.order_index);
    s.modules.forEach(m=>{ m.lessons = (m.lessons||[]).slice().sort((a,b)=>a.order_index-b.order_index); });
  });
  return semesters;
}

function openModal(innerHtml, opts){
  closeModal();
  const ov = document.createElement('div');
  ov.id = 'modal-overlay';
  ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="modal-box'+(opts&&opts.wide?' wide':'')+'">'+innerHtml+'</div>';
  ov.addEventListener('click', (e)=>{ if(e.target===ov) closeModal(); });
  document.body.appendChild(ov);
}
function closeModal(){
  const ov = document.getElementById('modal-overlay');
  if(ov) ov.remove();
}

// ---------- printable marksheet / certificate ----------
// Shared by dashboard.js (founder printing their own) and admin.js
// (admin/mentor printing a founder's, from the Students tab).

function marksheetHTML(opts){
  const resultLabel = opts.passed ? 'PASS' : 'FAIL';
  const resultClass = opts.passed ? 'result-pass' : 'result-fail';
  return '<div class="print-page marksheet-page">'+
    '<div class="print-head">'+
      '<img src="assets/logo.svg" class="print-logo">'+
      '<div class="print-brand"><b>MiyeeUpskill</b><span>Learn &middot; Assess &middot; Certify</span></div>'+
      '<div class="print-doc-title">MARKSHEET</div>'+
    '</div>'+
    '<div class="print-meta">'+
      '<div><span>Founder</span><b>'+esc(opts.founderName)+'</b></div>'+
      '<div><span>Course</span><b>'+esc(opts.courseTitle)+'</b></div>'+
      '<div><span>Semester</span><b>'+esc(opts.semesterName)+'</b></div>'+
    '</div>'+
    '<table class="marksheet-table">'+
      '<thead><tr><th>Assessment</th><th>Marks Obtained</th><th>Max Marks</th><th>Percentage</th><th>Result</th></tr></thead>'+
      '<tbody><tr>'+
        '<td>Semester Assessment</td>'+
        '<td>'+opts.score+'</td>'+
        '<td>'+opts.maxScore+'</td>'+
        '<td>'+Math.round(opts.percentage)+'%</td>'+
        '<td class="'+resultClass+'">'+resultLabel+'</td>'+
      '</tr></tbody>'+
    '</table>'+
    '<div class="print-meta" style="margin-top:14px">'+
      '<div><span>Pass Mark Required</span><b>'+opts.passMark+'%</b></div>'+
      '<div><span>Attempt</span><b>#'+opts.attemptNumber+'</b></div>'+
      '<div><span>Date</span><b>'+esc(opts.dateStr)+'</b></div>'+
    '</div>'+
    '<div class="print-footer">Developed by Vipin Nair</div>'+
  '</div>';
}

function certificateHTML(opts){
  return '<div class="print-page certificate-page">'+
    '<div class="cert-border">'+
      '<img src="assets/logo.svg" class="print-logo">'+
      '<div class="print-brand" style="justify-content:center;align-items:center"><b>MiyeeUpskill</b><span>Learn &middot; Assess &middot; Certify</span></div>'+
      '<div class="cert-title">Certificate of Completion</div>'+
      '<div class="cert-sub">This is to certify that</div>'+
      '<div class="cert-name">'+esc(opts.founderName)+'</div>'+
      '<div class="cert-sub">has successfully completed the</div>'+
      '<div class="cert-course">'+esc(opts.courseTitle)+'</div>'+
      '<div class="cert-semlist">'+opts.semesterNames.map(n=>esc(n)).join(' &middot; ')+'</div>'+
      '<div class="cert-date">Date of Completion: '+esc(opts.dateStr)+'</div>'+
      '<div class="cert-sign-row">'+
        '<div class="cert-sign"><div class="cert-sign-line"></div>Programme Director</div>'+
        '<div class="cert-sign"><div class="cert-sign-line"></div>MiyeeUpskill</div>'+
      '</div>'+
    '</div>'+
    '<div class="print-footer">Developed by Vipin Nair</div>'+
  '</div>';
}
