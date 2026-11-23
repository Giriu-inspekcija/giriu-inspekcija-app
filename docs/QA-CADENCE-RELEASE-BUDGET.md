# GI komanda – nebrangi automatinė kokybės priežiūra (2026-11)

## Tikslas
Aiškiai atskirti kodo / funkcinių scenarijų testavimą nuo AI audito ir Netlify produkcinio diegimo. Automatiniai testai niekada neturi kurti naujų produkcinių Netlify versijų.

## Veikimo grafikas
- Supabase: kas 15 min. pigus naujų savanorių pastabų SQL filtras (jau įdiegtas), ne AI.
- ChatGPT: kas valandą tik jei yra neperžiūrėtų pasiūlymų pagal `private.gi_ai_feedback_summary()`; be pasiūlymų nedaryti kodo analizės.
- GitHub Actions `ci.yml`: kas 12 val. (04:37 ir 16:37 UTC), taip pat kai keičiasi kodas: Node sintaksė ir `npm test`. Kodo nekeičia, Netlify nereikalinga.
- GitHub Actions `pilot-acceptance.yml`: pirmadienį, trečiadienį ir penktadienį 05:17 UTC: izoliuotas vietinis Supabase, Chromium/WebKit naršyklės ir naudotojo scenarijų testai. Jokio realių GI bylų ar produkcinio Supabase naudojimo.
- AI kokybės auditas: 1 kartas per savaitę (penktadienį nuo 10:00 LT) – **jau aktyvios valandinės ChatGPT automatikos viduje**, o ne nauja automatika (pasiektas paskyros 5 aktyvių automatikų limitas). Pigus pirmas SQL patikrinimas `private.gi_ai_feedback_summary()` pateikia `weekly_audit_due`; idempotentinis `private.gi_ai_weekly_audit_claim()` saugo nuo pakartotinio to paties savaitinio audito. Pirmą mėnesio penktadienį pridėti rinkos ir gerųjų praktikų peržiūrą; neskelbti nepatikrintų naujienų. Jei AI neturi grafinės naršyklės, remiasi CI rezultatais ir atvirai nurodo ribą.
- Netlify: diegti pagrindinę versiją įprastai daugiausia 1 kartą per savaitę, išskyrus patvirtintus kritinius P0/P1 sutrikimus, ir tik po testų bei žmogaus sprendimo. Didelius pakeitimus grupuoti.

## Ekonomika
Pagal Netlify kreditų planų dokumentaciją, production deploy 15 kreditų, o deploy preview/branch 0 kreditų (jei planas nesustabdytas dėl kitų viršytų limitų). Skirtingai nuo Netlify, GitHub standartiniai Actions runner'iai viešose saugyklose nemokami. Svetainės duomenų srautas ir užklausos gali kainuoti atskirus Netlify kreditus; nematuok naudodamas vien diegimų skaičių.

## Kokybės ir saugumo ribos
1. Statiniai Node testai negali įrodyti telefono programėlės UX. Browser acceptance įrodo testuojamus sintetinius scenarijus, ne visų tikrų prisijungimų ar aparatūros veikimą.
2. AI pats neturi teigti „išbandžiau iPhone“, jei atliko tik kodo skaitymą ar Playwright simuliaciją.
3. Viešoje GitHub saugykloje: jokios tikros asmeninės ar atvejų informacijos, paslapčių ir autentifikacijos tokenų.
4. Pataisymai atskirose šakose ir PR. Naujų branch commitų ar preview kiekis nėra lygus produkcinių deploy kiekiui; tik produkcijos sujungimai gali aktyvuoti mokamą Netlify publish.
5. Patikrinti GitHub Actions rezultatus, QA testų aprėptį ir rollback būdą prieš kiekvieną release. Produkcinių diegimų nereikia dėl kiekvienos dokumentacijos korekcijos – sugrupuoti.
6. Jei cron neveikia: patikrinti GitHub workflow teises / schedulerių statusą, nesiųsti išvados, kad testai įvyko, kol nepatvirtintas jų vykdymas.
7. Dokumentacijos ir procesų pakeitimams nerašyti AI API kredito be aiškaus poreikio; sudėtingų techninių klaidų AI analizę paleisti tik po nesėkmės.

## Metrikos
Kartą per savaitę: įvykdyti testai, nepraėję scenarijai, atvirų aukštos svarbos klaidų skaičius, PR skaičius, production deploy skaičius, Netlify kreditai, faktinės AI analizės sąnaudos jei matomos. Jei nėra patikimo sąnaudų šaltinio – nurodyti „nepatikrinta“.

## Valdymas ir vienkartinio diegimo taupymas
- Papildoma DB migracija `20261123014500_gi_ai_weekly_audit_gate.sql` yra realiai įdiegta Supabase ir išbandoma privačiu SQL; įprastas `gi-feedback-filter-15min` lieka aktyvus.
- Dėl ".github/workflows" ar dokumentacijos pakeitimų galime į GitHub sujungti PR su commit tekstu `[skip netlify]`. Netlify oficialiai palaiko tokį pranešimą, ir neturėtų kurti production deploy. Tai nepanaikina GitHub Actions testų ir nekeičia programėlės frontend failų.
- GitHub Actions schedule veikia tik tada, kai workflow jau yra default/main šakoje; PR su pakeitimais nėra aktyvus grafikas iki sujungimo.
