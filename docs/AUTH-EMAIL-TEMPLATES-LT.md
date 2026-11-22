# Girių inspekcija — lietuviški patvirtinimo laiškai

**Būsena:** paruošti šablonai GitHub PR #5, tačiau **dar neįjungti Supabase Auth**. Jie pradės veikti tik įkėlus į Supabase → Authentication → Email Templates ir prijungus savo SMTP teikėją.

## Kodėl reikia savo SMTP?
Pagal oficialų Supabase pranešimą 2026-06-03 visi nauji nemokami projektai, kurie naudoja **numatytąjį Supabase SMTP**, negali redaguoti autentifikavimo laiškų šablonų. Mūsų Supabase projektas sukurtas 2026-11-22, todėl ši taisyklė taikoma. Su **nuosavu SMTP** galima keisti šablonus ir Free plane.

Šaltinis: https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier

## Kur įkelti
https://supabase.com/dashboard/project/mkhxokzuietqgjdpkcqq/auth/templates

| Supabase šablonas | Subject | HTML failas |
| --- | --- | --- |
| Confirm signup | `Patvirtinkite el. paštą – Girių inspekcija` | `supabase/email-templates/confirm-signup.html` |
| Magic link | `Jūsų prisijungimo nuoroda – Girių inspekcija` | `supabase/email-templates/magic-link.html` |

**Dėmesio:** `pilot/app.js` naudoja `signInWithOtp`. Priklausomai nuo registracijos situacijos Supabase gali siųsti *Confirm signup* arba *Magic link*. Todėl **būtinai atnaujinkite abu**.

HTML nuoroda įdėta taip: `href="{{ .ConfirmationURL }}"`. **Nepakeiskite šios išraiškos** į Netlify URL — ji yra vienkartinė saugi Supabase patvirtinimo / prisijungimo nuoroda.

## Veiksmai administratoriui / Work
1. Patvirtinti, kad Supabase Auth URL Configuration leidžia `https://deploy-preview-5--starlit-shortbread-a38110.netlify.app/pilot/` ir vėliau pagrindinį paskelbtą URL.
2. Supabase Auth → SMTP nustatymuose prijungti organizacijos valdomą pašto siuntėją (pvz., Resend Free arba turimą Workspace SMTP, jei tinka ir leidžiama pagal naudojimo sąlygas). **Jokių API raktų ir SMTP slaptažodžių į GitHub.**
3. Supabase Auth → Email Templates. Įklijuoti abu HTML failus, nustatyti aukščiau nurodytus subject.
4. Siuntėjo vardas SMTP: `Girių inspekcija`; siuntėjo adresas tik patvirtinto domeno, pvz., `registracija@notify.giriuinspekcija.lt` jei domenas tikrai sukonfigūruotas. Nebūtina kurti atskiros Google Workspace pašto dėžutės.
5. Patikrinti su bandomuoju naudotoju, kuris nėra Supabase organizacijos narys: ar atėjo *lietuviškas* laiškas, ar veikė `Patvirtinti el. paštą`, ar nuoroda teisingai grįžo į programėlę ir leido sukurti slaptažodį.
6. Išbandyti registracijos grįžimą po dviejų minučių ir paprastą prisijungimą su jau esama paskyra.
7. Tik po realaus testo kviesti naujus savanorius.

## GI logotipas
Šablonuose naudojamas PWA svetainės `https://starlit-shortbread-a38110.netlify.app/logo.png` vaizdo adresas. **Prieš viešą išsiuntimą patikrinti, ar gavėjo pašte jis pasiekiamas be prisijungimo ir tikrai yra galutinis GI logotipas**; jei ne, pakeisti patikimai viešai pasiekiamu organizacijos domeno HTTPS logotipo adresu. Net jei vaizdas blokuojamas, tekstinė antraštė „Girių inspekcija“ turi likti matoma.

## Ką laiškas žada ir ko ne
Šablonas sako „sveiki atvykę“ ir prašo patvirtinti **el. paštą**, bet **neteigia**, kad naujas žmogus jau priimtas kaip savanoris. Po patvirtinimo jis turi būti `pending` ir laukti koordinatoriaus sprendimo.

**Šis laiškų šablonų keitimas neįjungia SMTP, nekuria naujų paskyrų ir nekeičia `main` programėlės.**
