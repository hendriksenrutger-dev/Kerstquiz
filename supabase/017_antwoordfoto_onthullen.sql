-- =====================================================================
-- Kerstquiz – 017: antwoordfoto langzaam onthullen
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw: question_answers.answer_reveal_effect – de antwoordfoto wordt in de
-- antwoordenronde langzaam zichtbaar: 'vervagen', 'inzoomen' of 'puzzel'.
-- Leeg = gewoon tonen.
-- =====================================================================

alter table public.question_answers
  add column if not exists answer_reveal_effect text;
alter table public.question_answers drop constraint if exists question_answers_reveal_check;
alter table public.question_answers add constraint question_answers_reveal_check
  check (answer_reveal_effect is null or answer_reveal_effect in ('vervagen', 'inzoomen', 'puzzel'));
