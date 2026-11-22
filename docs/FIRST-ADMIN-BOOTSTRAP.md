# Pirmojo GI administratoriaus paskyrimas (tik po tapatybės patvirtinimo)

Šis dokumentas skirtas tik **testiniam** Supabase projektui `mkhxokzuietqgjdpkcqq`.
Šiuo metu **nėra jokio master/admin naudotojo**.

## Būtina prieš vykdant

1. GI vadovas aiškiai patvirtina tikslų el. pašto adresą, kuriam suteikti administratoriaus teises (neužtenka vien ekrano nuotraukos).
2. Naudotojas **pats** registruojasi per Supabase Auth / programėlę ir patvirtina savo el. paštą.
3. Įsitikinti, kad `auth.users.email_confirmed_at` nėra NULL.
4. Patikrinti, kad `gi_profiles.role = 'pending'` ir nėra jau kito pirmojo administratoriaus.
5. Tik tada atlikti vienkartinį teisių suteikimą (saugioje administratoriaus SQL sesijoje, ne klientiniame JS).

## Patikros SQL (read-only)

```sql
select u.id, u.email, (u.email_confirmed_at is not null) as confirmed, p.role
from auth.users u
join public.gi_profiles p on p.id = u.id
where u.email = '<TIKSLUS_VADOVO_PATVIRTINTAS_ADRESAS>';
```

## Vienkartinis paskyrimas

Šį SQL galima vykdyti **tik po atskiro, aiškaus vadovo patvirtinimo**.
Vykdytojas pakeičia vienintelį el. pašto placeholder'į tikslia patvirtinta reikšme.

```sql
do $$
declare v_user uuid;
declare v_old_role text;
begin
  if exists(select 1 from public.gi_profiles where role='admin') then
    raise exception 'GI admin already exists; stop bootstrap';
  end if;
  select u.id, p.role into v_user, v_old_role
  from auth.users u join public.gi_profiles p on p.id=u.id
  where u.email='<TIKSLUS_VADOVO_PATVIRTINTAS_ADRESAS>'
    and u.email_confirmed_at is not null
  for update of p;
  if v_user is null or v_old_role <> 'pending' then
    raise exception 'User not found, unverified or not pending';
  end if;
  update public.gi_profiles set role='admin' where id=v_user;
  insert into public.gi_role_events(actor_id,target_id,former_role,new_role)
  values(null,v_user,v_old_role,'admin');
end $$;
```

## Po to
- Prisijungti prie programėlės tuo **pačiu** Auth naudotoju, iš naujo atnaujinti puslapį.
- Matyti administratoriaus valdymo skiltį, bet neskirti tikrų GI bylų.
- Vėliau pridėti antrą patikimą organizacijos administratorių per programėlės teisių valdymą.

**Svarbu:** jei naudoji `laurynas@giriuinspekcija.lt` kaip el. paštą, tai dar nėra įrodymas, kad ši paskyra turi būti vadovo paskyra. Organizacijos vadovas turi patvirtinti konkretų adresą. Esamos Google Workspace paskyros teisių tai nekeičia.
