# ChatGPT → „GI komanda“: tiesioginiai užduočių pasiūlymai

## Tikslas ir būsena
Nereikia kopijuoti JSON į programėlę. ChatGPT su **prijungta organizacijos Supabase prieiga** gali perduoti pasiūlymus į pilotinį `gi_tasks`. Pasiūlymai lieka `status='proposed'`, nepasiekia savanorių fondo ir nėra priskiriami tol, kol patvirtintas koordinatorius jų nepatvirtina programėlėje.

Tai **pilotinis sintetinių duomenų** procesas. NENAUDOTI tikrų atvejų, GPS, asmens duomenų ar nepatikrintų teiginių kaip realios veiklos užduočių, kol nepatvirtinta produkcinė duomenų ir teisių architektūra.

## Koordinatoriaus eiga
1. ChatGPT pasakykite: „Pateik šias užduotis GI komandai“, aprašykite darbus. Patikrinkite, ką siūloma pateikti; ChatGPT gali rašyti tiesiai **tik** jeigu šiame pokalbyje yra prijungta GI Supabase.
2. ChatGPT įrašo kiekvieną pasiūlymą per **Supabase prijungtą duomenų bazės įrankį**, panaudodamas jau egzistuojančią `private.gi_agent_propose(p_payload jsonb)`. Ši funkcija nėra anoniminis viešasis API ir nėra paleidžiama iš nesaugaus kliento.
3. Atsidarykite `/pilot/` → **Darbai** → **ChatGPT pasiūlymai**, pasirinkite „Atnaujinti pasiūlymus“, jeigu sąrašas neatnaujintas.
4. Matysite pavadinimą, aprašymą, svarbą, terminą. Paspauskite **Patvirtinti į fondą** ir patvirtinkite.
5. Programėlė per esamą autentifikuotą `public.gi_task_action(p_action='publish')` pakeičia būseną į `pool`. Tik tuomet užduotis patenka į fondą; vykdytojas nepriskiriamas automatiškai.

Kai ryšio su GI Supabase nėra, ChatGPT **neturi teigti, kad užduotis įrašyta**. Galima naudoti suskleistą atsarginį rankinį importą (paprastos eilutės arba JSON).

## Tiesioginio įrašymo kontraktas
Pasiūlymo payload:
```json
{
  "source_ref": "agent:gi-example-20261123-01",
  "title": "Patikrinti bandomąją užduočių perdavimo eigą",
  "details": "Tik sintetinėje sistemoje patikrinti pasiūlymo atvaizdavimą, koordinatoriaus patvirtinimą ir atsiradimą fonde.",
  "priority": "low"
}
```
`due_at` neprivalomas, leidžiamas ISO 8601 su laiko juosta, pvz. `2026-12-01T12:00:00+02:00`. `priority` — `low`, `normal` arba `high`. `source_ref` turi būti pastovus, unikalus ir prasidėti `agent:`; pakartotinis to paties payload siuntimas saugiai grąžina tą patį ID. Keičiant jau panaudotą `source_ref` turinį funkcija atmeta operaciją.

Saugus MCP administratoriaus pavyzdys (ne naršyklėje):
```sql
select private.gi_agent_propose(
  '{"source_ref":"agent:gi-example-20261123-01","title":"Patikrinti bandomąją užduočių perdavimo eigą","details":"Tik sintetinėje sistemoje patikrinti pasiūlymo atvaizdavimą, koordinatoriaus patvirtinimą ir atsiradimą fonde.","priority":"low"}'::jsonb
);
```
Daugeliui pasiūlymų naudoti **atskiras funkcijos invokacijas**, užfiksuoti kiekvienos grąžintą ID ir tik tada pranešti ChatGPT naudotojui apie įrašymo sėkmę. Netaisyti `gi_tasks` tiesiogiai ir nepublikuoti iš agento — leidimą publikuoti duoda programėlės koordinatorius.

## Saugumas ir tikrinimas
- `gi_tasks` RLS jau skiria darbuotojo ir savanorio teises; naujas sąrašas skaitomas tik su koordinatoriaus sesija.
- Automatinio priskyrimo, publikavimo, specialių anon API raktų ar service-role rakto kliento kode **nėra**.
- Programėlėje naudoti duomenys HTML-escapinami, tikrinami ir `publish` vykdomas per jau veikiantį serverio RPC.
- Vienu metu rodomi iki 30 naujausių laukiančių ChatGPT pasiūlymų; sistemos paieška / kitų užduočių filtrai šio sąrašo neslepia.
- Prieš pradėdami naudoti su realiais GI atvejais atskirai patvirtinkite duomenų klasifikavimą, skirtingų šaltinių teises ir realios produkcijos migracijos planą.
