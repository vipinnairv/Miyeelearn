// MiyeeUpskill - admin console (Dashboard, Course Designer, Worksheets, Students, Settings)

let CTX = null;

async function boot(){
  CTX = await requireAuth('admin');
  if(!CTX) return;
  window.addEventListener('hashchange', route);
  if(!location.hash) location.hash = '#/dashboard';
  else route();
}

// ---------- router ----------

function parseHash(){
  const h = location.hash.replace(/^#\/?/, '');
  return h.split('/').filter(Boolean);
}

async function route(){
  const parts = parseHash();
  const tab = parts[0] || 'dashboard';
  const root = document.getElementById('root');
  root.innerHTML = topbarHTML(CTX.profile) + tabBarHTML(tab) +
    '<div class="app-shell" id="view"><div class="loading"><div class="spinner"></div>Loading...</div></div>' + devCreditHTML();
  const view = document.getElementById('view');
  try{
    if(tab==='dashboard') await renderDashboardTab(view);
    else if(tab==='designer'){
      if(parts[1]==='course' && parts[2]) await renderCourseDesigner(view, parts[2]);
      else await renderDesignerList(view);
    }
    else if(tab==='worksheets') await renderWorksheetsTab(view);
    else if(tab==='students') await renderStudentsTab(view);
    else if(tab==='settings') await renderSettingsTab(view);
    else view.innerHTML = '<div class="err">Unknown page.</div>';
  }catch(err){
    console.error(err);
    view.innerHTML = '<div class="err">Could not load this page. '+esc(err.message||'Unknown error')+'</div>';
  }
}

function tabBarHTML(active){
  const tabs = [
    ['dashboard','Dashboard'],
    ['designer','Course Designer'],
    ['worksheets','Worksheets'],
    ['students','Students'],
    ['settings','Settings']
  ];
  return '<div class="admin-tabs"><div class="admin-tabs-inner">'+
    tabs.map(([key,label])=> '<a class="admin-tab'+(active===key?' active':'')+'" onclick="location.hash=\'#/'+key+'\'">'+label+'</a>').join('')+
    '</div></div>';
}

// ---------- Dashboard tab ----------

async function renderDashboardTab(view){
  const [coursesRes, foundersRes, enrolRes, subsRes] = await Promise.all([
    sb.from('courses').select('id'),
    sb.from('profiles').select('id').eq('role','founder'),
    sb.from('enrolments').select('id'),
    sb.from('worksheet_submissions').select('id,reviewed')
  ]);
  const courses = coursesRes.data||[];
  const founders = foundersRes.data||[];
  const enrolments = enrolRes.data||[];
  const subs = subsRes.data||[];
  const pending = subs.filter(s=>!s.reviewed).length;

  view.innerHTML = '<div class="crumb">Home / Admin Console / Dashboard</div>'+
    '<div class="page-head"><h1>Dashboard</h1></div>'+
    '<div class="stat-row">'+
      '<div class="stat"><div class="n">'+founders.length+'</div><div class="l">Founders</div></div>'+
      '<div class="stat"><div class="n">'+courses.length+'</div><div class="l">Courses</div></div>'+
      '<div class="stat"><div class="n">'+enrolments.length+'</div><div class="l">Enrolments</div></div>'+
      '<div class="stat"><div class="n">'+pending+'</div><div class="l">Worksheets awaiting review</div></div>'+
    '</div>'+
    (pending>0
      ? '<div class="card"><div class="card-h">Needs attention<span class="pill pill-warn">'+pending+' pending</span></div>'+
        '<div class="card-b"><p style="font-size:13.5px">There '+(pending===1?'is':'are')+' '+pending+' worksheet submission'+(pending===1?'':'s')+' waiting for mentor review. '+
        '<a onclick="location.hash=\'#/worksheets\'">Go to Worksheets &rarr;</a></p></div></div>'
      : '<div class="card"><div class="card-b"><p style="color:var(--ok);font-weight:600">&#10003; Nothing pending review right now.</p></div></div>');
}

// ---------- Course Designer ----------

let CACHE = { course:null, semesters:{}, modules:{}, lessons:{} };
let FIELD_BUILDER_STATE = [];

async function renderDesignerList(view){
  const { data: courses, error } = await sb.from('courses').select('*').order('title');
  if(error) throw error;
  const cardsHtml = (courses||[]).map(c=>
    '<div class="course-card" onclick="location.hash=\'#/designer/course/'+c.id+'\'">'+
      '<div class="cc-top"><h3>'+esc(c.title)+'</h3></div>'+
      '<p class="cc-desc">'+esc(c.description||'')+'</p>'+
    '</div>'
  ).join('');
  view.innerHTML = '<div class="crumb">Home / Admin Console / Course Designer</div>'+
    '<div class="page-head"><h1>Course Designer</h1></div>'+
    '<div style="margin-bottom:16px"><button class="btn btn-gold" onclick="openCreateCourseModal()">+ New Course</button></div>'+
    '<div class="course-grid">'+(cardsHtml || '<p style="color:var(--muted)">No courses yet. Create one to get started.</p>')+'</div>';
}

function openCreateCourseModal(){
  openModal(
    '<h3>New Course</h3>'+
    '<form id="course-form">'+
      '<div class="field"><label>Title</label><input id="cf-title" required></div>'+
      '<div class="field"><label>Description</label><textarea id="cf-desc" rows="3"></textarea></div>'+
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn btn-gold">Create</button></div>'+
    '</form>'
  );
  document.getElementById('course-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const title = document.getElementById('cf-title').value.trim();
    const description = document.getElementById('cf-desc').value.trim();
    if(!title) return;
    const { data, error } = await sb.from('courses').insert({ org_id: CTX.profile.org_id, title, description }).select().single();
    if(error){ toast('Could not create course: '+error.message, 'err'); return; }
    closeModal();
    toast('Course created.');
    location.hash = '#/designer/course/'+data.id;
  });
}

