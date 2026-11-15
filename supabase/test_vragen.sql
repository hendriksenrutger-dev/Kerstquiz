-- =====================================================================
-- Kerstquiz – testvragen (PR 1)
--
-- Vijf meerkeuzevragen zonder foto, om de basis te testen.
-- Uitvoeren in Supabase → SQL Editor, NA schema.sql.
-- Mag vaker worden uitgevoerd: de vragen hebben vaste id's en worden
-- dan bijgewerkt in plaats van dubbel toegevoegd.
--
-- Verwijderen kan later met:
--   delete from public.questions where id::text like '00000000-0000-4000-8000-00000000000_';
-- =====================================================================

insert into public.questions (id, position, category, kind, text, options, time_limit)
values
  ('00000000-0000-4000-8000-000000000001', 1, 'Kerstfeitje', 'meerkeuze',
   'In welk land werd "Stille Nacht" voor het eerst gezongen?',
   '["Oostenrijk", "Duitsland", "Zwitserland", "Nederland"]', 20),
  ('00000000-0000-4000-8000-000000000002', 2, 'Kerstfeitje', 'meerkeuze',
   'Hoeveel rendieren trekken de slee van de Kerstman (zonder Rudolf)?',
   '["6", "8", "9", "12"]', 20),
  ('00000000-0000-4000-8000-000000000003', 3, 'Kerstmuziek', 'meerkeuze',
   'Wie zong het origineel van "Last Christmas"?',
   '["Mariah Carey", "Band Aid", "Wham!", "Chris Rea"]', 20),
  ('00000000-0000-4000-8000-000000000004', 4, 'Kerst in Nederland', 'meerkeuze',
   'Hoe heet het kerstgerecht waarbij iedereen zelf aan tafel kleine stukjes vlees bakt?',
   '["Fondue", "Gourmetten", "Steengrillen", "Raclette"]', 20),
  ('00000000-0000-4000-8000-000000000005', 5, 'Kerstfeitje', 'meerkeuze',
   'Welke stad schenkt Londen elk jaar de grote kerstboom op Trafalgar Square?',
   '["Oslo", "Kopenhagen", "Helsinki", "Stockholm"]', 30)
on conflict (id) do update set
  position   = excluded.position,
  category   = excluded.category,
  kind       = excluded.kind,
  text       = excluded.text,
  options    = excluded.options,
  time_limit = excluded.time_limit;

insert into public.question_answers (question_id, correct_option)
values
  ('00000000-0000-4000-8000-000000000001', 0),  -- A Oostenrijk
  ('00000000-0000-4000-8000-000000000002', 1),  -- B 8
  ('00000000-0000-4000-8000-000000000003', 2),  -- C Wham!
  ('00000000-0000-4000-8000-000000000004', 1),  -- B Gourmetten
  ('00000000-0000-4000-8000-000000000005', 0)   -- A Oslo
on conflict (question_id) do update set correct_option = excluded.correct_option;

select position, category, text from public.questions order by position;
