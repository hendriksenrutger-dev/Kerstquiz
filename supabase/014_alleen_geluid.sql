-- =====================================================================
-- Kerstquiz – 014: muziek "alleen geluid" (geen Spotify-speler in beeld)
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw:
--  * questions.media_mode mag nu ook 'alleen_geluid' zijn: de tv speelt het
--    nummer af, maar er staat geen speler in beeld (ook niet op de telefoons).
--  * question_answers.answer_media_hidden – hetzelfde voor het nummer bij het antwoord.
-- =====================================================================

alter table public.questions drop constraint if exists questions_media_mode_check;
alter table public.questions add constraint questions_media_mode_check
  check (media_mode in ('tonen', 'verbergen', 'alleen_tv', 'alleen_geluid'));

alter table public.question_answers
  add column if not exists answer_media_hidden boolean not null default false;
