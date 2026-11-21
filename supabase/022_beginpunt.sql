-- =====================================================================
-- Kerstquiz – 022: nummer laten beginnen op een gekozen moment
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw (in seconden; leeg = vanaf het begin):
--  * questions.media_start                – Spotify-nummer bij de vraag
--  * question_answers.answer_media_start  – Spotify-nummer bij het antwoord
--  * settings.countdown_music_start       – muziek tijdens het aftellen
-- =====================================================================

alter table public.questions        add column if not exists media_start integer;
alter table public.question_answers add column if not exists answer_media_start integer;
alter table public.settings         add column if not exists countdown_music_start integer;

alter table public.questions drop constraint if exists questions_media_start_check;
alter table public.questions add constraint questions_media_start_check
  check (media_start is null or media_start between 0 and 3600);
alter table public.question_answers drop constraint if exists question_answers_media_start_check;
alter table public.question_answers add constraint question_answers_media_start_check
  check (answer_media_start is null or answer_media_start between 0 and 3600);
alter table public.settings drop constraint if exists settings_countdown_start_check;
alter table public.settings add constraint settings_countdown_start_check
  check (countdown_music_start is null or countdown_music_start between 0 and 3600);
