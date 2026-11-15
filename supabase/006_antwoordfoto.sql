-- =====================================================================
-- Kerstquiz – 006: foto bij het antwoord
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw: question_answers.answer_photo_path – een andere foto die de tv in
-- de antwoordenronde toont (bijv. de eigenaar bij zijn kerstboom).
-- Staat bij de juiste antwoorden, dus alleen leesbaar voor de beheerder.
-- =====================================================================

alter table public.question_answers
  add column if not exists answer_photo_path text;
