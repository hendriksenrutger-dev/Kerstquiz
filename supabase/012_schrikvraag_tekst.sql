-- =====================================================================
-- Kerstquiz – 012: schrikvraag met een echte vraag erna
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd. Eerst 009 en 010.
--
-- Nieuw: questions.scare_text – de tekst vóór de schrik (bijv. "Kijk goed…").
-- De gewone vraagtekst, soort en antwoorden verschijnen ná de schrik.
-- =====================================================================

alter table public.questions
  add column if not exists scare_text text;
