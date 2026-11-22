# Girių inspekcija – augimo planas ir būsena (2026-11-22)

## Sprendimas
**Toliau naudoti Supabase/PostgreSQL, PWA ir organizacijos GitHub.** Šiuo etapu nestatyti atskiro serverio, neperkelti savanorių į naujas Google Workspace dėžutes. Pagrindinė programėlė lieka `Girių inspekcija`, atskira `/pilot/` sintetinė aplinka kol kas lieka PR #5.

## Paskyrų taisyklės
- Pagrindinis admin rezervuotas tik DB konfigūracijoje, aktyvuojamas po el. pašto patvirtinimo.
- Bandomoji atskira savanorio paskyra – ne admin.
- Koordinatorė Vilija gali patvirtinti naujus savanorius ir paskirstyti / patvirtinti darbų rezultatus. Administratoriaus teises teikia tik admin.
- Savanorio registracija be `@giriuinspekcija.lt` paskyros: vardas + jo el. paštas → patvirtinimo laiškas → slaptažodis → pending → koordinatoriaus arba admin patvirtinimas.
- NEBUVO patvirtinto realaus Auth prisijungimo / el. laiško testų; SMTP ir redirect nustatymai dar neužbaigti.

## Dabartinė technologinė architektūra
- Netlify: statinė, telefone įdiegiama PWA.
- Supabase Auth: naujų vartotojų tapatybė, 4 DB vaidmenys `pending/volunteer/coordinator/admin`.
- PostgreSQL: `gi_tasks`, `gi_profiles`, `gi_task_events`, `gi_role_events`, `gi_work_logs`, `gi_feedback`.
- Saugumas: RLS ir privatūs `SECURITY DEFINER` tik ten, kur būtina. Viešas RPC sluoksnis kaip `SECURITY INVOKER`.
- Puslapiavimas: serverio funkcija `gi_list_tasks_page` po 50 užduočių su `created_at/id` žymekliu. Vartotojų paieška pagal vardą iki 100 rezultatų viename paieškos žingsnyje.
- DI: koordinatoriaus peržiūrimas ChatGPT JSON importas į užduočių fondą. Tiesioginis automatinis DI API dar nesukurtas.
- Automatinis tikrinimas: atnaujinama sugrįžus į langą, be nuolatinio užklausų kas 30 s srauto.

## Mastelio etapai
| Apimtis | Kas keičiasi |
| --- | --- |
| 10–30 bandomųjų paskyrų | Free, tik sintetiniai duomenys, įjungtas custom SMTP ir realūs kelių paskyrų testai |
| 100–300 aktyvių savanorių | Dabartinė DB struktūra tinka, tačiau būtina suplanuoti nuolatines atsargines kopijas, stebėseną ir dėl patikimumo vertinti Pro. Neįjungti Pro automatiškai |
| 1 000 | Nuolatinė paslaugų našumo, SMTP, duomenų perdavimo, RLS, savanorių paieškos ir indeksų peržiūra; apkrovos testai |
| 10 000 | Nuo užduočių ir paskyrų lentelių atskirti didelius failus, GIS sluoksnius teikti kaip atskiras paslaugas/tiles; pagal apkrovą didinti DB compute, taikyti užklausų apribojimus, saugos auditus ir įvykių eilę |

Supabase 2026-11-22 oficialiai: Free – 50 000 monthly active users, 500 MB DB, 1 GB failų, 5 GB egress, projektas sustabdomas po savaitės be veiklos; Pro prasideda nuo **25 USD per mėnesį**, turi 8 GB įskaičiuotą diską ir atsargines kopijas (faktinė sąskaita priklauso nuo resursų). **MAU limitas nėra garantija dėl 10 000 tuo pačiu metu vykstančių veiksmų.**

Šaltinis: https://supabase.com/pricing

## Ką realiai išbandėme
- **Supabase Security Advisor:** 0 įspėjimų; **Health Advisor:** 0 įspėjimų.
- Performance Advisor: likę tik INFO `unused_index` (po naujų indeksų tai tikėtina, kol mažai realių duomenų); neužindeksuotų FK įspėjimai pašalinti.
- Admin ir coordinator vaidmenys abu gali priskirti užduotį; savanoris negali.
- Koordinatorius gali patvirtinti pending savanorį, negali kelti jo į coordinator/admin.
- 120 sintetinių paskirtų užduočių su dviem savanoriais: puslapiavimas tikrina 51 pirmoje ir 10 antroje; visų kitų savanorių darbai nematomi dėl RLS.
- 2 500 laikinų sintetinių užduočių bazės patikrai – visi įrašai atšaukti.
- Visi DB integraciniai testai buvo `ROLLBACK`. Pagrindinėje testinėje DB liko **3** sintetinės užduotys, 0 tikrų Auth paskyrų.

## Neįvykdyti būtini dalykai prieš viešą savanorių registraciją
1. Supabase Auth → **URL Configuration**: nustatyti tikslų bandomąjį `Site URL` ir leistinas redirect nuorodas į `https://deploy-preview-5--starlit-shortbread-a38110.netlify.app/pilot/`; produkcinę pridėti tik ją paskelbus.
2. Supabase Auth → **SMTP**: prijungti patikimą pašto siuntėją. Supabase Free numatytasis SMTP siunčia tik projekto komandos adresams, iki ~2 laiškų/val.; savanoriams neveiks.
3. Siuntėjas: jei galima saugiai panaudoti organizacijos patvirtintą Google Workspace SMTP, tai gali sumažinti papildomų paskyrų kiekį; kitu atveju registruoti Resend Free ir patvirtinti siuntimo subdomeno DNS įrašus. **Nekeisti organizacijos pagrindinio domeno pašto MX ar kitų reikalingų Workspace rekordų.**
4. Patikrinti el. laiško gavimą iš testinės paskyros, kuri nėra Supabase organizacijos narys, patvirtinti `Magic Link`, sukurti slaptažodį ir prisijungti pakartotinai.
5. Tik įrodžius pirmojo administratoriaus el. pašto nuosavybę, jis pats aktyvuoja Master. Po to užsiregistruoja bandomasis savanoris ir koordinatorė; patikrinti užduoties / pastabos eigą dviejose tikrose naršyklėse.
6. Peržiūrėti privatumo informaciją ir duomenų saugojimo taisykles prieš kviečiant platesnį savanorių ratą.
7. PR #5 į `main` tik po testų ir vadovo patvirtinimo. **Tikros GI bylos dar neleidžiamos.**

## Nepriklausomybė nuo tiekėjo
PostgreSQL schema ir migracijos išsaugotos GI GitHub; galima eksportuoti duomenis į įprastą PostgreSQL, Netlify pakeisti kitu HTTPS hostingu. DI/Codex gali rengti PR, tačiau automatinių jautrių pakeitimų nereikia publikuoti be patvirtinimo.

Nuorodos:
- https://github.com/Giriu-inspekcija/giriu-inspekcija-app/pull/5
- https://deploy-preview-5--starlit-shortbread-a38110.netlify.app/pilot/
- https://supabase.com/dashboard/project/mkhxokzuietqgjdpkcqq
- https://supabase.com/docs/guides/auth/auth-smtp