function openEditCourseModal(){
  const c = CACHE.course;
  openModal(
    '<h3>Edit Course</h3>'+
    '<form id="course-form">'+
      '<div class="field"><label>Title</label><input id="cf-title" required value="'+esc(c.title)+'"></div>'+
      '<div class="field"><label>Description</label><textarea id="cf-desc" rows="3">'+esc(c.description||'')+'</textarea></div>'+
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn btn-gold">Save</button></div>'+
    '</form>'
  );
  document.getElementById('course-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const title = document.getElementById('cf-title').value.trim();
    const description = document.getElementById('cf-desc').value.trim();
    const { error } = await sb.from('courses').update({ title, description }).eq('id', c.id);
    if(error){ toast('Could not save: '+error.message, 'err'); return; }
    closeModal(); toast('Course updated.'); route();
  });
}

async function deleteCourse(){
  const c = CACHE.course;
  const semCount = Object.keys(CACHE.semesters).length;
  const modCount = Object.keys(CACHE.modules).length;
  const lessonCount = Object.keys(CACHE.lessons).length;
  if(!confirm('Delete course "'+c.title+'"? This also deletes '+semCount+' semester(s), '+modCount+' module(s) and '+lessonCount+' lesson(s), plus any assessment questions or worksheet submissions linked to it. This cannot be undone.')) return;
  const { error } = await sb.from('courses').delete().eq('id', c.id);
  if(error){ toast('Could not delete course: '+error.message, 'err'); return; }
  toast('Course deleted.'); location.hash = '#/designer';
}

async function renderCourseDesigner(view, courseId){
  const { data: course, error } = await sb.from('courses').select('*').eq('id', courseId).single();
  if(error || !course) throw error || new Error('Course not found');
  const semesters = await fetchCourseTree(courseId);

  CACHE = { course, semesters:{}, modules:{}, lessons:{}, questions:{}, questionsById:{} };
  semesters.forEach(s=>{
    CACHE.semesters[s.id] = s;
    s.modules.forEach(m=>{
      CACHE.modules[m.id] = m;
      m.lessons.forEach(l=>{ CACHE.lessons[l.id] = l; });
    });
  });

  const semesterIds = semesters.map(s=>s.id);
  if(semesterIds.length){
    const { data: questions } = await sb.from('assessment_questions').select('*').in('semester_id', semesterIds).order('order_index');
    (questions||[]).forEach(q=>{
      (CACHE.questions[q.semester_id] = CACHE.questions[q.semester_id] || []).push(q);
      CACHE.questionsById[q.id] = q;
    });
  }

  const semHtml = semesters.map(s=> renderSemesterBlock(s)).join('');

  view.innerHTML = '<div class="crumb"><a onclick="location.hash=\'#/designer\'">Course Designer</a> / '+esc(course.title)+'</div>'+
    '<div class="page-head-row">'+
      '<div><h1>'+esc(course.title)+'</h1><p style="color:var(--muted);font-size:14px;max-width:700px">'+esc(course.description||'')+'</p></div>'+
      '<div class="page-head-actions"><button class="btn btn-ghost btn-sm" onclick="openEditCourseModal()">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteCourse()">Delete Course</button></div>'+
    '</div>'+
    semHtml+
    '<button class="btn btn-ghost" onclick="openCreateSemesterModal(\''+courseId+'\')">+ Add Semester</button>';
}

function renderSemesterBlock(s){
  const modulesHtml = s.modules.map(m=> renderModuleBlock(m)).join('');
  return '<div class="tree-card">'+
    '<div class="tree-head">'+
      '<div><span class="tree-order">S'+(s.order_index+1)+'</span><b>'+esc(s.name)+'</b><span class="tree-meta">Pass mark '+s.pass_mark+'% &middot; '+s.duration_mins+' min</span></div>'+
      '<div class="tree-actions"><button class="btn btn-ghost btn-sm" onclick="openEditSemesterModal(\''+s.id+'\')">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteSemester(\''+s.id+'\')">Delete</button></div>'+
    '</div>'+
    '<div class="tree-body">'+modulesHtml+
      '<button class="btn btn-ghost btn-sm" onclick="openCreateModuleModal(\''+s.id+'\')">+ Add Module</button>'+
    '</div>'+
    renderQuestionsBlock(s)+
  '</div>';
}

function renderQuestionsBlock(s){
  const qs = CACHE.questions[s.id] || [];
  const rows = qs.map(q=> renderQuestionRow(q)).join('');
  return '<div class="tree-sub">'+
    '<div class="tree-head"><div><b>Assessment Questions</b><span class="tree-meta">'+qs.length+' question'+(qs.length===1?'':'s')+'</span></div></div>'+
    '<div class="tree-body">'+rows+
      '<button class="btn btn-ghost btn-sm" onclick="openCreateQuestionModal(\''+s.id+'\')">+ Add Question</button>'+
    '</div>'+
  '</div>';
}

function renderQuestionRow(q){
  return '<div class="lesson-row" style="cursor:default">'+
    '<span class="lesson-title">'+esc(q.question)+'</span>'+
    '<span class="pill pill-muted">'+q.marks+' mark'+(q.marks===1?'':'s')+(q.negative_marks>0?', -'+q.negative_marks+' neg':'')+'</span>'+
    '<span class="tree-actions"><button class="btn btn-ghost btn-sm" onclick="openEditQuestionModal(\''+q.id+'\')">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteQuestion(\''+q.id+'\')">Delete</button></span>'+
  '</div>';
}

// -- assessment question CRUD --

let QUESTION_OPTIONS_STATE = [];
let QUESTION_CORRECT_INDEX = 0;

function openCreateQuestionModal(semesterId){
  const count = (CACHE.questions[semesterId]||[]).length;
  openQuestionModal(null, semesterId, count);
}
function openEditQuestionModal(id){
  const q = CACHE.questionsById[id];
  openQuestionModal(q, q.semester_id, q.order_index);
}

