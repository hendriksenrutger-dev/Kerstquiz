# Kerstquiz – specificatie

Eigen pubquiz-app voor 15–40 spelers. De quizmaster (Rutger) toont de quiz op een groot scherm via zijn iPad. Spelers doen mee via hun telefoon. Duur maximaal ongeveer 45 minuten. Alle tekst in de app is Nederlands.

Dit bestand is de bron van waarheid. Wijkt iets in de code hiervan af, vraag het dan eerst na voordat je het verandert.

---

## 1. Techniek

- **Hosting:** GitHub Pages (openbare repo), statische bestanden, geen build-stap en geen npm.
- **Opbouw:** voorkeur voor één `index.html` met drie weergaven via de hash: `#tv`, `#speler` (standaard) en `#beheer`. Mag worden opgesplitst in losse `.js`/`.css`-bestanden als `index.html` te groot wordt.
- **Backend:** Supabase (eigen, apart project) voor database, realtime, opslag en login. Supabase JS laden via CDN.
- **Config:** de Supabase URL en anon key staan in een `config.js`. Die mogen openbaar zijn; de beveiliging zit in RLS.
- **Database-opzet:** in `supabase/schema.sql`. Rutger voert dit uit in de SQL-editor van Supabase. Wijzigingen later als nieuwe genummerde bestanden in `supabase/`.
- **Apparaten:** de iPad (Safari) is het tv-scherm. Spelers gebruiken iPhone en Android. Beheer moet werken op iPad én iPhone.

## 2. Rollen

| Rol | Waar | Login |
|---|---|---|
| Quizmaster / tv | iPad op groot scherm, `#tv` | Ja (Supabase Auth, e-mail + wachtwoord) |
| Beheer | iPad of iPhone, `#beheer` | Ja, hetzelfde account |
| Speler | Telefoon, `#speler` | Nee, alleen naam + kamercode |

- Er is precies één beheerdersaccount. Zelf aanmelden (signup) staat uit in Supabase.
- Het tv-scherm draait ingelogd als beheerder, omdat het de juiste antwoorden nodig heeft in de antwoordenronde.

## 3. Vraagsoorten

Elke vraag heeft een **rubriek**: vrije tekst, met suggesties uit eerder gebruikte rubrieken. Voorbeelden: "Van wie is deze kerstboom?", "In welke stad staat deze kerstboom?", "Kerstfeitje". De rubriek staat als label boven de vraag.

Elke vraag kan een **foto** hebben. Bij een foto vult die het grootste deel van het tv-scherm.

Elke vraag kan een **Spotify-link** hebben (muziek). Op de tv en op de telefoons staat dan een Spotify-speler; je tikt op ▶ om af te spelen. Zonder ingelogd Spotify-account in die browser speelt Spotify een fragment van 30 seconden.
- Gasten geven vooraf hun favoriete nummer door aan Rutger. Er zijn drie soorten muziekvragen:
  - **Wie heeft dit nummer ingestuurd?** Meerkeuze: degene die het instuurde plus drie andere namen. Speler zichtbaar.
  - **Van wie is dit nummer?** Open: spelers typen de artiest (tikfouten zijn goed). De speler is tijdens de vraag **afgedekt** (eigen ▶-knop), zodat titel en artiest niet in beeld staan.
  - **Maak de zin af.** Meerkeuze: het begin van de zin staat op de tv, met het goede vervolg en drie foute. De speler staat **alleen op de tv**, niet op de telefoons.
- Bij het antwoord is de speler altijd zichtbaar. Per vraag is in beheer in te stellen: speler tonen, afdekken of alleen op de tv. Bij een nieuwe Spotify-link in "Bewerken" staat **afdekken** standaard aan.

1. **Meerkeuze:** 4 opties (A–D), één goed.
   - "Van wie is deze kerstboom?" is gewoon een meerkeuzevraag met foto. De eigenaar is het goede antwoord en er zijn drie andere namen. Rutger vult de namen zelf in; ze komen niet uit de spelerslijst.
