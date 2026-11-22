# „Girių inspekcija“ – kandidatai, patirties laipsniai ir advokacijos DI modulis
*Darbinis saugaus diegimo aprašas · 2026-11-22*

## 1. Priimtas principas
**Atskirkite registracijos pasirinkimą, realią rolę, savanorio patirties laipsnį ir specialius leidimus.** Jokie savanorio įrašomi laukai nepakelia teisių.

| Sritis | Galimos reikšmės | Kas nustato |
|---|---|---|
| Registracijos pasirinkimas (`membership_intent`) | naujas kandidatas, jau GI savanoriauja | Pats žmogus, tik informacija peržiūrai |
| Faktinė rolė (`role`) | pending, candidate, volunteer, coordinator, admin | Koordinatorius / Master, tik po peržiūros |
| Patirties laipsnis (`volunteer_rank`) | pradedantysis, patyręs, vyriausias, regiono vadas | Master; tai nėra sistemos teisė |
| Dokumentų rengimas (`can_prepare_documents`) | true/false | Master konkrečiam patvirtintam savanoriui; koordinatorius ir Master turi teisę pagal savo rolę |
| Regionas (`region_label`) | laisvas savanorio pasirinkimas | Informacinis laukas, ne teisių ribojimas |

**„Regiono vadas“** pirmame pilote yra atskirai patvirtinamas laipsnis, bet dar ne automatinė prieiga prie visų regiono bylų. Pastarajai reikia patikimų ribų ir atskiro leidimų modelio (naudotojas→regionas→bylos klasifikacija).

## 2. Kandidato kelias
Registracija → el. pašto patvirtinimas → laukia peržiūros (`pending`) → koordinatorius patvirtina `candidate` → kandidatas gauna tik su `candidate_safe=true` pažymėtą, jam paskirtą sintetinę `field_visit/training/other` užduotį → pateikia tekstinį rezultatą ir savanoriškas minutes → koordinatorius patvirtina → po praktikos gali pakelti iki `volunteer`.

Nauja kandidatų nuotraukų/GPS funkcija registruota GitHub issue #6. **Kol ji neįdiegta ir nepatikrinta, neteikti tikrų koordinatinių / pranešėjų duomenų.**

## 3. Tikrų GI raštų rengimo šablonai: patikrinti šaltiniai
Organizacijos Drive buvo rasti ir perskaityti:
- **„GI rašto šablonas“**: organizacijos rekvizitų ir dokumento struktūros ruošinys: adresatas, dokumento data ir numeris, dalykas, rašto tekstas, pasirašantis asmuo.
- **„GI teisėkūros rašto užklausa ChatGPT“**: V2.1 rengimo eiga, prasidedanti teisėkūros projekto, TAIS terminų ir priedų patikra; sprendimas **TEIKTI / NETEIKTI / REIKIA DUOMENŲ**, esamos GI bylos Drive paieška, teisinė argumentacija, patikrinami šaltiniai, redaguojamas dokumento projektas ir įgaliotas žmogaus patvirtinimas.

Šių dokumentų **turinys ir vidinės nuorodos neperkeliamos į viešą GitHub ir neindeksuojamos automatiškai**. Prieš integraciją reikia patvirtinti, kuris šablonas yra aktualios redakcijos.

## 4. DI darbo grandinė (sekantis įgyvendinimo etapas)
`Patvirtintas asmuo → pasirenkamas atvejis/TAIS → teisėmis patikrinta Drive šaltinių paieška → DI siūlo sprendimą, ar verta rengti → koordinatoriaus patvirtinimas → juodraštis pagal GI šabloną → žmogaus redagavimas → atskira peržiūra → patvirtinta pasirašymui → žmogus pasirašo → atskirai patvirtintas išsiuntimas.`

Ribos:
1. **Jokio OpenAI API rakto kliento `pilot/app.js` arba GitHub.** Tik serverinė Edge Function / kita uždara API su Supabase JWT patikra ir kiekvienos užklausos `gi_can_prepare_documents` autorizacija.
2. **Nesuteikti viso GI Drive visiems**: serverinis Google Drive konektorius tik į atskirai leidžiamus šablonus / konkrečios bylos failus. Pirmas pilotas tik su sintetiniais arba aiškiai viešais dokumentais.
3. ChatGPT paskyros pokalbio atmintis nėra programėlės API žinių bazė. GI dokumentų kontekstas turi ateiti iš teisėmis valdomo Drive / patvirtintos dokumentų paieškos.
4. OpenAI **Responses API** su išlaidų ribomis; `file_search` ar kita RAG paieška tik su dokumentų ACL kontrole, neskleidžiant pranešėjų tapatybių ir jautrių taškų. Vienas visiems matomas vektorių indeksas **netinka**, kol nėra veikiančio prieigos filtravimo.
5. AI sukurto rašto išvadose pateikti šaltinių nuorodas ir atskiras `NEPATIKRINTA` vietas; teisinius straipsnius ir įstatymų redakcijas tikrinti oficialiuose šaltiniuose.
6. AI **negali** automatiškai suteikti prieigų, įkelti pasirašyto dokumento kaip galutinio be tikrinimo, pasirašyti ar siųsti institucijoms.
7. Versijos, autorius, recenzentas, pastabos, šablono versija, dokumento šaltiniai, tokenai ir API išlaidos turi būti registruojami; patvirtinus galima eksportuoti redaguojamą Google Doc.

## 5. Technikos ir finansų prioritetai
- Dabar: rolės, kandidato užduotys, anketos patikra – DB + PWA su tuo pačiu Supabase Free.
- Toliau: įrodymų failų upload / GPS su privačiu Storage (issue #6), tada dokumentų darbo eiga (issue #7).
- OpenAI API ir dokumentų indeksavimas turi kintamą kainą. Pradinis pilotas: vienas šablonas, viena teisėkūros bylos sintetinė kopija, aiškus vadovo patvirtintas mėnesio limitas.
- Didelių privačių Drive kopijų, automatinio GI bylų importo ir pilno el. parašo API **nesiūlyti šiame etape**.

## 6. Realus dabartinis statusas
- Supabase pilota turi `candidate` rolę, pasirinktį `new_candidate/existing_volunteer`, RLS, savanorių laipsnius ir `can_prepare_documents` flagą.
- Koordinatorius ir Master gali skirstyti užduotis, patvirtinti kandidatus ir rezultatus. Master papildomai valdo laipsnius ir dokumentų rengimo leidimus.
- RLS / RPC testai atlikti su laikinais sintetiniais naudotojais, `ROLLBACK` užtikrino, kad neatsirado tikrų testinių paskyrų.
- **Dar neįjungta** tikrų savanorių el. pašto registracija per SMTP; todėl nei fizinio telefono Auth, nei Drive+OpenAI API juodraščių modulis kol kas neveikia.
- Tikroji programa `main` nekeista; viskas PR #5 peržiūroje.

## Nuorodos
- GitHub issue #6: kandidatų GPS / privačios nuotraukos.
- GitHub issue #7: DI + šablonai + peržiūra + pasirašymas.
- Official docs: https://supabase.com/docs/guides/database/postgres/row-level-security
- Official OpenAI: https://developers.openai.com/api/docs/guides/tools-file-search
