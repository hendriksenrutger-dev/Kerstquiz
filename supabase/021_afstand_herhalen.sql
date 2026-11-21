-- =====================================================================
-- Kerstquiz – 021: afstandsbediening "nog een keer" (intro / geluid herhalen)
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd. Eerst 020_afstandsbediening.sql.
-- =====================================================================

alter table public.remote_commands drop constraint if exists remote_commands_action_check;
alter table public.remote_commands add constraint remote_commands_action_check
  check (action in ('next', 'prev', 'replay'));