2. **Open:** de speler typt een antwoord. Rutger legt één of meer goede antwoorden vast.
3. **Schatting:** de speler typt een getal. Rutger legt de juiste waarde vast, plus een optionele eenheid ("jaar", "kg").

Per vraag:
- **Tijd** in seconden, standaard 20.
- **Vinkje "spelers geven deze boom een cijfer"**, alleen zinvol bij kerstboomfoto's van deelnemers.

## 4. Verloop van een quiz

De status van het spel staat in de database. Tv en telefoons volgen die via Supabase Realtime.

1. **Wachtruimte:** het tv-scherm toont de titel, de sfeerfoto, een QR-code naar `#speler?code=XXXX` en de kamercode (geen losse link) (4 tekens, zonder verwarrende tekens zoals O/0 en I/1), het aantal spelers en hun namen. Rutger tikt op "Start de quiz".
2. **Uitleg:** na "Start de quiz" toont de tv eerst "Zo werkt het": de spelregels en welke soorten vragen (rubrieken, met aantallen) er komen. De telefoons tonen "De quiz begint zo!" met de belangrijkste regels. Rutger tikt op "Eerste vraag".
3. **Vragenronde:** alle vragen in volgorde.
   - De tv toont het rubriek-label, "Vraag x van y", de vraag, de foto, de opties (bij meerkeuze), een timer en "n van m geantwoord".
   - De telefoon toont het antwoordscherm (zie 6).
   - Is de tijd om, of heeft iedereen geantwoord, dan kan Rutger op "Volgende vraag" tikken. Er gaat niets automatisch door.
   - Er worden **geen antwoorden** getoond. Om de tien vragen volgt een tussenstand zonder namen (zie 12.1).
4. **Antwoordenronde:** alle vragen nog eens, nu met het juiste antwoord.
   - **Meerkeuze:** het goede antwoord oplichten, plus hoeveel spelers het goed hadden.
   - **Open:** de beoordelingslijst (zie 5.2). Rutger kan per groep goed/fout omzetten.
   - **Schatting:** het juiste antwoord, een getallenlijn met alle schattingen als stippen, en de puntwinnaars.
   - De telefoons tonen alleen "Kijk naar het grote scherm".
5. **Eindstand:** top 10 met punten.
6. **Mooiste kerstboom:** de winnende boom met foto, de naam van de eigenaar, het gemiddelde cijfer en het aantal stemmen, met de nummers 2 en 3 eronder. Dit is het laatste scherm.

Rutger kan altijd een stap terug (vorige vraag of vorig antwoord), voor het geval hij te snel tikt.

## 5. Puntentelling

Elke goede vraag is **1 punt**. Spelers met evenveel punten delen dezelfde plaats.

### 5.1 Meerkeuze
Het goede antwoord geeft 1 punt.

### 5.2 Open vragen
- **Normaliseren:** kleine letters, accenten weg, leestekens en koppeltekens weg, spaties samenvoegen en bijsnijden.
- **Automatisch goed:** het genormaliseerde antwoord is gelijk aan een genormaliseerd goed antwoord, of wijkt er weinig van af (Levenshtein-afstand ≤ 1 bij antwoorden tot en met 5 tekens, ≤ 2 bij langere).
- **In de antwoordenronde:** de antwoorden worden gegroepeerd per genormaliseerde tekst, met het aantal spelers per groep. Per groep staat ✓ of ✗ met de reden ("exact", "schrijfwijze", "1 tikfout", "fout"). Rutger tikt een groep aan om hem om te zetten; dat geldt dan voor iedereen in die groep.
- De omzettingen worden opgeslagen.

### 5.3 Schatting
- Iedereen die het **precies goed** heeft, krijgt 1 punt.
- Hebben **minder dan 3** spelers het precies goed, dan krijgen de dichtstbijzijnde spelers ook een punt, tot er 3 zijn.
- Bij **gelijke afstand** op de laatste plek krijgen ze allemaal een punt. Er kunnen dus meer dan 3 winnaars zijn.

