-- =====================================================================
-- Kerstquiz – 005: muziek bij de start en bij het einde
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Pas uitvoeren NA 002_beheer.sql. Mag opnieuw worden uitgevoerd.
--
-- Nieuw in `settings` (alleen voor de beheerder):
--   start_music – Spotify-link voor de wachtruimte en "Zo werkt het"
--   end_music   – Spotify-link vanaf de definitieve eindstand
-- Aan te passen in Beheer → Spelinstellingen.
-- =====================================================================

alter table public.settings
  add column if not exists start_music text,
  add column if not exists end_music   text;

alter table public.settings drop constraint if exists settings_music_check;
alter table public.settings add constraint settings_music_check check (
  (start_music is null or start_music ~ '^https://open\.spotify\.com/')
  and (end_music is null or end_music ~ '^https://open\.spotify\.com/')
);

-- De nummers die Rutger koos (alleen invullen als er nog niets staat).
update public.settings set
  start_music = coalesce(start_music, 'https://open.spotify.com/track/25AtvmC59O7YhigsrxOme6'),
  end_music   = coalesce(end_music,   'https://open.spotify.com/track/72Z28IsvEVLjSWdUKEQgZ0')
where id = 1;
