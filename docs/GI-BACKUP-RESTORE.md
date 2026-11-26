# GI komanda – šifruotos atsarginės kopijos ir atkūrimas

**Būsena 2026-11-24: pirmos tikros šifruotos kopijos ir suplanuotas 2026-11-24 eksportas patvirtinti; tiesioginis Drive veidrodis ir pilnas izoliuotas atkūrimas dar nepatvirtinti (issue #32).**
Šio dokumento aprašoma automatika startuoja tik sukūrus visus toliau nurodytus GitHub Actions Secret/Variable ir pirmą kartą patikrinus **tikros** kopijos bei atkūrimo į izoliuotą projektą rezultatus. Prieš tai realių bylų GO = **NE**.

## 1. Architektūra ir saugumas

```
Kasdien 02:23 UTC – GitHub Actions (NE Netlify):
  GI Supabase [Postgres] -> roles.sql, schema.sql, data.sql, migrations
  GI Supabase [Storage]  -> visų bucket failų baitai + SHA-256
  Patikra -> .tar.gz -> age autentifikuotas šifravimas
  Atšifravimo patikra su laikinu vieno vykdymo raktu (neišsaugomas)
  -> Tik šifruotas .age failas:
      A) GitHub Actions Artifact (30 dienų; offsite nuo Supabase)
      B) GI Google Drive (pasirenkamas papildomas veidrodis per rclone)
  Klaida -> vienas GitHub Issue su nuoroda į nesėkmingą vykdymą
```

**GitHub saugykla yra vieša.** Artefaktas skelbiamas tik užšifruotas. Nepateikti jokių SQL, nuotraukų, Gmail ar gyventojų duomenų nei į saugyklos kodą, nei į Issues/logus. Šifravimo **privatus** `age` raktas negali būti saugomas tame pačiame GitHub projekte, pridėtas prie AI pokalbio ar įkeltas greta archyvų „Drive“.

Supabase Free plane automatinės kasdienės DB kopijos neįtrauktos; DB kopijos net Pro plane **neapima Storage objektų baitų**: [Supabase Backup](https://supabase.com/docs/guides/platform/backups). Todėl GI eksportuoja abu sluoksnius.

## 2. Vienkartinė konfigūracija (būtina)

**NENAUDOTI ChatGPT pokalbio slaptiems raktams įkelti.** GitHub repo: [Giriu-inspekcija/giriu-inspekcija-app](https://github.com/Giriu-inspekcija/giriu-inspekcija-app). Atverti **Settings → Secrets and variables → Actions**.

| Pavadinimas | Tipas | Turinio kilmė |
|---|---|---|
| `GI_BACKUP_DB_URL` | Secret | Supabase projekto `mkhxokzuietqgjdpkcqq` → **Connect** → Session pooler (5432) **Postgres URI** su DB slaptažodžiu. Specialius simbolius slaptažodyje užkoduoti URL formatu. |
| `GI_BACKUP_SERVICE_ROLE_KEY` | Secret | To paties Supabase projekto **Settings → API Keys → service_role/secret key**. Tai privilegijuotas raktas tik šiam serveriniam uždaviniui, ne į PWA naršyklės kodą. |
| `GI_BACKUP_AGE_RECIPIENT` | Variable (ne Secret) | **Viešasis** gavėjo raktas, prasidedantis `age1...`. Generuoti saugioje asmeninėje darbo vietoje. |

Asmeniniame kompiuteryje įdiegus `age`:

```bash
umask 077
age-keygen -o gi-recovery-identity.txt
age-keygen -y gi-recovery-identity.txt
```

Antrosios komandos rezultatą (`age1...`) įrašyti į GitHub **Variable**. Failą `gi-recovery-identity.txt` (su `AGE-SECRET-KEY-...`) saugiai laikyti nepriklausomai nuo GitHub ir GI Drive (pvz. užšifruotame slaptažodžių tvarkytuve ir vienoje atsarginėje neprisijungus saugomoje kopijoje). **Praradus privatų raktą, šifruotų archyvų atkurti nepavyks.** Jo niekur neskelbti ir nesiųsti į pokalbį.

Papildomam veidrodžiui GI Google Drive galima sukonfigūruoti *rclone* nuotolinį profilį pavadinimu **`gidrive`**. Jis turi turėti leidimą rašyti organizacijos aplanke [00_SIFRUOTOS_Supabase_atsargines_kopijos](https://drive.google.com/drive/folders/1_1ZxYmh5DehDWhezR4FN5eUms93YdVrM). Rclone konfigūracijos turinį (su OAuth arba service-account kredencialais) užkoduoti kaip base64 ir pridėti kaip **`GI_BACKUP_RCLONE_CONFIG_B64` GitHub Secret**. Be šios neprivalomos prieigos kopijos saugomos tik 30 dienų GitHub Artifacts; negalima teigti, kad kopijuojama į Drive. Visada duomenis „Drive“ saugoti užšifruotus.

## 3. Tikrinimas paleidžiant

1. Sujungti tik [PR #31](https://github.com/Giriu-inspekcija/giriu-inspekcija-app/pull/31), kai CI testai žali. Tai tik GitHub darbo failai, **nekeičiama Supabase schema ir nediegiama nauja PWA versija**; sujungiant naudoti `[skip netlify]` jei palaikoma.
2. Pridėti aukščiau išvardytus 3 privalomus GitHub įrašus (ir papildomą rclone, jei pageidaujama).
3. GitHub **Actions → GI encrypted daily Supabase backup (offsite) → Run workflow**. Patikrinti, ar vykdymas žalias.
4. Patikrinti, kad yra **ne 0 B** šifruotas `gi-supabase-...tar.gz.age` artefaktas ir, jei rclone prijungtas, analogiškas failas GI Drive. Jokio neužšifruoto `.sql`/nuotraukų archyvo nesiunčiame.
5. Parsisiųsti `.age` ir su **offline** tapatybės failu patikrinti:
   ```bash
   GI_AGE_IDENTITY=/saugus/kelias/gi-recovery-identity.txt bash scripts/gi_restore.sh ./gi-supabase-YYYYMMDDTHHMMSSZ.tar.gz.age --verify-only
   ```
   Patikra išskleidžia duomenis tik į laikiną kompiuterio aplanką, tikrina SQL failų SHA-256 ir visus priedus, jų niekur neįkelia.
6. Į atskirai sukurtą **tuščią izoliuotą Supabase** projektą (ne į `mkhxokzuietqgjdpkcqq`) atkurti SQL bei Storage. Komanda specialiai reikalauja aiškaus patvirtinimo:
   ```bash
   GI_AGE_IDENTITY=/saugus/kelias/gi-recovery-identity.txt \
   GI_RESTORE_CONFIRM=RESTORE_TO_ISOLATED_GI_TEST \
   GI_RESTORE_DB_URL='postgresql://...KITO PROJEKTO...' \
   GI_RESTORE_SUPABASE_URL='https://KITO-PROJEKTO-REF.supabase.co' \
   GI_RESTORE_SERVICE_ROLE_KEY='KITO-PROJEKTO-KLIENTUOSE-NENAUDOJAMAS-RAKTAS' \
   bash scripts/gi_restore.sh ./gi-supabase-YYYYMMDDTHHMMSSZ.tar.gz.age --restore-isolated
   ```
   **Atsargiai:** naujo projekto kaina ir raktai turi būti patvirtinti atskirai; šios komandos nevykdyti veikiantį GI projektą. Atsikūrus tikrinti autentiškumą, RLS, bylų skaičių, 10 priedų ir jų SHA-256; atkurti atskiras OAuth, SMTP, Netlify, webhooks ir integracijų konfigūracijas.
7. Tik po realaus atkūrimo iš atskiro archyvo užfiksuoti datą, RPO, RTO, atsakingą žmogų, kokie objektai atkurti ir kokios ribos liko.

## 4. Apribojimai

- **RPO tikslas:** iki 24 val. tarp kasdienių sėkmingų eksporto vykdymų. Tai ne garantija; vienas nesėkmingas vykdymas padidina laiką. **RTO nežinomas**, kol neišbandytas tikras atkūrimas.
- SQL eksportas ir Storage failų eksportas nėra viena atominė DB+Storage transakcija; failai gali keistis kopijavimo metu. Reikšmingoms byloms derinti stabilų kopijavimo laiką ir antrą patikrą.
- `schema.sql` pagal Supabase CLI gali neįtraukti valdomų `auth` ir `storage` schemų individualių pakeitimų. GI saugyklos migracijas reikia taikyti kartu, patikrinti `supabase_migrations`, o ne pasikliauti vien SQL eksportu.
- Neįeina: išorinės OAuth/SMTP prieigos, Netlify nustatymai, Google Drive failai už Supabase ribų, elektroninių parašų paslaugų raktai ar API Secrets. Juos dokumentuoti ir atkurti atskirai.
- Sėkmingas `age` failo atšifravimas **neįrodo pilno projekto atkūrimo**. Techninis GO tik po atskiro tikro atkūrimo ir saugumo testų.
- GitHub Actions Artifacts viešoje saugykloje gali būti parsisiunčiami asmenų su GitHub prieiga; konfidencialumą užtikrina **tik privatūs age raktai** ir šifravimas.
- `age` privataus rakto neatiduoti GitHub automatiniam restore; tai sumažina riziką, kad vienas pažeistas runner galėtų iššifruoti senas kopijas.
- Veikimo grafikas: 02:23 UTC kasdien. Nesėkmės atveju GitHub Issue `GI BACKUP FAILED` ir jo vykdymo nuoroda.

## 5. Kainų ir resursų logika

- Netlify: **0 deploy** šioje darbo sekoje.
- GitHub standartiniai Actions procesai viešoje saugykloje – įprastai nemokami, tačiau **saugomų artefaktų vieta** gali būti apmokestinama pagal GitHub sąskaitą/limitą. Dokumentacija: [GitHub Actions Billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) ir [Artifact retention](https://docs.github.com/en/actions/tutorials/store-and-share-data).
- Supabase Free: nėra automatinio kasdienio atkūrimo, bet galimas savarankiškas `db dump` eksportas.
- Google Drive: iš anksto turimą organizacijos vietą naudojame tik šifruotiems failams; automatiniam rclone reikia vienkartinės prieigos.
- Stebėti faktinį archyvo dydį ir kasdienės operacijos trukmę; prieš masinę realių bylų migraciją įvertinti bent 30 dienų laikomų kopijų vietos poreikį.

**Kritinis vartas:** kol nėra bent vienos tikros sėkmingos šifruotos DB + Storage kopijos ir vieno patvirtinto atkūrimo į atskirą projektą – GI realių bylų aktyvavimas yra NO-GO.

## 6. Etapinis taupus režimas (2026-11-24)
Kol kopija maža (2026-11-24 GitHub ZIP ~3,48 MB), palikti vieną pilną kasdienį DB + Storage archyvą. Tai paprasčiausias atkūrimas ir nekuria priklausomų grandinių. Storage egress įvertis = per dieną nuskaitytų Storage baitų × 31; tai ne visas faktinis Supabase egress (DB, vartotojai ir retry papildomai). Nuo 100 MB Storage vienam vykdymui perspėti, bet nestabdyti kopijų; patikrinti Supabase Usage ir ruoštis inkrementiniam objektų kopijavimui. Free egress 5 GB uncached ir 5 GB cached atskirai. https://supabase.com/docs/guides/platform/manage-your-usage/egress

Drive: naudoti dedikuotą ribotos narystės organizacijos Shared Drive (ne visiems savanoriams), tarnybinę tapatybę tik tai saugyklai; be domain-wide delegation. Workspace administratorius sukuria diską, patvirtina Gmail skaitytoją ir tarnybinį contributor. Rclone profilis gidrive su team_drive ir inline service_account_credentials arba dedikuotos paskyros OAuth su nuosavu Google OAuth klientu. Įvesti GitHub Secret GI_BACKUP_RCLONE_CONFIG_B64 ir Variable GI_BACKUP_DRIVE_FOLDER_ID (tikro paskirties aplanko ID), paleisti rankinį workflow, patikrinti rclone hash check ir failą Drive. Po sėkmės nustatyti GI_BACKUP_DRIVE_REQUIRED=true; jei Secret arba folder ID trūksta, workflow praneša klaidą. Dabartinis veidrodis be šių papildomų parametrų suderinamas su ankstesniu aplanku. https://rclone.org/drive/

Kol neatliktas pilnas izoliuotas atkūrimas, automatinio archyvų trynimo NĖRA. Po patvirtinto atkūrimo ir atskiro rotacijos PR: tikslas 7 dienos, 4 savaitės, 3 mėnesiai (iki 14 pilnų taškų; persidengimai mažina skaičių), pirmiausia dry-run, tik griežtai atpažįstami backup failai, ne kiti Drive dokumentai. GitHub 30 d. saugojimas nekeičiamas. Kai 100 MB riba artėja, atskiras inkrementinis etapas: kasdien pilnas SQL, Storage objektų nekintamos šifruotos versijos, šifruotas kiekvienos dienos manifestas su visų objektų nuorodomis ir kontrolinėmis sumomis; ištrinti tik nebereikalingus jokiam išlaikomam manifestui objektus. Neatsisakyti pilno formato, kol abu formatai sėkmingai atkurti izoliuotai. Jokių mokamų planų ar automatinio trynimo be atskiro patvirtinimo. Šis PR neįdiegia inkrementinės sistemos ir nekeičia duomenų bazės.
