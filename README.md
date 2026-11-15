# Kerstquiz

Eigen pubquiz-app voor de kerst. Zie [SPEC.md](SPEC.md) voor de volledige specificatie.

- `#tv` – groot scherm (iPad, inloggen als quizmaster)
- `#speler` – telefoon van de spelers (standaard)
- `#beheer` – vragen beheren, spel starten (iPad of iPhone)
- `#beheer?scherm=boom` – snel een kerstboom toevoegen (iPhone)

## Opzet

1. Supabase → SQL Editor: voer `supabase/schema.sql` uit, daarna `supabase/002_beheer.sql`.
2. Voor testen: voer `supabase/test_vragen.sql` uit (5 meerkeuzevragen).
3. Supabase → Authentication → Users → *Add user*: maak het beheerdersaccount aan
   (e-mail + wachtwoord, "Auto Confirm User" aan). Zet onder Authentication →
   Sign In / Providers "Allow new users to sign up" uit.
4. De Supabase-URL en publishable key staan in `config.js`.

Geen build-stap: GitHub Pages serveert de bestanden direct.
Foto's van kerstbomen komen alleen in de privé Supabase-bucket `fotos`, nooit in deze repo.