function openQuestionModal(question, semesterId, orderIndex){
  const isEdit = !!question;
  QUESTION_OPTIONS_STATE = question ? question.options.slice() : ['', '', '', ''];
  QUESTION_CORRECT_INDEX = question ? question.correct_index : 0;

  openModal(
    '<h3>'+(isEdit?'Edit':'Add')+' Question</h3>'+
    '<form id="q-form">'+
      '<div class="field"><label>Question</label><textarea id="qf-question" rows="2" required>'+esc(question?question.question:'')+'</textarea></div>'+
      '<div class="field"><label>Options (select the correct one)</label><div id="q-options"></div>'+
        '<button type="button" class="btn btn-ghost btn-sm" onclick="addQuestionOption()">+ Add Option</button></div>'+
      '<div class="field row2">'+
        '<div><label>Marks (correct)</label><input id="qf-marks" type="number" min="0" step="0.5" value="'+(question?question.marks:1)+'"></div>'+
        '<div><label>Negative marks (wrong)</label><input id="qf-neg" type="number" min="0" step="0.5" value="'+(question?question.negative_marks:0)+'"></div>'+
      '</div>'+
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn btn-gold">'+(isEdit?'Save':'Add')+'</button></div>'+
    '</form>',
    { wide:true }
  );
  renderQuestionOptions();

  document.getElementById('q-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const questionText = document.getElementById('qf-question').value.trim();
    const marks = parseFloat(document.getElementById('qf-marks').value)||0;
    const negative_marks = parseFloat(document.getElementById('qf-neg').value)||0;
    const options = QUESTION_OPTIONS_STATE.map(o=>o.trim());
    if(!questionText || options.length<2 || options.some(o=>!o)){
      toast('Add a question and at least 2 non-empty options.', 'err');
      return;
    }
    const payload = { question: questionText, options, correct_index: QUESTION_CORRECT_INDEX, marks, negative_marks };
    let error;
    if(isEdit){
      ({ error } = await sb.from('assessment_questions').update(payload).eq('id', question.id));
    }else{
      ({ error } = await sb.from('assessment_questions').insert(Object.assign({ semester_id: semesterId, order_index: orderIndex }, payload)));
    }
    if(error){ toast('Could not save question: '+error.message, 'err'); return; }
    closeModal(); toast('Question saved.'); route();
  });
}

function renderQuestionOptions(){
  const box = document.getElementById('q-options');
  if(!box) return;
  box.innerHTML = QUESTION_OPTIONS_STATE.map((opt, idx)=>
    '<div class="q-option-row">'+
      '<input type="radio" name="q-correct" '+(QUESTION_CORRECT_INDEX===idx?'checked':'')+' onclick="QUESTION_CORRECT_INDEX='+idx+'">'+
      '<input type="text" class="q-opt-input" data-idx="'+idx+'" value="'+esc(opt)+'" placeholder="Option '+(idx+1)+'">'+
      (QUESTION_OPTIONS_STATE.length>2 ? '<button type="button" class="btn btn-danger btn-sm" onclick="removeQuestionOption('+idx+')">Remove</button>' : '')+
    '</div>'
  ).join('');
  box.querySelectorAll('.q-opt-input').forEach(inp=>{
    inp.addEventListener('input', (e)=>{ QUESTION_OPTIONS_STATE[+e.target.dataset.idx] = e.target.value; });
  });
}
function addQuestionOption(){
  QUESTION_OPTIONS_STATE.push('');
  renderQuestionOptions();
}
function removeQuestionOption(idx){
  QUESTION_OPTIONS_STATE.splice(idx,1);
  if(QUESTION_CORRECT_INDEX>=QUESTION_OPTIONS_STATE.length) QUESTION_CORRECT_INDEX = 0;
  else if(QUESTION_CORRECT_INDEX>idx) QUESTION_CORRECT_INDEX--;
  renderQuestionOptions();
}

async function deleteQuestion(id){
  const q = CACHE.questionsById[id];
  if(!confirm('Delete this question? This cannot be undone.\n\n"'+q.question+'"')) return;
  const { error } = await sb.from('assessment_questions').delete().eq('id', id);
  if(error){ toast('Could not delete: '+error.message, 'err'); return; }
  toast('Question deleted.'); route();
}

function renderModuleBlock(m){
  const lessonsHtml = m.lessons.map(l=> renderLessonRow(l)).join('');
  return '<div class="tree-sub">'+
    '<div class="tree-head">'+
      '<div><span class="tree-order">M'+(m.order_index+1)+'</span><b>'+esc(m.name)+'</b></div>'+
      '<div class="tree-actions"><button class="btn btn-ghost btn-sm" onclick="openEditModuleModal(\''+m.id+'\')">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteModule(\''+m.id+'\')">Delete</button></div>'+
    '</div>'+
    '<div class="tree-body">'+lessonsHtml+
      '<button class="btn btn-ghost btn-sm" onclick="openCreateLessonModal(\''+m.id+'\')">+ Add Lesson</button>'+
    '</div>'+
  '</div>';
}

function renderLessonRow(l){
  const icon = l.ltype==='video' ? '&#9654;' : (l.ltype==='reading' ? '&#128214;' : '&#128221;');
  return '<div class="lesson-row" style="cursor:default">'+
    '<span class="lesson-icon">'+icon+'</span>'+
    '<span class="lesson-title">'+esc(l.title)+'</span>'+
    '<span class="pill pill-muted">'+esc(l.ltype)+'</span>'+
    '<span class="lesson-mins">'+l.mins+' min</span>'+
    '<span class="tree-actions"><button class="btn btn-ghost btn-sm" onclick="openEditLessonModal(\''+l.id+'\')">Edit</button><button class="btn btn-danger btn-sm" onclick="deleteLesson(\''+l.id+'\')">Delete</button></span>'+
  '</div>';
}

// -- semester CRUD --

function openCreateSemesterModal(courseId){
  const count = Object.values(CACHE.semesters).filter(s=>s.course_id===courseId).length;
  openModal(
    '<h3>Add Semester</h3>'+
    '<form id="sem-form">'+
      '<div class="field"><label>Name</label><input id="sf-name" required placeholder="e.g. Semester 1: Idea Validation"></div>'+
      '<div class="field row2"><div><label>Pass mark (%)</label><input id="sf-pass" type="number" min="0" max="100" value="50"></div>'+
      '<div><label>Assessment duration (min)</label><input id="sf-dur" type="number" min="1" value="15"></div></div>'+
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn btn-gold">Add</button></div>'+
    '</form>'
  );
  document.getElementById('sem-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('sf-name').value.trim();
    if(!name) return;
    const pass_mark = parseInt(document.getElementById('sf-pass').value)||50;
    const duration_mins = parseInt(document.getElementById('sf-dur').value)||15;
    const { error } = await sb.from('semesters').insert({ course_id: courseId, name, order_index: count, pass_mark, duration_mins });
    if(error){ toast('Could not add semester: '+error.message, 'err'); return; }
    closeModal(); toast('Semester added.'); route();
  });
}

