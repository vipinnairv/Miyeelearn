// MiyeeUpskill - founder dashboard (course list, course detail, lesson viewer)

let CTX = null;

async function boot(){
  CTX = await requireAuth(null);
  if(!CTX) return;
  if(CTX.profile.role==='admin' || CTX.profile.role==='mentor'){
    window.location.href = 'admin.html';
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

// ---------- local-only progress / draft helpers ----------
// Video and reading "viewed" state and worksheet drafts are client-only (localStorage),
// since there is no lesson_progress table yet. Worksheet submissions themselves are
// the source of truth and live in worksheet_submissions.

function viewedSet(){
  try{ return new Set(JSON.parse(localStorage.getItem('miyee_viewed_'+CTX.session.user.id)||'[]')); }
  catch(e){ return new Set(); }
}
function markViewed(lessonId){
  const s = viewedSet();
  if(s.has(lessonId)) return;
  s.add(lessonId);
  localStorage.setItem('miyee_viewed_'+CTX.session.user.id, JSON.stringify([...s]));
}
function draftKey(lessonId){ return 'miyee_draft_'+CTX.session.user.id+'_'+lessonId; }
function loadDraft(lessonId){
  try{ return JSON.parse(localStorage.getItem(draftKey(lessonId))||'null'); }
  catch(e){ return null; }
}
function saveDraft(lessonId, answers){ localStorage.setItem(draftKey(lessonId), JSON.stringify(answers)); }
function clearDraft(lessonId){ localStorage.removeItem(draftKey(lessonId)); }

// ---------- router ----------

function parseHash(){
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if(parts[0]==='course' && parts[1]){
    if(parts[2]==='lesson' && parts[3]) return { view:'lesson', courseId:parts[1], lessonId:parts[3] };
    if(parts[2]==='semester' && parts[3] && parts[4]==='quiz') return { view:'quiz', courseId:parts[1], semesterId:parts[3] };
    if(parts[2]==='semester' && parts[3] && parts[4]==='attempt' && parts[5]) return { view:'attempt', courseId:parts[1], semesterId:parts[3], attemptId:parts[5] };
    return { view:'course', courseId:parts[1] };
  }
  return { view:'list' };
}

async function route(){
  const r = parseHash();
  const root = document.getElementById('root');
  root.innerHTML = topbarHTML(CTX.profile) + '<div class="app-shell" id="view"><div class="loading"><div class="spinner"></div>Loading...</div></div>' + devCreditHTML();
  const view = document.getElementById('view');
  try{
    if(r.view==='list') await renderCourseList(view);
    else if(r.view==='course') await renderCourseDetail(view, r.courseId);
    else if(r.view==='lesson') await renderLesson(view, r.courseId, r.lessonId);
    else if(r.view==='quiz') await renderQuiz(view, r.courseId, r.semesterId);
    else if(r.view==='attempt') await renderAttemptReview(view, r.courseId, r.semesterId, r.attemptId);
  }catch(err){
    console.error(err);
    view.innerHTML = '<div class="err">Could not load this page. '+esc(err.message||'Unknown error')+'</div>';
  }
}

// ---------- data helpers ----------
// fetchCourseTree() lives in common.js (shared with admin.js).

function courseStats(semesters, submittedKeySet, viewedIdSet){
  let total=0, done=0;
  semesters.forEach(s=> s.modules.forEach(m=> m.lessons.forEach(l=>{
    total++;
    if(l.ltype==='worksheet'){ if(submittedKeySet.has(l.id)) done++; }
    else if(viewedIdSet.has(l.id)) done++;
  })));
  return { total, done, pct: total ? Math.round(done/total*100) : 0 };
}

// ---------- course list ----------

async function renderCourseList(view){
  const uid = CTX.session.user.id;
  const { data: enrolments, error } = await sb.from('enrolments')
    .select('course_id, courses(id,title,description)')
    .eq('founder_id', uid);
  if(error) throw error;

  if(!enrolments || !enrolments.length){
    view.innerHTML = '<div class="crumb">Home / My Courses</div>'+
      '<div class="page-head"><h1>My Courses</h1></div>'+
      '<div class="card"><div class="card-b"><p style="color:var(--muted)">You are not enrolled in any courses yet. Ask your programme admin to enrol you.</p></div></div>';
    return;
  }

  const viewed = viewedSet();
  const cards = [];
  for(const en of enrolments){
    const course = en.courses;
    if(!course) continue;
    const semesters = await fetchCourseTree(course.id);
    const { data: subs } = await sb.from('worksheet_submissions').select('worksheet_key').eq('course_id', course.id).eq('founder_id', uid);
    const subKeys = new Set((subs||[]).map(s=>s.worksheet_key));
    const stats = courseStats(semesters, subKeys, viewed);
    cards.push(
      '<div class="course-card" onclick="location.hash=\'#/course/'+course.id+'\'">'+
        '<div class="cc-top"><h3>'+esc(course.title)+'</h3><span class="pill">'+stats.pct+'% complete</span></div>'+
        '<p class="cc-desc">'+esc(course.description||'')+'</p>'+
        '<div class="meter"><div class="meter-fill" style="width:'+stats.pct+'%"></div></div>'+
        '<div class="cc-foot">'+stats.done+' of '+stats.total+' lessons completed &middot; '+semesters.length+' semester'+(semesters.length===1?'':'s')+'</div>'+
      '</div>'
    );
  }

  view.innerHTML = '<div class="crumb">Home / My Courses</div>'+
    '<div class="page-head"><h1>My Courses</h1></div>'+
    '<div class="course-grid">'+cards.join('')+'</div>';
}

// ---------- course detail ----------

async function renderCourseDetail(view, courseId){
  const uid = CTX.session.user.id;
  const { data: course, error: cErr } = await sb.from('courses').select('*').eq('id', courseId).single();
  if(cErr || !course) throw cErr || new Error('Course not found');

  const semesters = await fetchCourseTree(courseId);
  const { data: subs } = await sb.from('worksheet_submissions').select('*').eq('course_id', courseId).eq('founder_id', uid);
  const subsByKey = {};
  (subs||[]).forEach(s=>{ subsByKey[s.worksheet_key] = s; });
  const subKeys = new Set(Object.keys(subsByKey));
  const viewed = viewedSet();

  const { data: attempts } = await sb.from('assessment_attempts').select('*').eq('course_id', courseId).eq('founder_id', uid);
  const attemptsBySemester = {};
  (attempts||[]).forEach(a=>{ (attemptsBySemester[a.semester_id] = attemptsBySemester[a.semester_id] || []).push(a); });

  const semHtml = semesters.map((s, si)=>{
    const semAttempts = (attemptsBySemester[s.id]||[]).slice().sort((a,b)=> new Date(b.submitted_at) - new Date(a.submitted_at));
    const passedAttempt = semAttempts.find(a=>a.passed);

    if(si>0){
      const prevPassed = (attemptsBySemester[semesters[si-1].id]||[]).some(a=>a.passed);
      if(!prevPassed){
        const prev = semesters[si-1];
        return '<div class="sem-card locked">'+
          '<div class="sem-head"><h3>&#128274; '+esc(s.name)+'</h3><span class="pill pill-muted">Locked</span></div>'+
          '<p class="cc-desc">Pass the assessment for "'+esc(prev.name)+'" to unlock this semester.</p>'+
        '</div>';
      }
    }

    const stats = courseStats([s], subKeys, viewed);
    const modulesHtml = s.modules.map(m=>{
      const lessonsHtml = m.lessons.map(l=>{
        let statusBadge = '';
        if(l.ltype==='worksheet'){
          const sub = subsByKey[l.id];
          statusBadge = sub
            ? (sub.reviewed ? '<span class="pill pill-ok">Reviewed</span>' : '<span class="pill pill-warn">Submitted</span>')
            : '<span class="pill pill-muted">Not submitted</span>';
        } else if(viewed.has(l.id)){
          statusBadge = '<span class="pill pill-ok">Viewed</span>';
        }
        const icon = l.ltype==='video' ? '&#9654;' : (l.ltype==='reading' ? '&#128214;' : '&#128221;');
        return '<div class="lesson-row" onclick="location.hash=\'#/course/'+courseId+'/lesson/'+l.id+'\'">'+
          '<span class="lesson-icon">'+icon+'</span>'+
          '<span class="lesson-title">'+esc(l.title)+'</span>'+
          '<span class="lesson-mins">'+l.mins+' min</span>'+
          statusBadge+
        '</div>';
      }).join('');
      return '<div class="module-block"><div class="module-title">'+esc(m.name)+'</div>'+lessonsHtml+'</div>';
    }).join('');

    let assessActions;
    if(passedAttempt){
      assessActions = '<span class="pill pill-ok">Passed '+Math.round(passedAttempt.percentage)+'%</span>'+
        '<button class="btn btn-ghost btn-sm" onclick="location.hash=\'#/course/'+courseId+'/semester/'+s.id+'/attempt/'+passedAttempt.id+'\'">View Result</button>';
    }else if(semAttempts.length){
      const latest = semAttempts[0];
      assessActions = '<span class="pill pill-warn">Failed '+Math.round(latest.percentage)+'%</span>'+
        '<button class="btn btn-ghost btn-sm" onclick="location.hash=\'#/course/'+courseId+'/semester/'+s.id+'/attempt/'+latest.id+'\'">View Result</button>'+
        '<button class="btn btn-gold btn-sm" onclick="location.hash=\'#/course/'+courseId+'/semester/'+s.id+'/quiz\'">Retake Assessment</button>';
    }else{
      assessActions = '<button class="btn btn-gold btn-sm" onclick="location.hash=\'#/course/'+courseId+'/semester/'+s.id+'/quiz\'">Take Assessment</button>';
    }

    return '<div class="sem-card">'+
      '<div class="sem-head"><h3>'+esc(s.name)+'</h3><span class="pill">'+stats.pct+'% complete</span></div>'+
      '<div class="meter"><div class="meter-fill" style="width:'+stats.pct+'%"></div></div>'+
      '<div class="sem-assess-row"><span style="font-size:12.5px;color:var(--muted)">Assessment: pass mark '+s.pass_mark+'%, '+s.duration_mins+' min</span>'+
      '<span class="sem-assess-actions">'+assessActions+'</span></div>'+
      modulesHtml+
    '</div>';
  }).join('');

  view.innerHTML = '<div class="crumb"><a onclick="location.hash=\'#/\'">My Courses</a> / '+esc(course.title)+'</div>'+
    '<div class="page-head"><h1>'+esc(course.title)+'</h1></div>'+
    '<p style="color:var(--muted);font-size:14px;margin-bottom:20px;max-width:760px">'+esc(course.description||'')+'</p>'+
    semHtml;
}

// ---------- lesson viewer ----------

function embedVideo(url){
  if(!url) return '<div class="video-empty">No video URL set for this lesson yet.</div>';
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if(yt) return '<iframe src="https://www.youtube.com/embed/'+yt[1]+'" frameborder="0" allowfullscreen></iframe>';
  const vim = url.match(/vimeo\.com\/(\d+)/);
  if(vim) return '<iframe src="https://player.vimeo.com/video/'+vim[1]+'" frameborder="0" allowfullscreen></iframe>';
  if(/\.mp4(\?|$)/i.test(url)) return '<video controls src="'+esc(url)+'"></video>';
  return '<div class="video-empty">Video link: <a href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(url)+'</a></div>';
}

function computeFieldValue(formula, rawA, rawB){
  const a = parseFloat(rawA), b = parseFloat(rawB);
  if(isNaN(a) || isNaN(b)) return null;
  switch(formula){
    case 'wow': return a===0 ? null : ((b-a)/a*100);
    case 'diff': return b-a;
    case 'sum': return a+b;
    case 'ratio': return a===0 ? null : (b/a);
    default: return null;
  }
}

function renderWorksheetForm(lesson, existing){
  const draft = loadDraft(lesson.id);
  const answers = draft || (existing ? existing.answers : {}) || {};
  const locked = !!(existing && existing.reviewed);

  const fieldsHtml = (lesson.fields||[]).map((f, idx)=>{
    const ftype = f.ftype || 'longtext';
    const val = answers[idx] != null ? answers[idx] : '';
    const label = '<label class="wf-label">'+esc(f.label)+(f.unit?' <span class="wf-unit">('+esc(f.unit)+')</span>':'')+'</label>';
    const hint = f.hint ? '<div class="wf-hint">'+esc(f.hint)+'</div>' : '';
    let input = '';
    if(ftype==='shorttext'){
      input = '<input type="text" class="wf-input" data-idx="'+idx+'" value="'+esc(val)+'"'+(locked?' disabled':'')+'>';
    }else if(ftype==='number'){
      input = '<input type="number" class="wf-input" data-idx="'+idx+'" value="'+esc(val)+'"'+(locked?' disabled':'')+'>';
    }else if(ftype==='computed'){
      input = '<div class="wf-computed" data-idx="'+idx+'" data-refa="'+f.refA+'" data-refb="'+f.refB+'" data-formula="'+esc(f.formula||'')+'">--</div>';
    }else{
      input = '<textarea class="wf-input" data-idx="'+idx+'" rows="'+(f.rows||3)+'"'+(locked?' disabled':'')+'>'+esc(val)+'</textarea>';
    }
    return '<div class="wf-field">'+label+hint+input+'</div>';
  }).join('');

  let statusHtml = '';
  if(existing){
    statusHtml = existing.reviewed
      ? '<div class="ok-msg">Reviewed by your mentor.</div><div class="mentor-feedback"><b>Mentor feedback</b><br>'+esc(existing.mentor_feedback||'(no written comments yet)').replace(/\n/g,'<br>')+'</div>'
      : '<div class="ok-msg">Submitted, awaiting mentor review.</div>';
  }

  const actionBtn = locked
    ? '<button type="button" class="btn btn-ghost" id="wf-edit-btn">Edit &amp; Resubmit</button>'
    : '<button type="submit" class="btn btn-gold" id="wf-submit-btn">Submit Worksheet</button>';

  return '<div class="card"><div class="card-b">'+
    statusHtml+
    '<div class="meter" style="margin-bottom:6px"><div class="meter-fill" id="wf-meter-fill" style="width:0%"></div></div>'+
    '<div class="wf-meter-label" id="wf-meter-label">0% filled</div>'+
    '<form id="worksheet-form">'+
      fieldsHtml+
      '<div class="wf-actions"><span id="wf-save-status" class="wf-save-status"></span>'+actionBtn+'</div>'+
    '</form>'+
  '</div></div>';
}

function bindWorksheetEvents(lesson, courseId, uid, existing){
  const form = document.getElementById('worksheet-form');
  const fields = lesson.fields||[];

  function currentAnswers(){
    const answers = {};
    form.querySelectorAll('.wf-input').forEach(inp=>{ answers[inp.dataset.idx] = inp.value; });
    form.querySelectorAll('.wf-computed').forEach(el=>{
      const idx = el.dataset.idx;
      const val = computeFieldValue(el.dataset.formula, answers[el.dataset.refa], answers[el.dataset.refb]);
      answers[idx] = val==null ? '' : String(Math.round(val*100)/100);
    });
    return answers;
  }

  function refresh(){
    const answers = currentAnswers();
    form.querySelectorAll('.wf-computed').forEach(el=>{
      const idx = el.dataset.idx;
      const f = fields[idx] || {};
      const raw = answers[idx];
      el.textContent = raw==='' ? '--' : (raw + (f.unit ? (' '+f.unit) : ''));
    });
    const gradable = fields.map((f,i)=>({f,i})).filter(x=>(x.f.ftype||'longtext')!=='computed');
    const filled = gradable.filter(x=> (answers[x.i]||'').toString().trim()!=='').length;
    const pct = gradable.length ? Math.round(filled/gradable.length*100) : 100;
    document.getElementById('wf-meter-fill').style.width = pct+'%';
    document.getElementById('wf-meter-label').textContent = pct+'% filled';
    return answers;
  }

  function autosave(){
    const answers = refresh();
    saveDraft(lesson.id, answers);
    const st = document.getElementById('wf-save-status');
    if(st){
      st.textContent = 'Draft saved';
      clearTimeout(st._t);
      st._t = setTimeout(()=>{ st.textContent=''; }, 1500);
    }
  }

  const locked = !!(existing && existing.reviewed);
  if(!locked) form.addEventListener('input', autosave);
  refresh();

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const answers = refresh();
    const btn = document.getElementById('wf-submit-btn');
    btn.disabled = true; btn.textContent = 'Submitting...';
    const payload = {
      course_id: courseId,
      founder_id: uid,
      worksheet_key: lesson.id,
      answers: answers,
      submitted_at: new Date().toISOString(),
      reviewed: false,
      mentor_feedback: existing ? existing.mentor_feedback : null
    };
    let err;
    if(existing){
      ({ error: err } = await sb.from('worksheet_submissions').update(payload).eq('id', existing.id));
    }else{
      ({ error: err } = await sb.from('worksheet_submissions').insert(payload));
    }
    if(err){
      toast('Could not submit worksheet: '+err.message, 'err');
      btn.disabled = false; btn.textContent = 'Submit Worksheet';
      return;
    }
    clearDraft(lesson.id);
    toast('Worksheet submitted.');
    route();
  });

  const editBtn = document.getElementById('wf-edit-btn');
  if(editBtn){
    editBtn.addEventListener('click', ()=>{
      form.querySelectorAll('.wf-input').forEach(inp=> inp.disabled=false);
      const submitBtn = document.createElement('button');
      submitBtn.type = 'submit'; submitBtn.className = 'btn btn-gold'; submitBtn.id = 'wf-submit-btn';
      submitBtn.textContent = 'Submit Worksheet';
      editBtn.replaceWith(submitBtn);
      form.addEventListener('input', autosave);
    });
  }
}

