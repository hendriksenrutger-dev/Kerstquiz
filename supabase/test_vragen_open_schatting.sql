-- =====================================================================
-- Kerstquiz – testvragen voor open vragen en schattingen (PR 3)
--
-- Twee extra testvragen achteraan de lijst. Optioneel: je kunt ze ook
-- zelf maken in beheer. Mag vaker worden uitgevoerd.
--
-- Verwijderen kan in beheer, of met:
--   delete from public.questions where id in
--     ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000007');
-- =====================================================================

insert into public.questions (id, position, category, kind, text, options, unit, time_limit)
values
  ('00000000-0000-4000-8000-000000000006',
   (select coalesce(max(position), 0) + 1 from public.questions), 'Kerstfeitje', 'open',
   'Hoe heet het rendier met de rode neus?', null, null, 20),
  ('00000000-0000-4000-8000-000000000007',
   (select coalesce(max(position), 0) + 2 from public.questions), 'Schatting', 'schatting',
   'In welk jaar werd "Stille Nacht" voor het eerst gezongen?', null, 'jaar', 30)
on conflict (id) do update set
  category   = excluded.category,
  kind       = excluded.kind,
  text       = excluded.text,
  options    = excluded.options,
  unit       = excluded.unit,
  time_limit = excluded.time_limit;

insert into public.question_answers (question_id, correct_texts, correct_value)
values
  ('00000000-0000-4000-8000-000000000006', array['Rudolf', 'Rudolph'], null),
  ('00000000-0000-4000-8000-000000000007', null, 1818)
on conflict (question_id) do update set
  correct_texts = excluded.correct_texts,
  correct_value = excluded.correct_value;

select position, kind, text from public.questions order by position;
