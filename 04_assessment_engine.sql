-- MiyeeUpskill: assessment/quiz engine
-- Run this in Supabase SQL Editor after 02_course_content_schema.sql and
-- 03_startup_course_data.sql. Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
--
-- Design notes (see conversation for full reasoning):
-- - Scoring happens server-side in submit_quiz(), never in the browser, so
--   the answer key is never shipped to a founder before they've attempted.
-- - assessment_attempts only grants SELECT to authenticated. All writes go
--   through submit_quiz(), which runs as the function owner and so bypasses
--   RLS/grants deliberately, unlike every other table in this schema. A
--   direct INSERT grant here would let a founder self-declare a pass.
-- - Correct answers are only revealed in get_attempt_review() once the
--   semester has been passed by some attempt (retakes are then permanently
--   blocked anyway), otherwise only right/wrong per question is shown.
-- - Retakes are only allowed after a failed attempt; once passed, locked.

create table if not exists assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid references semesters(id) on delete cascade not null,
  course_id uuid references courses(id) on delete cascade not null,
  founder_id uuid references auth.users(id) on delete cascade not null,
  attempt_number int not null default 1,
  score numeric not null,
  max_score numeric not null,
  percentage numeric not null,
  passed boolean not null,
  answers jsonb not null default '[]'::jsonb,  -- [{question_id, selected_index, is_correct, marks_awarded}] - no correct_index stored here, see get_attempt_review()
  started_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  created_at timestamptz default now()
);

alter table assessment_attempts enable row level security;

-- Deliberately SELECT-only. Inserts happen only via submit_quiz() below.
grant select on assessment_attempts to authenticated;

create policy "founders view own attempts" on assessment_attempts for select
  using (founder_id = auth.uid());

create policy "admins view org attempts" on assessment_attempts for select
  using (
    my_role() in ('admin','mentor')
    and exists (select 1 from semesters s join courses c on c.id = s.course_id where s.id = assessment_attempts.semester_id and c.org_id = my_org())
  );

create index if not exists assessment_attempts_founder_semester_idx on assessment_attempts(founder_id, semester_id);

-- Tighten assessment_questions visibility now that founders fetch quiz
-- questions via get_quiz_questions() instead of querying the table
-- directly. The original "org members view questions" policy (from
-- 02_course_content_schema.sql) let any org member, including founders,
-- select correct_index straight out of the table. Replacing it with an
-- admin/mentor-only policy closes that path.
drop policy if exists "org members view questions" on assessment_questions;
create policy "admins view questions" on assessment_questions for select
  using (
    my_role() in ('admin','mentor')
    and exists (select 1 from semesters s join courses c on c.id = s.course_id where s.id = assessment_questions.semester_id and c.org_id = my_org())
  );
-- "admins manage questions" (insert/update/delete, admin-only) from
-- 02_course_content_schema.sql is untouched and still applies.