async function renderLesson(view, courseId, lessonId){
  const uid = CTX.session.user.id;
  const { data: course } = await sb.from('courses').select('id,title').eq('id', courseId).single();
  const { data: lesson, error } = await sb.from('lessons').select('*').eq('id', lessonId).single();
  if(error || !lesson) throw error || new Error('Lesson not found');

  const crumb = '<div class="crumb"><a onclick="location.hash=\'#/\'">My Courses</a> / '+
    '<a onclick="location.hash=\'#/course/'+courseId+'\'">'+esc(course ? course.title : '')+'</a> / '+esc(lesson.title)+'</div>';

  let bodyHtml = '';
  let existing = null;

  if(lesson.ltype==='video'){
    markViewed(lesson.id);
    bodyHtml = '<div class="video-wrap">'+embedVideo(lesson.video_url)+'</div>'+
      (lesson.body ? '<div class="card" style="margin-top:16px"><div class="card-b">'+esc(lesson.body).replace(/\n/g,'<br>')+'</div></div>' : '');
  }else if(lesson.ltype==='reading'){
    markViewed(lesson.id);
    bodyHtml = '<div class="card"><div class="card-b reading-body">'+esc(lesson.body).replace(/\n/g,'<br>')+'</div></div>';
  }else if(lesson.ltype==='worksheet'){
    const { data: sub } = await sb.from('worksheet_submissions').select('*')
      .eq('course_id', courseId).eq('founder_id', uid).eq('worksheet_key', lesson.id)
      .order('submitted_at', { ascending:false }).limit(1).maybeSingle();
    existing = sub || null;
    bodyHtml = renderWorksheetForm(lesson, existing);
  }

  view.innerHTML = crumb+
    '<div class="page-head"><h1>'+esc(lesson.title)+'</h1>'+
    '<div style="color:var(--muted);font-size:13px">'+lesson.mins+' min &middot; '+esc(lesson.ltype)+'</div></div>'+
    bodyHtml;

  if(lesson.ltype==='worksheet'){
    bindWorksheetEvents(lesson, courseId, uid, existing);
  }
}

