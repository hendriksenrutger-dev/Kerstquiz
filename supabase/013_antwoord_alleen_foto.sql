-- =====================================================================
-- Kerstquiz – 013: antwoord alleen als foto/filmpje (zonder antwoordtekst)
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw: question_answers.hide_answer_text – in de antwoordenronde alleen de
-- antwoordfoto of het antwoordfilmpje tonen, zonder het antwoord als tekst
-- (open vraag en meerkeuze; bij een schatting blijft het getal staan).
-- =====================================================================

alter table public.question_answers
  add column if not exists hide_answer_text boolean not null default false;