### 5.4 Mooiste kerstboom
- Spelers geven bij vragen met het cijfer-vinkje een cijfer van 1 tot 10. Dit telt niet mee voor de score.
- De winnaar is de boom met het hoogste gemiddelde cijfer, met **minimaal 10 stemmen**. Dat minimum is aanpasbaar in beheer.
- Een eigen boom beoordelen wordt niet geblokkeerd. Dat is een bewuste keuze.
- De eigenaar is het goede antwoord van de vraag.

## 6. Spelersscherm (telefoon)

- **Aanmelden:** naam (max 14 tekens) en kamercode, die via de QR-code al is ingevuld.
  - Dezelfde naam twee keer in één spel mag niet; vraag dan om een andere naam.
  - Laat aanmelden tijdens het spel is toegestaan. Gemiste vragen tellen als 0.
- Het speler-id wordt in `localStorage` bewaard. Na herladen of een weggevallen verbinding gaat de speler verder in hetzelfde spel.
- **Meerkeuze:** de vier opties met letter en tekst, grote knoppen. Bij een foto ook een kleine versie ervan op de telefoon. Je kunt je keuze wijzigen tot de tijd om is.
- **Cijfer** (als het vinkje aan staat): bij een meerkeuzevraag in twee stappen. Eerst kies je van wie de boom is; daarna verschijnt in hetzelfde scherm "Welk cijfer geef je deze boom?" met grote knoppen 1–10 en "telt niet voor je score", met bovenaan je antwoord en "Wijzigen".
- **Open:** de vraag, een tekstveld en "Verstuur". Tip eronder: "Kleine tikfouten zijn niet erg."
- **Schatting:** de vraag, een getalveld (numeriek toetsenbord) met de eenheid, en "Verstuur". Tip eronder: "De drie die het dichtst zitten krijgen een punt."
- Bovenin: het vraagnummer, de resterende tijd en de naam van de speler. **Geen punten tonen**; die zijn pas na de antwoordenronde bekend.
- Na de tijd: "Antwoord ontvangen – kijk naar het grote scherm".

## 7. Beheer

- **Inloggen** met e-mail en wachtwoord.
- **Vragenlijst:** volgorde aanpassen (omhoog/omlaag), toevoegen, bewerken, verwijderen.
- **Vraag bewerken:** rubriek, soort, vraagtekst, foto, tijd, cijfer-vinkje, en per soort:
  - meerkeuze: 4 opties en het goede antwoord;
  - open: goede antwoorden, één per regel;
  - schatting: de waarde en de eenheid.