// ---------- assessment / quiz engine ----------
// Scoring happens server-side (submit_quiz RPC), the browser never sees
// correct_index until get_attempt_review decides it's safe to reveal.

let QUIZ_STATE = null;

function formatTime(totalSeconds){
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s/60);
  const sec = s%60;
  return (m<10?'0':'')+m+':'+(sec<10?'0':'')+sec;
}

async function renderQuiz(view, courseId, semesterId){
  const uid = CTX.session.user.id;
  const { data: semester, error: semErr } = await sb.from('semesters').select('id,name,pass_mark,duration_mins').eq('id', semesterId).single();
  if(semErr || !semester) throw semErr || new Error('Semester not found');

  const { data: existingAttempts } = await sb.from('assessment_attempts').select('passed').eq('semester_id', semesterId).eq('founder_id', uid);
  if((existingAttempts||[]).some(a=>a.passed)){
    view.innerHTML = '<div class="err">You have already passed this semester\'s assessment. Retakes are locked.</div>';
    return;
  }

  const { data: questions, error: qErr } = await sb.rpc('get_quiz_questions', { p_semester_id: semesterId });
  if(qErr) throw qErr;
  if(!questions || !questions.length){
    view.innerHTML = '<div class="err">No questions have been added for this assessment yet. Check back later.</div>';
    return;
  }

  const sorted = questions.slice().sort((a,b)=>a.order_index-b.order_index);
  QUIZ_STATE = { semesterId, courseId, questions: sorted, selections: {}, secondsLeft: semester.duration_mins*60, timer: null, submitting: false };

  const qsHtml = sorted.map((q, idx)=>
    '<div class="card" style="margin-bottom:14px"><div class="card-b">'+
      '<div class="quiz-q-title">Q'+(idx+1)+'. '+esc(q.question)+' <span class="pill pill-muted">'+q.marks+' mark'+(q.marks===1?'':'s')+'</span></div>'+
      (q.options||[]).map((opt, oi)=>
        '<label class="quiz-option-row"><input type="radio" class="quiz-option" name="'+q.id+'" value="'+oi+'"> '+esc(opt)+'</label>'
      ).join('')+
    '</div></div>'
  ).join('');

  view.innerHTML = '<div class="crumb"><a onclick="location.hash=\'#/course/'+courseId+'\'">Back to Course</a> / '+esc(semester.name)+' Assessment</div>'+
    '<div class="page-head-row"><div><h1>'+esc(semester.name)+' Assessment</h1>'+
    '<p style="color:var(--muted);font-size:13.5px">Pass mark '+semester.pass_mark+'% &middot; '+sorted.length+' question'+(sorted.length===1?'':'s')+'</p></div>'+
    '<div class="quiz-timer" id="quiz-timer">'+formatTime(QUIZ_STATE.secondsLeft)+'</div></div>'+
    '<form id="quiz-form">'+qsHtml+
      '<div class="wf-actions"><button type="submit" class="btn btn-gold" id="quiz-submit-btn">Submit Assessment</button></div>'+
    '</form>';

  document.getElementById('quiz-form').addEventListener('submit', (e)=>{ e.preventDefault(); finishQuiz(); });
  document.querySelectorAll('.quiz-option').forEach(inp=>{
    inp.addEventListener('change', (e)=>{ QUIZ_STATE.selections[e.target.name] = parseInt(e.target.value); });
  });

  QUIZ_STATE.timer = setInterval(()=>{
    QUIZ_STATE.secondsLeft--;
    const t = document.getElementById('quiz-timer');
    if(t) t.textContent = formatTime(QUIZ_STATE.secondsLeft);
    if(QUIZ_STATE.secondsLeft <= 0){
      clearInterval(QUIZ_STATE.timer);
      toast('Time is up. Submitting your answers.');
      finishQuiz();
    }
  }, 1000);
}