function openEditSemesterModal(id){
  const s = CACHE.semesters[id];
  openModal(
    '<h3>Edit Semester</h3>'+
    '<form id="sem-form">'+
      '<div class="field"><label>Name</label><input id="sf-name" required value="'+esc(s.name)+'"></div>'+
      '<div class="field row2"><div><label>Pass mark (%)</label><input id="sf-pass" type="number" min="0" max="100" value="'+s.pass_mark+'"></div>'+
      '<div><label>Assessment duration (min)</label><input id="sf-dur" type="number" min="1" value="'+s.duration_mins+'"></div></div>'+
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn btn-gold">Save</button></div>'+
    '</form>'
  );
  document.getElementById('sem-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('sf-name').value.trim();
    const pass_mark = parseInt(document.getElementById('sf-pass').value)||0;
    const duration_mins = parseInt(document.getElementById('sf-dur').value)||1;
    const { error } = await sb.from('semesters').update({ name, pass_mark, duration_mins }).eq('id', id);
    if(error){ toast('Could not save: '+error.message, 'err'); return; }
    closeModal(); toast('Semester updated.'); route();
  });
}

async function deleteSemester(id){
  const s = CACHE.semesters[id];
  const modCount = s.modules.length;
  const lessonCount = s.modules.reduce((n,m)=>n+m.lessons.length,0);
  if(!confirm('Delete "'+s.name+'"? This also deletes '+modCount+' module(s) and '+lessonCount+' lesson(s) inside it. This cannot be undone.')) return;
  const { error } = await sb.from('semesters').delete().eq('id', id);
  if(error){ toast('Could not delete: '+error.message, 'err'); return; }
  toast('Semester deleted.'); route();
}

// -- module CRUD --

function openCreateModuleModal(semesterId){
  const count = Object.values(CACHE.modules).filter(m=>m.semester_id===semesterId).length;
  openModal(
    '<h3>Add Module</h3>'+
    '<form id="mod-form">'+
      '<div class="field"><label>Name</label><input id="mf-name" required placeholder="e.g. Customer Discovery"></div>'+
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn btn-gold">Add</button></div>'+
    '</form>'
  );
  document.getElementById('mod-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('mf-name').value.trim();
    if(!name) return;
    const { error } = await sb.from('modules').insert({ semester_id: semesterId, name, order_index: count });
    if(error){ toast('Could not add module: '+error.message, 'err'); return; }
    closeModal(); toast('Module added.'); route();
  });
}

function openEditModuleModal(id){
  const m = CACHE.modules[id];
  openModal(
    '<h3>Edit Module</h3>'+
    '<form id="mod-form">'+
      '<div class="field"><label>Name</label><input id="mf-name" required value="'+esc(m.name)+'"></div>'+
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn btn-gold">Save</button></div>'+
    '</form>'
  );
  document.getElementById('mod-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('mf-name').value.trim();
    const { error } = await sb.from('modules').update({ name }).eq('id', id);
    if(error){ toast('Could not save: '+error.message, 'err'); return; }
    closeModal(); toast('Module updated.'); route();
  });
}

async function deleteModule(id){
  const m = CACHE.modules[id];
  const lessonCount = m.lessons.length;
  if(!confirm('Delete module "'+m.name+'"? This also deletes '+lessonCount+' lesson(s) inside it. This cannot be undone.')) return;
  const { error } = await sb.from('modules').delete().eq('id', id);
  if(error){ toast('Could not delete: '+error.message, 'err'); return; }
  toast('Module deleted.'); route();
}

// -- lesson CRUD (incl. field builder for worksheets) --

function openCreateLessonModal(moduleId){
  const count = Object.values(CACHE.lessons).filter(l=>l.module_id===moduleId).length;
  openLessonModal(null, moduleId, count);
}
function openEditLessonModal(id){
  const l = CACHE.lessons[id];
  openLessonModal(l, l.module_id, l.order_index);
}

function openLessonModal(lesson, moduleId, orderIndex){
  const isEdit = !!lesson;
  const ltype = lesson ? lesson.ltype : 'video';
  openModal(
    '<h3>'+(isEdit?'Edit':'Add')+' Lesson</h3>'+
    '<form id="lesson-form">'+
      '<div class="field"><label>Title</label><input id="lf-title" required value="'+esc(lesson?lesson.title:'')+'"></div>'+
      '<div class="field row2">'+
        '<div><label>Type</label><select id="lf-type">'+
          '<option value="video"'+(ltype==='video'?' selected':'')+'>Video</option>'+
          '<option value="reading"'+(ltype==='reading'?' selected':'')+'>Reading</option>'+
          '<option value="worksheet"'+(ltype==='worksheet'?' selected':'')+'>Worksheet</option>'+
        '</select></div>'+
        '<div><label>Duration (min)</label><input id="lf-mins" type="number" min="1" value="'+(lesson?lesson.mins:15)+'"></div>'+
      '</div>'+
      '<div id="lf-type-fields"></div>'+
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn btn-gold">'+(isEdit?'Save':'Add')+'</button></div>'+
    '</form>',
    { wide:true }
  );

  renderLessonTypeFields(lesson);
  document.getElementById('lf-type').addEventListener('change', ()=> renderLessonTypeFields(lesson));

  document.getElementById('lesson-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const title = document.getElementById('lf-title').value.trim();
    const ltypeVal = document.getElementById('lf-type').value;
    const mins = parseInt(document.getElementById('lf-mins').value)||1;
    if(!title) return;

    let video_url='', body='', fields=[];
    if(ltypeVal==='video'){
      video_url = document.getElementById('lf-video-url').value.trim();
      body = document.getElementById('lf-body').value.trim();
    }else if(ltypeVal==='reading'){
      body = document.getElementById('lf-body').value.trim();
    }else if(ltypeVal==='worksheet'){
      fields = collectFieldBuilder();
    }

    const payload = { title, ltype: ltypeVal, mins, video_url, body, fields };
    let error;
    if(isEdit){
      ({ error } = await sb.from('lessons').update(payload).eq('id', lesson.id));
    }else{
      ({ error } = await sb.from('lessons').insert(Object.assign({ module_id: moduleId, order_index: orderIndex }, payload)));
    }
    if(error){ toast('Could not save lesson: '+error.message, 'err'); return; }
    closeModal(); toast('Lesson saved.'); route();
  });
}

