-- =====================================================================
-- Kerstquiz – 20 vragen: eten & drinken en kersttradities (pittig)
--
-- Komen achteraan de vragenlijst. Mag vaker worden uitgevoerd (dan worden
-- tekst en antwoorden bijgewerkt, de volgorde blijft). Aanpassen of
-- verwijderen kan daarna gewoon in beheer.
-- =====================================================================

with nieuw (nr, id, category, kind, text, options, unit, time_limit) as (values
  ( 1, '00000000-0000-4000-8000-000000000101'::uuid, 'Kersttradities', 'meerkeuze',
    'In welk land is het voor veel mensen traditie om met kerst bij KFC te eten?',
    '["Japan","Zuid-Korea","Filipijnen","Australië"]'::jsonb, null, 20),
  ( 2, '00000000-0000-4000-8000-000000000102'::uuid, 'Eten & drinken', 'meerkeuze',
    'Uit welke stad komt de panettone oorspronkelijk?',
    '["Milaan","Rome","Napels","Venetië"]'::jsonb, null, 20),
  ( 3, '00000000-0000-4000-8000-000000000103'::uuid, 'Kersttradities', 'open',
    'In welke stad was Sint-Nicolaas, de inspiratie voor de kerstman, bisschop?',
    null, null, 30),
  ( 4, '00000000-0000-4000-8000-000000000104'::uuid, 'Kersttradities', 'meerkeuze',
    'Hoeveel ondeugende kerstmannetjes (de Jólasveinar) komen er in IJsland langs in de dagen voor kerst?',
    '["4","9","13","24"]'::jsonb, null, 20),
  ( 5, '00000000-0000-4000-8000-000000000105'::uuid, 'Eten & drinken', 'meerkeuze',
    'Wat stelt de kerststol volgens de traditie voor?',
    '["De kribbe","Het ingebakerde kindje Jezus","De ster van Bethlehem","Een besneeuwde heuvel"]'::jsonb, null, 20),
  ( 6, '00000000-0000-4000-8000-000000000106'::uuid, 'Schatting', 'schatting',
    'Tel alle cadeaus uit "The Twelve Days of Christmas" bij elkaar op (alle coupletten). Hoeveel cadeaus krijg je in totaal?',
    null, 'cadeaus', 30),
  ( 7, '00000000-0000-4000-8000-000000000107'::uuid, 'Kersttradities', 'meerkeuze',
    'Wie maakte de kerstboom in de 19e eeuw populair in Engeland?',
    '["Koningin Elizabeth I","Koning George III","Prins Albert","Koning Edward VII"]'::jsonb, null, 20),
  ( 8, '00000000-0000-4000-8000-000000000108'::uuid, 'Eten & drinken', 'meerkeuze',
    'Hoe heet de Zweedse variant van glühwein?',
    '["Glögg","Grog","Punsch","Akvavit"]'::jsonb, null, 20),
  ( 9, '00000000-0000-4000-8000-000000000109'::uuid, 'Eten & drinken', 'open',
    'Welke specerij wordt traditioneel over eggnog gestrooid?',
    null, null, 30),
  (10, '00000000-0000-4000-8000-000000000110'::uuid, 'Kersttradities', 'meerkeuze',
    'Wie brengt in Italië op 6 januari cadeautjes naar de kinderen?',
    '["Krampus","La Befana","Sint-Lucia","Knecht Ruprecht"]'::jsonb, null, 20),
  (11, '00000000-0000-4000-8000-000000000111'::uuid, 'Eten & drinken', 'meerkeuze',
    'De Franse bûche de Noël is een taart in de vorm van een …',
    '["Ster","Boomstam","Kerstklok","Kroon"]'::jsonb, null, 20),
  (12, '00000000-0000-4000-8000-000000000112'::uuid, 'Schatting', 'schatting',
    'In welk jaar werd de allereerste kerstkaart verstuurd?',
    null, 'jaar', 30),
  (13, '00000000-0000-4000-8000-000000000113'::uuid, 'Kersttradities', 'meerkeuze',
    'Welk figuurtje staat in Catalonië in de kerststal, met zijn broek omlaag?',
    '["Caganer","Tió","Belén","Pastorcillo"]'::jsonb, null, 20),
  (14, '00000000-0000-4000-8000-000000000114'::uuid, 'Eten & drinken', 'meerkeuze',
    'Welke vis staat in Polen traditioneel op tafel bij het kerstavondmaal?',
    '["Haring","Karper","Zalm","Kabeljauw"]'::jsonb, null, 20),
  (15, '00000000-0000-4000-8000-000000000115'::uuid, 'Kersttradities', 'open',
    'Welk land schenkt Londen elk jaar de grote kerstboom op Trafalgar Square?',
    null, null, 30),
  (16, '00000000-0000-4000-8000-000000000116'::uuid, 'Kersttradities', 'meerkeuze',
    'Wat betekent "mis" in het woord Kerstmis?',
    '["Een maaltijd","Een kerkdienst","Een feestdag","Een nachtwake"]'::jsonb, null, 20),
  (17, '00000000-0000-4000-8000-000000000117'::uuid, 'Kersttradities', 'meerkeuze',
    'In het Zweedse Gävle staat elk jaar een enorm strooien kerstfiguur, dat vaak in brand wordt gestoken. Welk dier is het?',
    '["Rendier","Eland","Bok","Varken"]'::jsonb, null, 20),
  (18, '00000000-0000-4000-8000-000000000118'::uuid, 'Schatting', 'schatting',
    'Op welke dag in januari vieren Russisch-orthodoxe christenen kerst?',
    null, 'januari', 30),
  (19, '00000000-0000-4000-8000-000000000119'::uuid, 'Kersttradities', 'open',
    'Welke schrijver bedacht Ebenezer Scrooge?',
    null, null, 30),
  (20, '00000000-0000-4000-8000-000000000120'::uuid, 'Kersttradities', 'meerkeuze',
    'In welk land stond voor zover bekend de eerste versierde kerstboom in huis?',
    '["Engeland","Duitsland","Zweden","Nederland"]'::jsonb, null, 20)
)
insert into public.questions (id, position, category, kind, text, options, unit, time_limit)
select id, (select coalesce(max(position), 0) from public.questions) + nr,
       category, kind, text, options, unit, time_limit
