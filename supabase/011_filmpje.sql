-- =====================================================================
-- Kerstquiz – 011: filmpje bij de vraag en/of bij het antwoord
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw:
--  * questions.video_path               – filmpje bij de vraag (privé-map "fotos")
--  * question_answers.answer_video_path – filmpje bij het antwoord (alleen beheerder)
--  * games.video_url                    – tijdelijke link voor de telefoons
--  * de map "fotos" accepteert nu ook filmpjes (mp4, mov, webm), tot 50 MB
-- =====================================================================

alter table public.questions
  add column if not exists video_path text;

alter table public.question_answers
  add column if not exists answer_video_path text;

alter table public.games
  add column if not exists video_url text;

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
                               'video/mp4', 'video/quicktime', 'video/webm']
where id = 'fotos';