function renderLessonTypeFields(lesson){
  const ltype = document.getElementById('lf-type').value;
  const box = document.getElementById('lf-type-fields');
  if(ltype==='video'){
    box.innerHTML =
      '<div class="field"><label>Video URL (YouTube, Vimeo, or direct .mp4)</label><input id="lf-video-url" value="'+esc(lesson&&lesson.video_url||'')+'"></div>'+
      '<div class="field"><label>Notes (optional, shown below the video)</label><textarea id="lf-body" rows="3">'+esc(lesson&&lesson.body||'')+'</textarea></div>';
  }else if(ltype==='reading'){
    box.innerHTML = '<div class="field"><label>Body text</label><textarea id="lf-body" rows="8">'+esc(lesson&&lesson.body||'')+'</textarea></div>';
  }else if(ltype==='worksheet'){
    box.innerHTML = '<div class="field"><label>Worksheet Fields</label><p class="wf-hint" style="margin-bottom:8px">Reordering or removing fields can break computed fields that reference them by position. Review computed fields after reordering.</p>'+
      '<div id="field-builder"></div>'+
      '<button type="button" class="btn btn-ghost btn-sm" onclick="addFieldRow()">+ Add Field</button></div>';
    FIELD_BUILDER_STATE = (lesson && lesson.fields) ? JSON.parse(JSON.stringify(lesson.fields)) : [];
    renderFieldBuilder();
  }else{
    box.innerHTML = '';
  }
}

function renderFieldBuilder(){
  const box = document.getElementById('field-builder');
  if(!box) return;
  const numberFields = FIELD_BUILDER_STATE.map((f,i)=>({f,i})).filter(x=>x.f.ftype==='number');

  box.innerHTML = (FIELD_BUILDER_STATE.map((f, idx)=>{
    const ftype = f.ftype || 'longtext';
    let extra = '';
    if(ftype==='shorttext'){
      extra = '<div class="field"><label>Hint</label><input class="fb-hint" data-idx="'+idx+'" value="'+esc(f.hint||'')+'"></div>';
    }else if(ftype==='longtext'){
      extra = '<div class="field row2">'+
        '<div><label>Hint</label><input class="fb-hint" data-idx="'+idx+'" value="'+esc(f.hint||'')+'"></div>'+
        '<div><label>Rows</label><input class="fb-rows" type="number" min="1" data-idx="'+idx+'" value="'+(f.rows||3)+'"></div></div>';
    }else if(ftype==='number'){
      extra = '<div class="field row2">'+
        '<div><label>Hint</label><input class="fb-hint" data-idx="'+idx+'" value="'+esc(f.hint||'')+'"></div>'+
        '<div><label>Unit (optional)</label><input class="fb-unit" data-idx="'+idx+'" value="'+esc(f.unit||'')+'"></div></div>';
    }else if(ftype==='computed'){
      if(numberFields.length < 2){
        extra = '<p class="err" style="margin:8px 0">Add at least two Number fields above before configuring a computed field.</p>';
      }else{
        extra = '<div class="field row2">'+
          '<div><label>Formula</label><select class="fb-formula" data-idx="'+idx+'">'+
            ['wow','diff','sum','ratio'].map(fm=>'<option value="'+fm+'"'+(f.formula===fm?' selected':'')+'>'+fm+'</option>').join('')+
          '</select></div>'+
          '<div><label>Unit (optional)</label><input class="fb-unit" data-idx="'+idx+'" value="'+esc(f.unit||'')+'"></div></div>'+
        '<div class="field row2">'+
          '<div><label>From field (A)</label><select class="fb-refa" data-idx="'+idx+'">'+
            numberFields.map(x=>'<option value="'+x.i+'"'+(String(f.refA)===String(x.i)?' selected':'')+'>'+esc(x.f.label||'(untitled)')+'</option>').join('')+
          '</select></div>'+
          '<div><label>To field (B)</label><select class="fb-refb" data-idx="'+idx+'">'+
            numberFields.map(x=>'<option value="'+x.i+'"'+(String(f.refB)===String(x.i)?' selected':'')+'>'+esc(x.f.label||'(untitled)')+'</option>').join('')+
          '</select></div></div>';
      }
    }
    return '<div class="fb-row">'+
      '<div class="fb-row-top">'+
        '<input class="fb-label" data-idx="'+idx+'" placeholder="Field label" value="'+esc(f.label||'')+'">'+
        '<select class="fb-ftype" data-idx="'+idx+'">'+
          '<option value="shorttext"'+(ftype==='shorttext'?' selected':'')+'>Short text</option>'+
          '<option value="longtext"'+(ftype==='longtext'?' selected':'')+'>Long text</option>'+
          '<option value="number"'+(ftype==='number'?' selected':'')+'>Number</option>'+
          '<option value="computed"'+(ftype==='computed'?' selected':'')+'>Computed</option>'+
        '</select>'+
        '<div class="fb-row-actions">'+
          '<button type="button" class="btn btn-ghost btn-sm" onclick="moveFieldRow('+idx+',-1)"'+(idx===0?' disabled':'')+'>&uarr;</button>'+
          '<button type="button" class="btn btn-ghost btn-sm" onclick="moveFieldRow('+idx+',1)"'+(idx===FIELD_BUILDER_STATE.length-1?' disabled':'')+'>&darr;</button>'+
          '<button type="button" class="btn btn-danger btn-sm" onclick="removeFieldRow('+idx+')">Remove</button>'+
        '</div>'+
      '</div>'+
      extra+
    '</div>';
  }).join('')) || '<p style="color:var(--muted);font-size:13px">No fields yet. Add one below.</p>';

  box.querySelectorAll('.fb-label,.fb-hint,.fb-rows,.fb-unit,.fb-formula,.fb-refa,.fb-refb').forEach(el=>{
    el.addEventListener('input', syncFieldRow);
    el.addEventListener('change', syncFieldRow);
  });
  box.querySelectorAll('.fb-ftype').forEach(el=>{
    el.addEventListener('change', (e)=>{
      const idx = +e.target.dataset.idx;
      FIELD_BUILDER_STATE[idx].ftype = e.target.value;
      renderFieldBuilder();
    });
  });
}

