-- =====================================================================
-- Kerstquiz – 3 vragen: kerststol, eerste kerstkaart, Scrooge
--
-- Komen achteraan de vragenlijst. Mag vaker worden uitgevoerd. Haalt ook de
-- 17 andere vragen uit de eerdere versie van dit script weg, als die erin staan.
-- =====================================================================

delete from public.questions where id in (
  '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000107',
  '00000000-0000-4000-8000-000000000108', '00000000-0000-4000-8000-000000000109',
  '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000111',
  '00000000-0000-4000-8000-000000000113', '00000000-0000-4000-8000-000000000114',
  '00000000-0000-4000-8000-000000000115', '00000000-0000-4000-8000-000000000116',
  '00000000-0000-4000-8000-000000000117', '00000000-0000-4000-8000-000000000118',
  '00000000-0000-4000-8000-000000000120');

with nieuw (nr, id, category, kind, text, options, unit, time_limit) as (values
  (1, '00000000-0000-4000-8000-000000000105'::uuid, 'Eten & drinken', 'meerkeuze',
   'Wat stelt de kerststol volgens de traditie voor?',
   '["De kribbe","Het ingebakerde kindje Jezus","De ster van Bethlehem","Een besneeuwde heuvel"]'::jsonb, null, 20),
  (2, '00000000-0000-4000-8000-000000000112'::uuid, 'Schatting', 'schatting',
   'In welk jaar werd de allereerste kerstkaart verstuurd?',
   null, 'jaar', 30),
  (3, '00000000-0000-4000-8000-000000000119'::uuid, 'Kersttradities', 'open',
   'Welke schrijver bedacht Ebenezer Scrooge?',
   null, null, 30)
)
insert into public.questions (id, position, category, kind, text, options, unit, time_limit)
select id, (select coalesce(max(position), 0) from public.questions) + nr,
       category, kind, text, options, unit, time_limit
from nieuw
on conflict (id) do update set
  category = excluded.category, kind = excluded.kind, text = excluded.text,
  options = excluded.options, unit = excluded.unit, time_limit = excluded.time_limit;

insert into public.question_answers (question_id, correct_option, correct_texts, correct_value)
values
  ('00000000-0000-4000-8000-000000000105', 1, null, null),
  ('00000000-0000-4000-8000-000000000112', null, null, 1843),
  ('00000000-0000-4000-8000-000000000119', null, array['Charles Dickens', 'Dickens'], null)
on conflict (question_id) do update set
  correct_option = excluded.correct_option,
  correct_texts = excluded.correct_texts,
  correct_value = excluded.correct_value;

select position, kind, text from public.questions order by position;
