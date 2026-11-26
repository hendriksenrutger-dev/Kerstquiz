-- =====================================================================
-- Kerstquiz – 025: filmpjes uitfaden op een ingesteld moment
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw:
--  * questions.video_end                – filmpje bij de vraag faadt uit en stopt hier (seconden)
--  * question_answers.answer_video_end  – idem voor het filmpje bij het antwoord
-- =====================================================================

alter table public.questions
  add column if not exists video_end integer check (video_end is null or video_end > 0);

alter table public.question_answers
  add column if not exists answer_video_end integer check (answer_video_end is null or answer_video_end > 0);
