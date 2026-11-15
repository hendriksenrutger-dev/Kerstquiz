-- =====================================================================
-- Kerstquiz – 007: bewegende GIF's als foto
--
-- Uitvoeren: Supabase → SQL Editor → dit hele bestand plakken → Run.
-- Mag opnieuw worden uitgevoerd.
--
-- De privé bucket "fotos" accepteert nu ook GIF-bestanden (bewegend).
-- =====================================================================

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'fotos';
