-- =====================================================================
-- Kerstquiz – 024: vraag wel of niet meenemen in de quiz
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw: questions.active – in beheer een vinkje "In quiz". Uitgezette vragen
-- blijven bewaard, maar doen niet mee in de quiz.
-- =====================================================================

alter table public.questions add column if not exists active boolean not null default true;
