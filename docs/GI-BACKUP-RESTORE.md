# GI komanda – atsarginės kopijos ir atkūrimas

## Būsena 2026-11-27
**Pagrindinė atsarginių kopijų infrastruktūra veikia; realus izoliuotas atkūrimas patvirtintas.** 
- GitHub: kasdienis šifruotas eksportas, 30 dienų artefaktų saugojimas. [Patvirtintas ankstesnis vykdymas #45934019243](https://github.com/Giriu-inspekcija/giriu-inspekcija-app/actions/runs/45934019243).
- Google Drive: keyless WIF veidrodis įdiegtas [PR #79](https://github.com/Giriu-inspekcija/giriu-inspekcija-app/pull/79), 3/3 CI. Pirmas realus failas rastas per INFO Drive: [gi-supabase-20261127T191823Z.tar.gz.age](https://drive.google.com/file/d/1Fl0wy8RS3MYBXjK4jI9xTNj_w29LwXkb/view), 13 123 675 B, sukurtas 19:20:25 UTC. Paskirties aplankas patvirtintas. Naudotojas pranešė, kad vykdymas complete; konkretaus rankinio vykdymo ID, išvados ir SHA256 žingsnio žurnalo nepriklausomai gauti nepavyko (jungtis nerodo workflow_dispatch sąrašo).
- Realus atkūrimas iš 2026-11-27 03:25:26 UTC archyvo: PASS. 30/30 pagrindinių lentelių įrašų skaičiai, 14/14 RLS, 2/2 privatūs bucket, 2/2 atkurtų failų SHA256. Vietiniai admin, savanorio ir kandidato Auth/REST skaitymo testai PASS. Koordinatoriaus, MFA, slaptažodžio, išorinio OAuth, rašymo ir produkcinio prisijungimo testai neatlikti.
- Atkūrimo suderinamumo pataisa iš [PR #78](https://github.com/Giriu-inspekcija/giriu-inspekcija-app/pull/78) konsoliduota su naujausia versija. Ji neprivaloma įprastam kopijų eksportui; skirta tik izoliuotam atkūrimui su žinomu tuščio OAuth bloko nesuderinamumu. Originalus šifruotas archyvas nebuvo modifikuotas.
- Bendras realių bylų paleidimo saugumo vartas [#30](https://github.com/Giriu-inspekcija/giriu-inspekcija-app/issues/30) yra atskiras sprendimas. Ši infrastruktūra pati savaime nepatvirtina visų programėlės saugumo reikalavimų.

## 1. Kasdienė automatika
02:23 UTC (04:23 LT žiemą, 05:23 vasarą):
Supabase DB (SQL, Auth, migracijos) + Storage objektų baitai ir manifestas → SHA256 → age šifravimas → GitHub artefaktas (30 d.) → GI Shared Drive. Drive failo dydis, vieta ir SHA256 tikrinami vykdymo metu. Nesėkmės atveju GitHub registruojamas klaidos issue; jei Drive žingsnis nepavyksta po artefakto išsaugojimo, GitHub kopija lieka. Jokio automatinio Drive trynimo. Kompiuterio ar ChatGPT automatizacijos nereikia.

[Workflow](https://github.com/Giriu-inspekcija/giriu-inspekcija-app/actions/workflows/gi-encrypted-backup.yml) · [Drive aplankas](https://drive.google.com/drive/folders/1UuGP7gdRifvnzY_k0DYn8qbvtiCqCj_G) · [Darbo registras #32](https://github.com/Giriu-inspekcija/giriu-inspekcija-app/issues/32).

## 2. Autorizacija
Esami GitHub Secrets: GI_BACKUP_DB_URL ir GI_BACKUP_SERVICE_ROLE_KEY; Variable GI_BACKUP_AGE_RECIPIENT (tik viešasis age raktas). Google projektas gi-backup-516018, dedikuota gi-backup-writer techninė paskyra, WIF provider github-backup/github. OIDC apribotas GI organizacijos ID, repo ID, main šaka ir konkrečiu gi-encrypted-backup.yml workflow. Trumpalaikis Drive žetonas 1800 s; ilgalaikių JSON raktų kurti nereikia ir organizacijos draudimo nekeisti. Techninei paskyrai suteikiama tik dedikuoto Shared Drive Contributor prieiga; narystę administratorius periodiškai peržiūri. Senas rclone Secret/Variable metodas pakeistas; senesnės instrukcijos – Git istorijoje.

## 3. Atkūrimas nelaimės atveju
1. Pasirinkti naujausią patvirtintą šifruotą .age archyvą iš Drive arba GitHub ZIP (išskleisti tik ZIP, nešifruotų duomenų neplatinti). Privatus age raktas laikomas atskirai, ne GitHub ir ne greta kopijų. Saugoti antrą nepriklausomą užšifruotą rakto kopiją; jos buvimo auditas dar nepatvirtintas. Praradus raktą archyvai neatkuriami.
2. Patikrintoji aplinka: Windows 11 + WSL2 Ubuntu 24.04, Docker, Supabase CLI 3.4.0, PostgreSQL 17.12. Vietinis Linux diskas gali būti F diske. Naujas tuščias izoliuotas projektas, niekada produkcinė GI DB. Docker bridge host_binding_ipv4=127.0.0.1, patikrinti visus publikuotus portus. Patikrinti vietinį supabase_admin superuser ir tuščią public schemą.
3. `GI_AGE_IDENTITY=/saugus/raktas bash scripts/gi_restore.sh /kelias/kopija.tar.gz.age --verify-only`. Tada naudoti izoliuoto atkūrimo režimą su GI_RESTORE_CONFIRM=RESTORE_TO_ISOLATED_GI_TEST, GI_RESTORE_ALLOW_LOOPBACK=YES, tik vietiniais GI_RESTORE_DB_URL, GI_RESTORE_SUPABASE_URL ir GI_RESTORE_SERVICE_ROLE_KEY. Niekada nenaudoti produkcijos kredencialų. Patvirtinti archyvo SQL ir Storage kontrolines sumas.
4. Praktiniame teste PG 17.6 buvo nesuderinama su dump metaduomenimis; PG 17.12 ir vietinis supabase_admin išsprendė versijos/teisių klaidas. Vienas auth.custom_oauth_providers COPY blokas turėjo du naujesnius stulpelius, bet 0 įrašų; praleistas tik tas tuščias blokas laikinoje patikrintoje kopijoje. Atkūrimo skripto pasirinktinė pataisa `GI_RESTORE_ALLOW_EMPTY_OAUTH_COMPAT=YES` automatizuoja tik šį patikrintą atvejį; naudoti tik izoliuotoje aplinkoje po sėkmingų sujungto kodo testų. Netrinti netuščio bloko ar keisti originalaus archyvo. 2026-11-27 bandyme naudotas vietinis V3 atkūrimo skriptas.
5. Po atkūrimo palyginti pagrindinių lentelių skaičius, RLS, privačių bucket inventorių ir atgal perskaitytų failų SHA256. Patikrinti Auth/REST pagal vaidmenis, užfiksuoti išimtis. Atkūrimas į produkciją – atskiras patvirtintas incidento planas.
6. Baigus vietinį testą sustabdyti testinį Supabase. 2026-11-27 sustabdymas patvirtintas, Docker volume paliktas. Vietinės nešifruotos DB/SQL kopijos saugomos tik apsaugotame diske; pašalinti tik atskirai patvirtinus, išsaugojus šifruotą archyvą. Jokių globalių Docker prune komandų.

## 4. Ribos ir priežiūra
- RPO tikslas iki 24 h tarp sėkmingų kopijų; RTO tiksliai neišmatuotas. Duomenų bazės ir Storage eksportai nėra viena atominė transakcija.
- Neįeina visi išoriniai Google Drive dokumentai, Cloudflare Pages, išorinės OAuth/SMTP integracijų konfigūracijos, paslaugų raktai; juos dokumentuoti atskirai.
- Saugoti privatų age raktą ir jokiu būdu neskelbti nei nešifruotų duomenų, nei raktų viešame GitHub. Šifruoti artefaktai gali būti viešai pasiekiami pagal GitHub prieigos politiką.
- Stebėti GitHub nesėkmių pranešimus, kasdienę kopiją Drive, vietą ir Supabase egress. Virš 100 MB Storage vienam vykdymui – peržiūrėti sąnaudas ir planuoti inkrementinį eksportą. Papildomų mokamų paslaugų šiuo etapu neaktyvuota; faktinis naudojimas priklauso nuo planų ir limitų.
- Drive rotacija nėra įjungta. Būsimas 7 d./4 sav./3 mėn. modelis tik po atskiro patvirtinimo ir dry-run. Periodiškai pakartoti atkūrimą, ypač po schemos/versijos pasikeitimų.
