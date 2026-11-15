# Kerstquiz

Eigen pubquiz-app voor de kerst. Zie [SPEC.md](SPEC.md) voor de volledige specificatie.

- `#tv` – beginscherm van de quizmaster (start quiz, beheer, kerstboom toevoegen) en het grote scherm (iPad)
- `#speler` – telefoon van de spelers (standaard)
- `#beheer` – vragen beheren, spel starten (iPad of iPhone)
- `#beheer?scherm=boom` – snel een kerstboom toevoegen (iPhone)

## Opzet

1. Supabase → SQL Editor: voer `supabase/schema.sql` uit, daarna `supabase/002_beheer.sql`.
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

## Proefmodus

Tik in de wachtruimte op `#tv` 5× snel op de titel "Kerstquiz" om 30 testspelers toe te voegen die zelf willekeurig antwoorden.
Gebruik dit alleen met een apart testspel.