-- ---------------------------------------------------------------------
-- get_quiz_questions(semester_id): what a founder fetches to render the
-- quiz. Excludes correct_index. Blocks access if the previous semester
-- (by order_index) hasn't been passed yet, enforcing gating server-side
-- too, not just in the UI.
-- ---------------------------------------------------------------------
create or replace function get_quiz_questions(p_semester_id uuid)
returns table (
  id uuid,
  question text,
  options jsonb,
  marks numeric,
  negative_marks numeric,
  order_index int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_index int;
  v_course_id uuid;
  v_prev_passed boolean;
begin
  select s.order_index, s.course_id into v_order_index, v_course_id
  from semesters s join courses c on c.id = s.course_id
  where s.id = p_semester_id and c.org_id = my_org();

  if v_course_id is null then
    raise exception 'Not authorized for this semester';
  end if;

  if v_order_index > 0 then
    select exists(
      select 1 from assessment_attempts a
      join semesters s2 on s2.id = a.semester_id
      where s2.course_id = v_course_id and s2.order_index = v_order_index - 1
        and a.founder_id = auth.uid() and a.passed = true
    ) into v_prev_passed;
    if not v_prev_passed then
      raise exception 'The previous semester must be passed first';
    end if;
  end if;

  return query
    select q.id, q.question, q.options, q.marks, q.negative_marks, q.order_index
    from assessment_questions q
    where q.semester_id = p_semester_id
    order by q.order_index;
end;
$$;

grant execute on function get_quiz_questions(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- submit_quiz(semester_id, answers): scores server-side and inserts the
-- attempt. answers is a jsonb array of {question_id, selected_index}
-- (selected_index null/omitted if the founder left it unanswered).
-- ---------------------------------------------------------------------
create or replace function submit_quiz(p_semester_id uuid, p_answers jsonb)
returns assessment_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_order_index int;
  v_pass_mark int;
  v_prev_passed boolean;
  v_score numeric := 0;
  v_max_score numeric := 0;
  v_percentage numeric;
  v_passed boolean;
  v_attempt_number int;
  v_answers jsonb := '[]'::jsonb;
  v_q record;
  v_selected int;
  v_is_correct boolean;
  v_marks_awarded numeric;
  v_row assessment_attempts%rowtype;
begin
  select s.course_id, s.order_index, s.pass_mark into v_course_id, v_order_index, v_pass_mark
  from semesters s join courses c on c.id = s.course_id
  where s.id = p_semester_id and c.org_id = my_org();

  if v_course_id is null then
    raise exception 'Semester not found or not accessible';
  end if;

  if v_order_index > 0 then
    select exists(
      select 1 from assessment_attempts a
      join semesters s2 on s2.id = a.semester_id
      where s2.course_id = v_course_id and s2.order_index = v_order_index - 1
        and a.founder_id = auth.uid() and a.passed = true
    ) into v_prev_passed;
    if not v_prev_passed then
      raise exception 'The previous semester must be passed first';
    end if;
  end if;

  if exists (
    select 1 from assessment_attempts
    where founder_id = auth.uid() and semester_id = p_semester_id and passed = true
  ) then
    raise exception 'This semester has already been passed, retakes are locked';
  end if;

  for v_q in
    select id, correct_index, marks, negative_marks
    from assessment_questions
    where semester_id = p_semester_id
  loop
    v_max_score := v_max_score + v_q.marks;

    select (elem->>'selected_index')::int into v_selected
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) elem
    where (elem->>'question_id')::uuid = v_q.id
    limit 1;

    if v_selected is null then
      v_is_correct := null;
      v_marks_awarded := 0;
    elsif v_selected = v_q.correct_index then
      v_is_correct := true;
      v_marks_awarded := v_q.marks;
    else
      v_is_correct := false;
      v_marks_awarded := -v_q.negative_marks;
    end if;

    v_score := v_score + v_marks_awarded;

    v_answers := v_answers || jsonb_build_object(
      'question_id', v_q.id,
      'selected_index', v_selected,
      'is_correct', v_is_correct,
      'marks_awarded', v_marks_awarded
    );
  end loop;

  v_percentage := case when v_max_score > 0 then (v_score / v_max_score * 100) else 0 end;
  v_passed := v_percentage >= v_pass_mark;

  select coalesce(max(attempt_number), 0) + 1 into v_attempt_number
  from assessment_attempts
  where founder_id = auth.uid() and semester_id = p_semester_id;

  insert into assessment_attempts (
    semester_id, course_id, founder_id, attempt_number,
    score, max_score, percentage, passed, answers, submitted_at
  ) values (
    p_semester_id, v_course_id, auth.uid(), v_attempt_number,
    v_score, v_max_score, v_percentage, v_passed, v_answers, now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function submit_quiz(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- get_attempt_review(attempt_id): per-question review for a single
-- attempt. correct_index is only populated (non-null) if the caller is
-- an admin/mentor, or this attempt passed, or the founder has since
-- passed the semester via a later attempt. Otherwise only is_correct
-- (right/wrong) is shown, never the answer itself.
-- ---------------------------------------------------------------------
create or replace function get_attempt_review(p_attempt_id uuid)
returns table (
  question_id uuid,
  question text,
  options jsonb,
  marks numeric,
  negative_marks numeric,
  order_index int,
  selected_index int,
  is_correct boolean,
  marks_awarded numeric,
  correct_index int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt assessment_attempts%rowtype;
  v_caller_role text;
  v_reveal boolean;
begin
  select * into v_attempt from assessment_attempts where id = p_attempt_id;
  if not found then
    raise exception 'Attempt not found';
  end if;

  v_caller_role := my_role();

  if v_attempt.founder_id <> auth.uid()
     and not (
       v_caller_role in ('admin','mentor')
       and exists (
         select 1 from semesters s join courses c on c.id = s.course_id
         where s.id = v_attempt.semester_id and c.org_id = my_org()
       )
     )
  then
    raise exception 'Not authorized to view this attempt';
  end if;

  v_reveal := (v_caller_role in ('admin','mentor'))
    or v_attempt.passed
    or exists (
      select 1 from assessment_attempts a2
      where a2.founder_id = v_attempt.founder_id and a2.semester_id = v_attempt.semester_id and a2.passed = true
    );

  return query
    select
      q.id,
      q.question,
      q.options,
      q.marks,
      q.negative_marks,
      q.order_index,
      (ans->>'selected_index')::int,
      (ans->>'is_correct')::boolean,
      (ans->>'marks_awarded')::numeric,
      case when v_reveal then q.correct_index else null end
    from assessment_questions q
    left join lateral (
      select elem as ans
      from jsonb_array_elements(v_attempt.answers) elem
      where (elem->>'question_id')::uuid = q.id
      limit 1
    ) a on true
    where q.semester_id = v_attempt.semester_id
    order by q.order_index;
end;
$$;

grant execute on function get_attempt_review(uuid) to authenticated;
