-- =====================================================================
-- Kerstquiz – 009: schrikeffect bij een vraag
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw:
--  * questions.scare_after – na zoveel seconden verschijnt er op de tv en op de
--    telefoons plotseling een schrikbeeld met een gil. Leeg = geen schrik.
--  * questions.scare_path  – eigen schrikbeeld (foto of GIF) in de privé-map
--    "fotos". Leeg = een getekende geest.
--  * games.scare_url       – tijdelijke link naar dat beeld voor de telefoons
--    (zoals games.photo_url voor de vraagfoto).
-- =====================================================================

alter table public.questions
  add column if not exists scare_after integer;

alter table public.questions drop constraint if exists questions_scare_check;
alter table public.questions add constraint questions_scare_check
  check (scare_after is null or scare_after between 1 and 600);

alter table public.questions
  add column if not exists scare_path text;

alter table public.games
  add column if not exists scare_url text;
