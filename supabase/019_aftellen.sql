-- =====================================================================
-- Kerstquiz – 019: aftellen vóór de eerste vraag
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw (Beheer → Spelinstellingen):
--  * settings.countdown_seconds – na "Zo werkt het" telt de tv zoveel seconden
--    af ("Quiz begint in"); leeg = geen aftelscherm
--  * settings.countdown_music   – Spotify-link die tijdens het aftellen speelt
-- =====================================================================

alter table public.settings
  add column if not exists countdown_seconds integer,
  add column if not exists countdown_music   text;

alter table public.settings drop constraint if exists settings_countdown_check;
alter table public.settings add constraint settings_countdown_check check (
  (countdown_seconds is null or countdown_seconds between 3 and 600)
  and (countdown_music is null or countdown_music ~ '^https://open\.spotify\.com/')
);
