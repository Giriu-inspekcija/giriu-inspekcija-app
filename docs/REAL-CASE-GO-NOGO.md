# GI komanda — realių atvejų GO / NO-GO (2026-11-23)

## Sprendimas dabar
**NO-GO realių gyventojų/atvejų perkėlimui.** Įvykdytas tik saugios architektūros projektavimas ir izoliuotos testinės schemos parengimas; neišjungti `gi_tasks.is_demo=true` ir `gi_incidents.is_demo=true` apribojimai. Jokio gyventojo duomenų importo, viešo skelbimo, automatinio siuntimo ar naujų darbuotojų teisių.

## Kas jau įrodyta
- Dabartinėje Supabase `giriu-inspekcija-pilotas` užduotys ir pranešimai laikomi tik demonstraciniais (DB apribojimai).
- Greitieji Node testai pagrindinėje šakoje buvo sėkmingi; prieš realių atvejų migraciją būtini naujausių šakų testai ir sintetiniai Chrome/WebKit scenarijai.
- P0 pataisa, jei įrašymas serveryje pavyko, bet nepavyko rodinio atnaujinimas: GitHub PR #28 (testuojama).
- Naujasis atskiro realių atvejų modelio prototipas (šiame PR): `gi_real_cases`, `gi_real_case_access`, `gi_real_case_events`, privatus failų bucket `gi-real-evidence`. Visi sintetinių duomenų galiojantys apribojimai lieka.
- Atskiro prototipo RLS testai: administratorius/koordinatorius, savanoris tik su individualiu leidimu, pašalinis savanoris, kandidatas, ribotas atvejis, atšaukta prieiga, bylos priedai. Veikiantys testai yra `tests/acceptance/real_cases.py` ir paleidžiami tik su vienkartine lokalia Supabase.

## Patikrinta atsarginių kopijų rizika – SUSTABDYMO SĄLYGA
2026-11-23 Supabase `get_organization` parodė, kad GI projektas veikia **Free** plane. Oficialioje [Supabase atsarginių kopijų dokumentacijoje](https://supabase.com/docs/guides/platform/backups) nurodyta, kad automatinės kasdienės DB kopijos priskirtos Pro/Team/Enterprise, o Free naudotojai turi patys eksportuoti ir saugoti kopijas kitoje vietoje. **Net mokamas DB backup NEAPIMA Storage objektų baitų**, tik jų metaduomenis.

Prieš tikrus atvejus būtina:
- pasirinkti patikimą kasdienio PostgreSQL eksporto į atskirą saugyklą strategiją (arba Pro plano DB kopijas) ir atskirai apsaugoti Storage failus;
- patikrinti faktinį automatinį backup grafiką, stebėseną, šifravimą ir prieigos teises;
- izoliuotoje aplinkoje bent kartą pilnai atstatyti DB ir kelis originalius priedus bei sutikrinti sumas/hash;
- paskirti atsakingą asmenį ir nustatyti realius RPO/RTO. Kol tai neįrodyta – **NO-GO**.

## Kritiniai leidimo vartai
| # | GO kriterijus | Dabartinė būsena |
|---|---|---|
| 1 | 100 % Node ir naršyklės (Chrome/WebKit) kritinių scenarijų green | Testuojama PR #28 |
| 2 | P0 įrašymas neišduoda klaidingos nesėkmės, neveikia du kartus, nepraranda priedų | PR #28, galutinis telefoninis bandymas likęs |
| 3 | RLS cross-user, direct URL, storage, atšaukta prieiga — visi neigiami bandymai green | Šio PR testai; teigiamas rezultatas nereiškia realaus failų audito |
| 4 | Konfidencialūs pranešimai tik administratoriui / koordinatoriui, dalinimas išimtinai konkrečiam asmeniui | Prototipe suprojektuota; funkcionalus UI dar neįdiegtas |
| 5 | Tikra atkurta DB + privačių failų atsarginė kopija izoliuotoje aplinkoje; dokumentuotas RPO/RTO | Neatlikta — blokatorius |
| 6 | Nuotolinio prisijungimo politika, stiprūs slaptažodžiai, staff MFA; nutekėjusių slaptažodžių apsauga | Supabase advisor: leaked-password protection disabled; blokatorius |
| 7 | 3–5 tikrų atvejų skyrimo teisių ir saugojimo sutikimai, privatumo/duomenų tvarkymo procedūra | Neatlikta |
| 8 | Dokumentų versijos, pasirašymo/perdavimo registras, unikalūs atvejų ID, nėra dublikatų | Reikia patikrinti su „VISI atvejai“ ir „Raštų registras“; e. parašo automatikos nėra |
| 9 | Fizinis iOS ir Android bandymas (3 testuotojai), 4G nutrūkimas, GPS, failai, laikų formatas | Neatlikta |
| 10 | Aiškus rollback, release žurnalas, 7 dienų ribotas stebėjimas ir koordinatoriaus GO sprendimas | Parengti prieš publikavimą |

## Diegimo principai
1. Prieš pradžią aiškiai paskirti **duomenų valdytoją** GI viduje; kiekvienai bylai nurodyti jautrumo klasę, teisėtą tvarkymo pagrindą, teisių dalijimo kriterijus ir saugojimo terminą. GPS ir žmogaus kontaktai nėra „paprasti“ vieši atributai.
2. Produkcinį duomenų perkėlimą vykdyti **atskiru peržiūrėtu migracijos veiksmu**, tik turint patikrintą atstatymo galimybę. Kol kas GitHub viešoje saugykloje leidžiama tik schema ir sintetiniai testų duomenys.
3. Turimus registrus „VISI atvejai“, „Darbai ir užduotys“, „Raštų registras“, „Veiklos žurnalas“ laikyti šaltinio dokumentais, ne keisti juos be dvipusio suderinimo. Unikalus `external_ref` turi susieti įrašus ir užkirsti kelią pakartotiniams importams.
4. Iš pradžių naudoti tik personalizuotą prieigą 2–3 GI koordinatoriams prie 3–5 tikrų atvejų; savanoriams tik atskirai suteiktą teisę (ne automatiškai).
5. Patikrinti leidimus prieš atskleidžiant nuotraukas, skundų tekstus ir raštus, stebėti parsisiuntimus; failai visada privatūs. Papildomai suplanuoti failų tipų/virusų patikras ir EXIF privatumo politiką.
6. Teisinių raštų pasirašymą ir išsiuntimą kol kas atlikti per kontroliuojamus išorinius procesus; „Parengta“ negali reikšti „Išsiųsta“.
7. PR peržiūros ir CI testai neišleidžia naujos pagrindinės Netlify versijos. Vienas patvirtintas leidimas per savaitę, išskyrus kritinį P0 taisymą.

## Kaip atlikti realių duomenų migraciją vėliau
Atskirai užfiksuoti duomenų šaltinių revizijas, iš jų parengti eksportą prieigą turinčioje privačioje aplinkoje, sukurti susiejimo lentelę `(registras, source_id, gi_real_case_id)`, validuoti dublikatus, importuoti tik minimalius duomenis ir palyginti sumines metrikas prieš/po. Pradėti tik nuo 3–5 bylų, su aiškiu atstatymo planu. Neperrašyti šaltinio dokumentų.

## Realių duomenų paleidimo protokolas
**GO tik jei 1–10 punktai įrodyti ir nurodyti testų rezultatai/atsakingi.** Jei bent vienas kritinis punktas neįvykdytas – NO-GO. Savanorių priėmimo ir demonstracinės užduotys gali veikti atskirai nuo realios bylų dalies.
