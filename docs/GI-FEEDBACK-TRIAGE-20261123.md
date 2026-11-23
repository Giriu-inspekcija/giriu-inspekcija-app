# GI komanda – naudotojų pastabų triage (2026-11-23)

Šaltinis: tiesioginė `Supabase public.gi_feedback` / `public.gi_feedback_review` peržiūra. 11 pastabų, 2026-11-22–23, iš jų keturios naujos 2026-11-23 apie 19:23–19:28 Vilniaus laiku. Visi įrašai pažymėti `is_demo=true`. Originalų neištrinti, realių duomenų iš jų nekurti.

## Įtraukiama į šį UX paketą
- **Istorija:** dabar buvo reikalingas papildomas „Rodyti / atnaujinti“ paspaudimas. Atidarius skiltį istorija užkraunama iš karto, rodomas kraunamas / klaidos / pakartojimo tekstas.
- **Užduoties paskirstymas:** kuriant naują demonstracinę užduotį pasirenkama „į fondą“, „tiesiai paskirti patvirtintam savanoriui“ arba „tik pasiūlymas“. Backend naudojami jau egzistuojantys, teises tikrinantys RPC. Jei vienas veiksmas nepraeina, užduoties šaltinio identifikatorius išsaugomas pakartojimui; nekurti dublikatų.
- **Pastabų dialogas:** telefono ekrane centrinis, nesusijęs su puslapio slinkimu. Prisijungęs savanoris gali atverti jį iš bet kurios skilties.
- **Įrašymo patikimumas:** serveriui patvirtinus pakeitimą, laikinai nepavykęs ekrano atnaujinimas nėra vadinamas nepavykusiu įrašymu. Mažiau pavojingų pakartotinių spaudimų.
- **PWA atnaujinimas:** pakeista cache versija, kad savanoriams neužstrigtų senas HTML/JS.

## Ankstesnės pastabos / priimta sprendimų kryptis
- Mobilus meniu, pasveikinimas ir šokinėjimas: jau buvo tvarkyta senesnėje versijoje; naujas mobilus patikrinimas būtinas, kad nesugrąžintume regresijų.
- Dokumentai iš „Google Drive“ šablonų su AI: **didesnis atskiras darbo srautas**, kur reikia šablonų šaltinių, peržiūros, prieigos teisių, dokumentų versijų ir pasirašymo; neprimesti netikros „AI generuoja“ funkcijos.
- „Savęs tobulinanti“ AI sistema: esama 15 min. cron pastabų eilė ir ChatGPT periodiniai darbai; leisti automatinį audito/PR rengimą, bet ne aklą produkcinių pakeitimų paleidimą.
- „Daugelis funkcijų neveikia“ – pernelyg bendra pastaba, reikia konkretaus reproducuojamo atvejo; neskelbti išspręsta be įrodymų.

## Svarbi riba
Čia tik sintetinė GI komandos pilotinė aplinka. Su realiais gyventojų duomenimis dar nedirbti. **Nė vienos pastabos nelaikyti galutinai išspręsta iki telefono bandymo.** Atskiras PR #35 nėra šio UX paketo dalis.
