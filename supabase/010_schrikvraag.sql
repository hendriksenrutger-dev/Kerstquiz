-- =====================================================================
-- Kerstquiz – 010: schrikvraag
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd. Eerst 009_schrik.sql.
--
-- Nieuw: questions.scare_only – een "vraag" die alleen een tekst toont
-- (bijv. "Kijk goed…") en daarna het schrikbeeld. Geen antwoorden, geen
-- punten; in de antwoordenronde wordt hij overgeslagen.
-- =====================================================================

alter table public.questions
  add column if not exists scare_only boolean not null default false;