function syncFieldRow(e){
  const idx = +e.target.dataset.idx;
  const f = FIELD_BUILDER_STATE[idx];
  if(!f) return;
  if(e.target.classList.contains('fb-label')) f.label = e.target.value;
  else if(e.target.classList.contains('fb-hint')) f.hint = e.target.value;
  else if(e.target.classList.contains('fb-rows')) f.rows = parseInt(e.target.value)||3;
  else if(e.target.classList.contains('fb-unit')) f.unit = e.target.value;
  else if(e.target.classList.contains('fb-formula')) f.formula = e.target.value;
  else if(e.target.classList.contains('fb-refa')) f.refA = parseInt(e.target.value);
  else if(e.target.classList.contains('fb-refb')) f.refB = parseInt(e.target.value);
}

function addFieldRow(){
  FIELD_BUILDER_STATE.push({ label:'', ftype:'longtext', hint:'', rows:3 });
  renderFieldBuilder();
}
function removeFieldRow(idx){
  FIELD_BUILDER_STATE.splice(idx,1);
  renderFieldBuilder();
}
function moveFieldRow(idx, dir){
  const j = idx+dir;
  if(j<0 || j>=FIELD_BUILDER_STATE.length) return;
  const tmp = FIELD_BUILDER_STATE[idx];
  FIELD_BUILDER_STATE[idx] = FIELD_BUILDER_STATE[j];
  FIELD_BUILDER_STATE[j] = tmp;
  renderFieldBuilder();
}
function collectFieldBuilder(){
  return FIELD_BUILDER_STATE.map(f=>{
    const ftype = f.ftype || 'longtext';
    if(ftype==='computed') return { label:f.label||'', ftype, formula:f.formula||'wow', refA:f.refA, refB:f.refB, unit:f.unit||'' };
    if(ftype==='number') return { label:f.label||'', ftype, hint:f.hint||'', unit:f.unit||'' };
    if(ftype==='shorttext') return { label:f.label||'', ftype, hint:f.hint||'' };
    return { label:f.label||'', ftype:'longtext', hint:f.hint||'', rows:f.rows||3 };
  });
}

async function deleteLesson(id){
  const l = CACHE.lessons[id];
  if(!confirm('Delete lesson "'+l.title+'"? This cannot be undone.')) return;
  const { error } = await sb.from('lessons').delete().eq('id', id);
  if(error){ toast('Could not delete: '+error.message, 'err'); return; }
  toast('Lesson deleted.'); route();
}

// ---------- Worksheets tab ----------

async function fetchAllWorksheetLessons(){
  const { data, error } = await sb.from('courses')
    .select('id,title,semesters(id,name,order_index,modules(id,name,order_index,lessons(id,title,ltype,fields,order_index)))');
  if(error) throw error;
  const out = [];
  (data||[]).forEach(c=>{
    (c.semesters||[]).slice().sort((a,b)=>a.order_index-b.order_index).forEach(s=>{
      (s.modules||[]).slice().sort((a,b)=>a.order_index-b.order_index).forEach(m=>{
        (m.lessons||[]).filter(l=>l.ltype==='worksheet').slice().sort((a,b)=>a.order_index-b.order_index).forEach(l=>{
          out.push({ course_id:c.id, course_title:c.title, semester_name:s.name, module_name:m.name, lesson_id:l.id, lesson_title:l.title, fields:l.fields||[] });
        });
      });
    });
  });
  return out;
}

async function renderWorksheetsTab(view){
  const [worksheetLessons, enrolRes, subsRes, profRes] = await Promise.all([
    fetchAllWorksheetLessons(),
    sb.from('enrolments').select('course_id, founder_id'),
    sb.from('worksheet_submissions').select('*'),
    sb.from('profiles').select('id,full_name').eq('role','founder')
  ]);
  const enrolments = enrolRes.data || [];
  const subs = subsRes.data || [];
  const profilesById = {};
  (profRes.data||[]).forEach(p=>{ profilesById[p.id] = p; });

  const subsByKey = {};
  subs.forEach(s=>{ subsByKey[s.course_id+'|'+s.founder_id+'|'+s.worksheet_key] = s; });

  const rows = [];
  enrolments.forEach(en=>{
    const prof = profilesById[en.founder_id];
    if(!prof) return;
    worksheetLessons.filter(wl=>wl.course_id===en.course_id).forEach(wl=>{
      const key = en.course_id+'|'+en.founder_id+'|'+wl.lesson_id;
      const sub = subsByKey[key];
      const status = sub ? (sub.reviewed ? 'reviewed' : 'submitted') : 'not_submitted';
      rows.push({
        rowId: key, founder_name: prof.full_name, course_title: wl.course_title,
        semester_name: wl.semester_name, lesson_title: wl.lesson_title, fields: wl.fields,
        status, submitted_at: sub ? sub.submitted_at : null, sub
      });
    });
  });

  window.__WS_ROWS = rows;

  view.innerHTML = '<div class="crumb">Home / Admin Console / Worksheets</div>'+
    '<div class="page-head"><h1>Worksheet Review Queue</h1></div>'+
    '<div class="ws-filters">'+
      '<button class="btn btn-ghost btn-sm ws-filter-btn active" data-status="all" onclick="filterWorksheets(\'all\')">All ('+rows.length+')</button>'+
      '<button class="btn btn-ghost btn-sm ws-filter-btn" data-status="not_submitted" onclick="filterWorksheets(\'not_submitted\')">Not submitted ('+rows.filter(r=>r.status==='not_submitted').length+')</button>'+
      '<button class="btn btn-ghost btn-sm ws-filter-btn" data-status="submitted" onclick="filterWorksheets(\'submitted\')">Submitted ('+rows.filter(r=>r.status==='submitted').length+')</button>'+
      '<button class="btn btn-ghost btn-sm ws-filter-btn" data-status="reviewed" onclick="filterWorksheets(\'reviewed\')">Reviewed ('+rows.filter(r=>r.status==='reviewed').length+')</button>'+
    '</div>'+
    '<div id="ws-table-wrap"></div>';
  renderWorksheetTable('all');
}

