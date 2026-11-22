-- =====================================================================
-- Kerstquiz – 023: aftellen op de beat van de muziek
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw: settings.countdown_bpm – tempo van het aftelnummer. Dan tikt de klok
-- op de beat (bijv. 126 bpm: elke 2 tellen = 0,95 s) i.p.v. elke seconde.
-- =====================================================================

alter table public.settings add column if not exists countdown_bpm integer;
alter table public.settings drop constraint if exists settings_countdown_bpm_check;
alter table public.settings add constraint settings_countdown_bpm_check
  check (countdown_bpm is null or countdown_bpm between 40 and 240);
