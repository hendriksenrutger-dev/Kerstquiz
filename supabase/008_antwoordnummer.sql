-- =====================================================================
-- Kerstquiz – 008: nummer (Spotify) bij het antwoord
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw: question_answers.answer_media_url – een Spotify-link die de tv in de
-- antwoordenronde toont (bijv. het nummer waarop iemand danst).
-- Staat bij de juiste antwoorden, dus alleen leesbaar voor de beheerder.
-- =====================================================================

alter table public.question_answers
  add column if not exists answer_media_url text;

alter table public.question_answers drop constraint if exists question_answers_media_check;
alter table public.question_answers add constraint question_answers_media_check
  check (answer_media_url is null or answer_media_url ~ '^https://open\.spotify\.com/');