function filterWorksheets(status){
  document.querySelectorAll('.ws-filter-btn').forEach(b=> b.classList.toggle('active', b.dataset.status===status));
  renderWorksheetTable(status);
}

function renderWorksheetTable(status){
  const rows = (window.__WS_ROWS||[]).filter(r=> status==='all' || r.status===status);
  const box = document.getElementById('ws-table-wrap');
  if(!rows.length){ box.innerHTML = '<div class="card"><div class="card-b"><p style="color:var(--muted)">No worksheets in this filter.</p></div></div>'; return; }
  box.innerHTML = '<div class="card"><div style="overflow-x:auto"><table class="admin-table">'+
    '<thead><tr><th>Founder</th><th>Course</th><th>Semester</th><th>Worksheet</th><th>Status</th><th>Submitted</th><th></th></tr></thead>'+
    '<tbody>'+rows.map(r=>
      '<tr><td>'+esc(r.founder_name)+'</td><td>'+esc(r.course_title)+'</td><td>'+esc(r.semester_name)+'</td><td>'+esc(r.lesson_title)+'</td>'+
      '<td>'+statusPill(r.status)+'</td><td>'+(r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : '&mdash;')+'</td>'+
      '<td>'+(r.status==='not_submitted' ? '' : '<button class="btn btn-ghost btn-sm" onclick="openReviewModal(\''+r.rowId+'\')">Review</button>')+'</td></tr>'
    ).join('')+
    '</tbody></table></div></div>';
}

function statusPill(status){
  if(status==='reviewed') return '<span class="pill pill-ok">Reviewed</span>';
  if(status==='submitted') return '<span class="pill pill-warn">Submitted</span>';
  return '<span class="pill pill-muted">Not submitted</span>';
}

function openReviewModal(rowId){
  const row = (window.__WS_ROWS||[]).find(r=>r.rowId===rowId);
  if(!row || !row.sub) return;
  const sub = row.sub;
  const answers = sub.answers || {};
  const fields = row.fields || [];
  const answersHtml = fields.length
    ? fields.map((f,idx)=> '<div class="review-answer"><div class="ra-label">'+esc(f.label)+'</div><div class="ra-value">'+esc(answers[idx]!=null && answers[idx]!=='' ? answers[idx] : '(blank)')+'</div></div>').join('')
    : '<p style="color:var(--muted)">No field definitions found for this worksheet.</p>';

  openModal(
    '<h3>'+esc(row.founder_name)+' &middot; '+esc(row.lesson_title)+'</h3>'+
    '<p style="color:var(--muted);font-size:12.5px;margin-bottom:14px">'+esc(row.course_title)+' / '+esc(row.semester_name)+(sub.submitted_at ? ' &middot; submitted '+new Date(sub.submitted_at).toLocaleString() : '')+'</p>'+
    '<div class="review-answers">'+answersHtml+'</div>'+
    '<div class="field"><label>Mentor feedback</label><textarea id="rv-feedback" rows="4">'+esc(sub.mentor_feedback||'')+'</textarea></div>'+
    '<label class="rv-reviewed-check"><input type="checkbox" id="rv-reviewed"'+(sub.reviewed?' checked':'')+'> Mark as reviewed</label>'+
    '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button type="button" class="btn btn-gold" onclick="saveReview(\''+sub.id+'\')">Save</button></div>',
    { wide:true }
  );
}

async function saveReview(subId){
  const mentor_feedback = document.getElementById('rv-feedback').value.trim();
  const reviewed = document.getElementById('rv-reviewed').checked;
  const { error } = await sb.from('worksheet_submissions').update({ mentor_feedback, reviewed }).eq('id', subId);
  if(error){ toast('Could not save review: '+error.message, 'err'); return; }
  closeModal(); toast('Review saved.'); route();
}

// ---------- Students tab ----------

let STUD_CACHE = { founders:[], courses:[], enrolments:[] };

async function renderStudentsTab(view){
  const [foundersRes, coursesRes, enrolRes] = await Promise.all([
    sb.from('profiles').select('*').eq('role','founder').order('full_name'),
    sb.from('courses').select('id,title').order('title'),
    sb.from('enrolments').select('id,course_id,founder_id')
  ]);
  const founders = foundersRes.data || [];
  const courses = coursesRes.data || [];
  const enrolments = enrolRes.data || [];
  STUD_CACHE = { founders, courses, enrolments };

  const rowsHtml = founders.map(f=>{
    const myEnrol = enrolments.filter(e=>e.founder_id===f.id);
    const courseNames = myEnrol.map(e=> (courses.find(c=>c.id===e.course_id)||{}).title).filter(Boolean);
    return '<tr><td>'+esc(f.full_name)+'</td>'+
      '<td>'+(courseNames.length ? courseNames.map(esc).join(', ') : '<span style="color:var(--muted)">Not enrolled</span>')+'</td>'+
      '<td><button class="btn btn-ghost btn-sm" onclick="openManageEnrolModal(\''+f.id+'\')">Manage Enrolments</button></td></tr>';
  }).join('');

  view.innerHTML = '<div class="crumb">Home / Admin Console / Students</div>'+
    '<div class="page-head-row"><div><h1>Students</h1></div>'+
    '<div class="page-head-actions"><button class="btn btn-gold btn-sm" onclick="openCreateAccountModal()">+ New Account</button></div></div>'+
    '<p style="color:var(--muted);font-size:12.5px;margin:-12px 0 16px">Only founder accounts are listed below. A newly created mentor account can sign in right away but won\'t appear in this table.</p>'+
    '<div class="card"><div style="overflow-x:auto"><table class="admin-table">'+
      '<thead><tr><th>Name</th><th>Enrolled Courses</th><th></th></tr></thead>'+
      '<tbody>'+(rowsHtml || '<tr><td colspan="3" style="color:var(--muted);padding:16px">No founders in this organization yet.</td></tr>')+'</tbody>'+
    '</table></div></div>';
}

