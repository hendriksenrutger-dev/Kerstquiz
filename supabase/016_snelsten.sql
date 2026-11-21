-- =====================================================================
-- Kerstquiz – 016: alleen de snelsten krijgen een punt
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw: questions.fastest_count – bij een meerkeuze- of open vraag krijgen
-- alleen de zoveel snelste goede antwoorden een punt (in beheer: 3).
-- Leeg = iedereen met het goede antwoord krijgt een punt.
-- =====================================================================

alter table public.questions
  add column if not exists fastest_count integer;
alter table public.questions drop constraint if exists questions_fastest_count_check;
alter table public.questions add constraint questions_fastest_count_check
  check (fastest_count is null or fastest_count between 1 and 20);
