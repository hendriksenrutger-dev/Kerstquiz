# Kerstquiz B&S

Eigen pubquiz-app voor de kerst. Zie [SPEC.md](SPEC.md) voor de volledige specificatie.

- `#tv` – beginscherm van de quizmaster (start quiz, verder met spel, linkje naar beheer) en het grote scherm (iPad)
- `#speler` – telefoon van de spelers (standaard)
- `#beheer` – vragen beheren, spel starten (iPad of iPhone)
- `#beheer?scherm=boom` – snel een kerstboom toevoegen (iPhone)
- `#beheer?scherm=nummer` – snel een nummer (Spotify-link) toevoegen

## Opzet

1. Supabase → SQL Editor: voer `supabase/schema.sql` uit, daarna `supabase/002_beheer.sql`, `supabase/003_muziek.sql`, `supabase/004_extra.sql`, `supabase/005_muziek_start_einde.sql`, `supabase/006_antwoordfoto.sql`, `supabase/007_gif.sql`, `supabase/008_antwoordnummer.sql`, `supabase/009_schrik.sql`, `supabase/010_schrikvraag.sql` en `supabase/011_filmpje.sql`.
2. Voor testen: voer `supabase/test_vragen.sql` uit (5 meerkeuzevragen) en eventueel
   `supabase/test_vragen_open_schatting.sql` (een open vraag en een schatting).
3. Supabase → Authentication → Users → *Add user*: maak het beheerdersaccount aan
   (e-mail + wachtwoord, "Auto Confirm User" aan). Zet onder Authentication →
   Sign In / Providers "Allow new users to sign up" uit.
4. De Supabase-URL en publishable key staan in `config.js`.

Geen build-stap: GitHub Pages serveert de bestanden direct.
Foto's van kerstbomen komen alleen in de privé Supabase-bucket `fotos`, nooit in deze repo.

## Tests

De puntentelling (`js/scoring.js`) heeft tests: `node tests/scoring.test.mjs`.

## Testquiz

In beheer start de knop **Test** een apart spel met 30 testspelers die zelf willekeurig antwoorden.
Gebruik voor de echte avond "Start quiz op dit scherm" of "Start nieuwe quiz".

## Nieuwe versie uitbrengen

Verhoog het versienummer op vier plekken, zodat browsers meteen de nieuwe bestanden laden:
`version.txt`, `APP_VERSION` in `js/common.js`, de `?v=…` in `index.html` en de `?v=…` in alle `import`-regels in `js/`.
De app vergelijkt bij het laden zijn eigen versie met `version.txt` en herlaadt zichzelf als er een nieuwere online staat.
