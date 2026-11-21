-- =====================================================================
-- Kerstquiz – 018: eigen geluidsfragment, ook achterstevoren
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- Nieuw:
--  * questions.audio_path    – geluidsfragment (mp3/m4a) in de privé-map "fotos"
--  * questions.audio_reverse – bij de vraag achterstevoren afspelen,
--                              bij het antwoord vooruit
--  * de map "fotos" accepteert nu ook geluidsbestanden (tot 50 MB)
-- =====================================================================

alter table public.questions
  add column if not exists audio_path text;

alter table public.questions
  add column if not exists audio_reverse boolean not null default false;

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
                               'video/mp4', 'video/quicktime', 'video/webm',
                               'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
                               'audio/wav', 'audio/x-wav', 'audio/ogg']
where id = 'fotos';