- **Snel een kerstboom toevoegen (iPhone):** een apart, smal scherm.
  - Je kiest een foto (uit Foto's), vult in van wie de boom is (het goede antwoord), drie andere namen en het cijfer-vinkje (standaard aan).
  - "Opslaan en volgende boom".
  - Rubriek automatisch "Van wie is deze kerstboom?".
  - Bovenin staat het aantal bomen.
- **Snel een nummer toevoegen:** net als de kerstboom, maar met een Spotify-link in plaats van een foto. Eerst kies je de soort (ingestuurd, artiest, zin afmaken); rubriek en speler-instelling gaan automatisch. Standaard 30 seconden, geen cijfer.
- **Test:** start een apart spel met 30 testspelers die zelf willekeurig antwoorden (de proefmodus uit 10).
- **Foto's:** in de browser verkleinen tot maximaal 1600 px, JPEG kwaliteit 0,8, en daarna uploaden.
- **Spelinstellingen:** het minimum aantal stemmen voor de mooiste boom, en muziek (Spotify-link) bij de start en bij het einde. Het startnummer speelt op de tv in de wachtruimte en bij "Zo werkt het"; het eindnummer vanaf de definitieve eindstand tot en met de mooiste kerstboom. Een kleine speler onderin. De muziek start door de tik op "Start nieuwe quiz" (beginscherm) en op "Einde antwoordenronde" / "Naar de eindstand"; anders tik op ▶. Het nummer (of het Spotify-fragment) herhaalt zich.
- **Spel starten:** "Start quiz op dit scherm" maakt een nieuw spel met een nieuwe kamercode en opent `#tv`.

## 8. Data en beveiliging (Supabase)

Voorstel; de precieze opzet mag Claude Code bepalen, binnen deze eisen:

- **`questions`:** alles wat spelers mogen zien (rubriek, soort, tekst, foto-pad, Spotify-link, opties, tijd, cijfer-vinkje, volgorde).
- **`question_answers`:** de juiste antwoorden (goede optie, goede teksten, waarde). **Alleen leesbaar voor de beheerder.** Spelers mogen de antwoorden niet via de API kunnen opvragen.
- **`games`:** kamercode, status, huidige vraag, starttijd van de vraag, minimum aantal stemmen.
- **`players`:** spel, naam.
- **`answers`:** spel, speler, vraag, keuze, tekst of getal, cijfer, tijdstip. Eén rij per speler per vraag; bij wijzigen bijwerken.
- **`overrides`:** spel, vraag, genormaliseerde tekst, goed of fout.
- **RLS:**
  - spelers (anon) mogen een speler aanmaken, en antwoorden insturen of wijzigen zolang die vraag open staat;
  - spelers mogen `questions` en `games` lezen;
  - spelers mogen geen antwoorden of scores van anderen lezen;
  - de beheerder mag alles.
  - Het controleren van de vraagstatus gebeurt bij voorkeur via een databasefunctie (RPC).
- **Foto's:** in een **privé** opslag-bucket.
  - Het tv-scherm (ingelogd) maakt tijdelijke links (signed URLs, ongeveer 3 uur geldig).
  - De link van de huidige foto komt via de spelstatus naar de telefoons.
  - Foto's van bomen bij mensen thuis mogen nooit in de GitHub-repo terechtkomen.

## 9. Ontwerp

- **Kleuren:**

  | Rol | Kleur |
  |---|---|
  | Achtergrond | donkergroen `#0F2A1D` |
  | Vlakken | `#17392A` |
  | Randen | `#2B5A43` |
  | Tekst | crèmewit `#F5F1E6` |
  | Gedempte tekst | `#B8CBBE` |
  | Accent (knoppen, kamercode, rand om foto's) | goud `#E3B04B` |
  | Meerkeuze A | `#E3B04B` |
  | Meerkeuze B | `#F09C8F` |
  | Meerkeuze C | `#F5F1E6` |
  | Meerkeuze D | `#9ED4B0` |
  | Goed | `#8FE0A8` |
  | Fout | `#F09C8F` |

  Bij meerkeuze en goed/fout altijd de letter of het ✓/✗-teken tonen, niet alleen de kleur.
- **Beheer:** een licht thema met een lichte crèmekleurige achtergrond (`#F6F3EA`), witte vlakken en donkergroene knoppen.
- **Lettertypes:** Playfair Display (600/700) voor titels, Inter voor de rest (Google Fonts).
- **Sfeerfoto:** `assets/hero.jpg` (de sneeuwbol, door Rutger aangeleverd) staat op het welkomstscherm, met een donkergroene overlay links zodat de tekst leesbaar blijft.
- **Tv-scherm:** ontworpen voor 16:9. Grote letters: vragen minstens 44 px, opties minstens 30 px. Het moet ook netjes werken met de beeldverhouding van een iPad (zwarte randen zijn prima).
- **Telefoon:** knoppen minstens 44 px hoog. Werkt vanaf 360 px breed.

## 10. Robuustheid

- **Tv:** het scherm aan houden via de Wake Lock API, als de browser dat ondersteunt, en een knop voor volledig scherm.
- **Verbinding:** bij een weggevallen verbinding automatisch opnieuw verbinden en de actuele status ophalen (tv én telefoon).
- **Timer:** de starttijd van een vraag komt uit de database. De timer op tv en telefoon wordt daaruit berekend, niet uit lokale tellers.
- **Proefmodus:** de knop "Test" in beheer start een spel met 30 testspelers met willekeurige antwoorden, om de app vooraf te testen.

## 11. Bouwvolgorde (pull requests)

Elke PR moet zelfstandig te testen zijn op GitHub Pages.

1. **Basis:** `schema.sql` (tabellen, RLS, bucket), `config.js`, wachtruimte, aanmelden en de vragenronde met alleen meerkeuze. De vragen komen hier nog via een testscript in SQL.
2. **Beheer:** inloggen, vragen beheren, foto-upload, het iPhone-scherm "kerstboom toevoegen".
3. **Open en schatting:** beide vraagsoorten, de puntentelling, de antwoordenronde met het beoordelingsscherm en de getallenlijn.
4. **Afsluiting:** het cijfer 1–10, de eindstand en de mooiste kerstboom.
5. **Afwerking:** Wake Lock, volledig scherm, opnieuw verbinden, de proefmodus en kleine ontwerpcorrecties.

Elke PR bevat in de beschrijving: wat er nieuw is, hoe Rutger het kan testen (stap voor stap, vanaf iPad en telefoon) en of er een nieuw SQL-bestand in Supabase moet worden uitgevoerd.

## 12. Tussenstand, schifting en winnaars

Gebouwd na de oorspronkelijke vijf PR's (SQL: `supabase/004_extra.sql`).

### 12.1 Tussenstand om de tien vragen
- Na vraag 10, 20, 30 enzovoort toont de tv een scherm **"Tussenstand"** met alleen de **scores van de top 5, zonder namen** (bijvoorbeeld "1e – 9 punten, 2e – 8 punten").
- Spelers met evenveel punten delen de plaats, net als in de eindstand.
- Dit vervangt voor deze momenten de regel "geen tussenstand" uit hoofdstuk 4.
- Beperking: open vragen worden pas in de antwoordenronde handmatig goed of fout gezet. De tussenstand rekent daarom met het **automatische oordeel** (exact, schrijfwijze, tikfout) en kan een punt afwijken van de eindstand.

### 12.2 Schiftingsvraag bij gelijke stand
- Doel: na de eindstand blijft er precies **één nummer 1, één nummer 2 en één nummer 3** over.
- Staan spelers gelijk op een plek die ertoe doet, dan volgt een extra **schattingsvraag** (de schiftingsvraag). Alleen die spelers doen mee; de rest kijkt mee op de tv.
  - 9, 9, 9, 8 punten: de drie spelers met 9 strijden om plek 1, 2 en 3; wie 8 heeft, wordt 4e.
  - 10, 8, 8, 8 punten: plek 1 staat vast; de drie spelers met 8 strijden om plek 2 en 3.
  - 10, 9, 7, 7 punten: alleen de twee spelers met 7 strijden om plek 3.
- Wie het dichtst bij de juiste waarde zit, krijgt de hoogste plek in die groep.
- Zitten spelers precies even ver ernaast, dan volgt de volgende schiftingsvraag, tot elke plek één naam heeft.
- Rutger zet in beheer 2 à 3 schiftingsvragen klaar (schattingen, als reserve). Ze tellen niet mee als gewone vraag en staan niet in "Dit komt er".
- Is er geen schiftingsvraag (meer) over, dan blijft de gelijke stand staan en geldt 12.3 zonder schifting.
- "Vorige" bij een schiftingsvraag waarop nog niemand heeft geantwoord, telt die vraag niet als gesteld.

### 12.3 Winnaars in de spotlight
- Bij de (definitieve) eindstand gaat het scherm van de telefoons van de **top 3** **groen knipperen**, met bijvoorbeeld "🏆 Jij staat 1e!".
- De tv toont de namen van de top 3 groot in beeld.
- Zonder schiftingsvraag horen bij de top 3 alle spelers met een van de **drie hoogste scores**, hoeveel spelers dat ook zijn. Met de schiftingsvraag (12.2) zijn het precies drie spelers.
- Hiervoor moet de tv aan de telefoons doorgeven wie er gewonnen heeft (een nieuwe kolom in `games` en een nieuw SQL-bestand in `supabase/`).
