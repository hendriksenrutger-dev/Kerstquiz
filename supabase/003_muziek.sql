-- =====================================================================
-- Kerstquiz – 003: muziek (Spotify-link bij een vraag)
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Pas uitvoeren NA schema.sql en 002_beheer.sql. Mag opnieuw worden uitgevoerd.
--
-- Nieuw: kolom questions.media_url met een Spotify-link (optioneel).
-- Spelers mogen die zien (net als de rest van `questions`), zodat het
-- nummer ook op hun telefoon kan klinken.
-- =====================================================================

alter table public.questions
  add column if not exists media_url text;

alter table public.questions
  drop constraint if exists questions_media_url_check;
alter table public.questions
  add constraint questions_media_url_check
  check (media_url is null or (char_length(media_url) <= 500 and media_url ~ '^(https://open\.spotify\.com/|spotify:)'));