from nieuw
on conflict (id) do update set
  category   = excluded.category,
  kind       = excluded.kind,
  text       = excluded.text,
  options    = excluded.options,
  unit       = excluded.unit,
  time_limit = excluded.time_limit;

insert into public.question_answers (question_id, correct_option, correct_texts, correct_value)
values
  ('00000000-0000-4000-8000-000000000101', 0, null, null),
  ('00000000-0000-4000-8000-000000000102', 0, null, null),
  ('00000000-0000-4000-8000-000000000103', null, array['Myra', 'Demre'], null),
  ('00000000-0000-4000-8000-000000000104', 2, null, null),
  ('00000000-0000-4000-8000-000000000105', 1, null, null),
  ('00000000-0000-4000-8000-000000000106', null, null, 364),
  ('00000000-0000-4000-8000-000000000107', 2, null, null),
  ('00000000-0000-4000-8000-000000000108', 0, null, null),
  ('00000000-0000-4000-8000-000000000109', null, array['Nootmuskaat', 'Muskaat', 'Muskaatnoot'], null),
  ('00000000-0000-4000-8000-000000000110', 1, null, null),
  ('00000000-0000-4000-8000-000000000111', 1, null, null),
  ('00000000-0000-4000-8000-000000000112', null, null, 1843),
  ('00000000-0000-4000-8000-000000000113', 0, null, null),
  ('00000000-0000-4000-8000-000000000114', 1, null, null),
  ('00000000-0000-4000-8000-000000000115', null, array['Noorwegen', 'Norway'], null),
  ('00000000-0000-4000-8000-000000000116', 1, null, null),
  ('00000000-0000-4000-8000-000000000117', 2, null, null),
  ('00000000-0000-4000-8000-000000000118', null, null, 7),
  ('00000000-0000-4000-8000-000000000119', null, array['Charles Dickens', 'Dickens'], null),
  ('00000000-0000-4000-8000-000000000120', 1, null, null)
on conflict (question_id) do update set
  correct_option = excluded.correct_option,
  correct_texts  = excluded.correct_texts,
  correct_value  = excluded.correct_value;

select position, kind, text from public.questions order by position;
