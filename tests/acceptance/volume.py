"""Measure filtered keyset reads for distinct owners on the disposable SQL/HTTP stack."""
from concurrent.futures import ThreadPoolExecutor
from time import perf_counter
import math
import uuid
from pilot import sql,rpc

def measure(token):
    owners=[]
    for active in (20,100,300):
        new=[str(uuid.uuid4()) for _ in range(active-len(owners))]
        values=','.join("('%s'::uuid)"%u for u in new)
        sql(f"""INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data)
            SELECT id,'authenticated','authenticated',id::text||'@example.test',now(),now(),now(),'{{}}'::jsonb FROM (VALUES {values}) x(id);
            UPDATE public.gi_profiles SET role='volunteer' WHERE id IN (SELECT id FROM (VALUES {values}) x(id));
            INSERT INTO public.gi_tasks(title,details,priority,status,assigned_to)
            SELECT 'Apkrova '||n,'Sintetinė užduotis','normal','assigned',id FROM (VALUES {values}) x(id) CROSS JOIN generate_series(1,20) n;""")
        owners+=new
        def read(owner):
            start=perf_counter()
            page=rpc('gi_search_tasks_page',{'p_before_created_at':None,'p_before_id':None,'p_limit':51,
                'p_filter':'assigned','p_search':'Apkrova','p_owner':owner,'p_due_filter':'all'},token)
            assert len(page)==20 and all(t['assigned_to']==owner for t in page)
            return (perf_counter()-start)*1000
        with ThreadPoolExecutor(max_workers=10) as pool:
            times=sorted(pool.map(read,owners))
        print(f'PASS volume owners={active} tasks={active*20} parallel=10 HTTP_p95_ms={times[math.ceil(.95*active)-1]:.0f}',flush=True)