// ---------- account creation (founder / mentor logins) ----------

function generatePassword(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for(let i=0;i<10;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

async function createAccountViaFunction(payload){
  const resp = await fetch(SUPABASE_URL + '/functions/v1/create-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CTX.session.access_token,
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify(payload)
  });
  const data = await resp.json().catch(()=>({}));
  if(!resp.ok) throw new Error(data.error || ('Request failed ('+resp.status+')'));
  return data;
}

function openCreateAccountModal(){
  openModal(
    '<h3>New Account</h3>'+
    '<form id="acct-form">'+
      '<div class="field"><label>Full name</label><input id="af-name" required></div>'+
      '<div class="field"><label>Email</label><input id="af-email" type="email" required></div>'+
      '<div class="field row2">'+
        '<div><label>Role</label><select id="af-role"><option value="founder">Founder</option><option value="mentor">Mentor</option></select></div>'+
        '<div><label>Password</label><div style="display:flex;gap:6px">'+
          '<input id="af-password" type="text" required minlength="6" placeholder="Min 6 characters" style="flex:1">'+
          '<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById(\'af-password\').value=generatePassword()">Generate</button>'+
        '</div></div>'+
      '</div>'+
      '<p style="font-size:12px;color:var(--muted);margin-top:-6px">They sign in with this email and password. It is not emailed automatically, you share it with them directly.</p>'+
      '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn btn-gold" id="af-submit">Create Account</button></div>'+
    '</form>'
  );
  document.getElementById('acct-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = document.getElementById('af-submit');
    const full_name = document.getElementById('af-name').value.trim();
    const email = document.getElementById('af-email').value.trim();
    const role = document.getElementById('af-role').value;
    const password = document.getElementById('af-password').value;
    if(!full_name || !email || password.length < 6) return;
    btn.disabled = true; btn.textContent = 'Creating...';
    try{
      await createAccountViaFunction({ full_name, email, role, password });
      showAccountCreatedModal(full_name, email, role, password);
    }catch(err){
      toast('Could not create account: '+err.message, 'err');
      btn.disabled = false; btn.textContent = 'Create Account';
    }
  });
}

function showAccountCreatedModal(name, email, role, password){
  openModal(
    '<h3>Account Created</h3>'+
    '<p style="font-size:13.5px;margin-bottom:14px">Share these sign-in details with '+esc(name)+'. This password will not be shown again.</p>'+
    '<div class="card" style="margin-bottom:6px"><div class="card-b">'+
      '<p style="font-size:13px"><b>Role:</b> '+esc(role)+'</p>'+
      '<p style="font-size:13px"><b>Email:</b> <code>'+esc(email)+'</code></p>'+
      '<p style="font-size:13px"><b>Password:</b> <code>'+esc(password)+'</code></p>'+
    '</div></div>'+
    '<div class="modal-actions"><button type="button" class="btn btn-gold" onclick="closeModal(); route();">Done</button></div>'
  );
}

function openManageEnrolModal(founderId){
  const founder = STUD_CACHE.founders.find(f=>f.id===founderId);
  const myEnrolIds = new Set(STUD_CACHE.enrolments.filter(e=>e.founder_id===founderId).map(e=>e.course_id));
  const rowsHtml = STUD_CACHE.courses.map(c=>
    '<label class="enrol-row"><input type="checkbox" class="enrol-check" data-course="'+c.id+'"'+(myEnrolIds.has(c.id)?' checked':'')+'> '+esc(c.title)+'</label>'
  ).join('');
  openModal(
    '<h3>Manage Enrolments &middot; '+esc(founder.full_name)+'</h3>'+
    '<div class="enrol-list">'+(rowsHtml || '<p style="color:var(--muted)">No courses exist yet.</p>')+'</div>'+
    '<div class="modal-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Close</button><button type="button" class="btn btn-gold" onclick="saveEnrolments(\''+founderId+'\')">Save</button></div>'
  );
}

async function saveEnrolments(founderId){
  const checks = document.querySelectorAll('.enrol-check');
  const desired = new Set([...checks].filter(c=>c.checked).map(c=>c.dataset.course));
  const current = new Set(STUD_CACHE.enrolments.filter(e=>e.founder_id===founderId).map(e=>e.course_id));

  const toAdd = [...desired].filter(id=>!current.has(id));
  const toRemove = [...current].filter(id=>!desired.has(id));

  if(toAdd.length){
    const { error } = await sb.from('enrolments').insert(toAdd.map(course_id=>({ course_id, founder_id: founderId })));
    if(error){ toast('Could not add enrolment: '+error.message, 'err'); return; }
  }
  if(toRemove.length){
    const idsToDelete = STUD_CACHE.enrolments.filter(e=>e.founder_id===founderId && toRemove.includes(e.course_id)).map(e=>e.id);
    const { error } = await sb.from('enrolments').delete().in('id', idsToDelete);
    if(error){ toast('Could not remove enrolment: '+error.message, 'err'); return; }
  }
  closeModal(); toast('Enrolments updated.'); route();
}

// ---------- Settings tab ----------

async function renderSettingsTab(view){
  view.innerHTML = '<div class="crumb">Home / Admin Console / Settings</div>'+
    '<div class="page-head"><h1>Settings</h1></div>'+
    '<div class="card"><div class="card-b">'+
      '<p style="font-size:13.5px;color:var(--muted)">Organization ID: <code>'+esc(CTX.profile.org_id)+'</code></p>'+
      '<p style="font-size:13.5px;color:var(--muted);margin-top:8px">Signed in as <b>'+esc(CTX.session.user.email)+'</b> ('+esc(CTX.profile.role)+')</p>'+
      '<p style="font-size:13px;color:var(--muted);margin-top:16px">More settings, including creating founder logins, org branding, and notification preferences, will be added here in a later step.</p>'+
    '</div></div>';
}