async function finishQuiz(){
  if(!QUIZ_STATE || QUIZ_STATE.submitting) return;
  QUIZ_STATE.submitting = true;
  if(QUIZ_STATE.timer) clearInterval(QUIZ_STATE.timer);
  const btn = document.getElementById('quiz-submit-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Submitting...'; }

  const answers = QUIZ_STATE.questions.map(q=>({
    question_id: q.id,
    selected_index: Object.prototype.hasOwnProperty.call(QUIZ_STATE.selections, q.id) ? QUIZ_STATE.selections[q.id] : null
  }));

  const { data: attempt, error } = await sb.rpc('submit_quiz', { p_semester_id: QUIZ_STATE.semesterId, p_answers: answers });
  if(error){
    toast('Could not submit: '+error.message, 'err');
    QUIZ_STATE.submitting = false;
    if(btn){ btn.disabled = false; btn.textContent = 'Submit Assessment'; }
    return;
  }
  const courseId = QUIZ_STATE.courseId, semesterId = QUIZ_STATE.semesterId;
  QUIZ_STATE = null;
  location.hash = '#/course/'+courseId+'/semester/'+semesterId+'/attempt/'+attempt.id;
}

async function renderAttemptReview(view, courseId, semesterId, attemptId){
  const { data: attempt, error: aErr } = await sb.from('assessment_attempts').select('*').eq('id', attemptId).single();
  if(aErr || !attempt) throw aErr || new Error('Attempt not found');

  const { data: rows, error: rErr } = await sb.rpc('get_attempt_review', { p_attempt_id: attemptId });
  if(rErr) throw rErr;

  const sorted = (rows||[]).slice().sort((a,b)=>a.order_index-b.order_index);
  const revealed = sorted.some(q=>q.correct_index != null);

  const qHtml = sorted.map((q, idx)=>{
    const optHtml = (q.options||[]).map((opt, oi)=>{
      let cls = '';
      if(oi===q.selected_index) cls = q.is_correct ? 'quiz-opt-correct' : 'quiz-opt-wrong';
      else if(revealed && oi===q.correct_index) cls = 'quiz-opt-correct';
      let tag = '';
      if(oi===q.selected_index) tag = ' (your answer)';
      else if(revealed && oi===q.correct_index) tag = ' (correct answer)';
      return '<div class="quiz-review-opt '+cls+'">'+esc(opt)+esc(tag)+'</div>';
    }).join('');
    const statusPill = q.selected_index==null
      ? '<span class="pill pill-muted">Not answered</span>'
      : (q.is_correct ? '<span class="pill pill-ok">Correct</span>' : '<span class="pill pill-warn">Incorrect</span>');
    return '<div class="card" style="margin-bottom:12px"><div class="card-b">'+
      '<div class="quiz-q-title">Q'+(idx+1)+'. '+esc(q.question)+' '+statusPill+'</div>'+
      optHtml+
    '</div></div>';
  }).join('');

  view.innerHTML = '<div class="crumb"><a onclick="location.hash=\'#/course/'+courseId+'\'">Back to Course</a> / Assessment Result</div>'+
    '<div class="page-head"><h1>Assessment Result</h1></div>'+
    '<div class="card" style="margin-bottom:20px"><div class="card-b">'+
      '<p style="font-size:22px;font-weight:700;color:var(--navy)">'+Math.round(attempt.percentage)+'% '+
        '<span class="pill '+(attempt.passed?'pill-ok':'pill-warn')+'" style="margin-left:8px">'+(attempt.passed?'Passed':'Failed')+'</span></p>'+
      '<p style="font-size:13px;color:var(--muted);margin-top:6px">Score '+attempt.score+' / '+attempt.max_score+' &middot; Attempt #'+attempt.attempt_number+' &middot; submitted '+new Date(attempt.submitted_at).toLocaleString()+'</p>'+
      (!attempt.passed ? '<p style="margin-top:12px"><button class="btn btn-gold btn-sm" onclick="location.hash=\'#/course/'+courseId+'/semester/'+semesterId+'/quiz\'">Retake Assessment</button></p>' : '')+
      (!revealed ? '<p style="font-size:12px;color:var(--muted);margin-top:10px">Correct answers are shown once you pass this assessment.</p>' : '')+
    '</div></div>'+
    qHtml;
}
