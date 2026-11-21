-- =====================================================================
-- Kerstquiz – 015: foto langzaam onthullen en intro raden
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw:
--  * questions.reveal_effect – de vraagfoto wordt langzaam zichtbaar:
--    'vervagen' (wazig → scherp), 'inzoomen' (heel dichtbij → hele foto)
--    of 'puzzel' (stukjes vallen één voor één weg). Leeg = gewoon tonen.
--  * questions.media_seconds – intro raden: de tv speelt maar zoveel seconden
--    van het Spotify-nummer en stopt dan vanzelf. Leeg = het hele fragment.
-- =====================================================================

alter table public.questions
  add column if not exists reveal_effect text;
alter table public.questions drop constraint if exists questions_reveal_effect_check;
alter table public.questions add constraint questions_reveal_effect_check
  check (reveal_effect is null or reveal_effect in ('vervagen', 'inzoomen', 'puzzel'));

alter table public.questions
  add column if not exists media_seconds integer;
alter table public.questions drop constraint if exists questions_media_seconds_check;
alter table public.questions add constraint questions_media_seconds_check
  check (media_seconds is null or media_seconds between 1 and 30);
