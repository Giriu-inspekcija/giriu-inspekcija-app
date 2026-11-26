"""Project defaults, real API, local disposable Supabase only."""
from datetime import date,timedelta
import uuid
from pilot import fixture,sql,rpc,rows,record,review

def exercise():
    aid,_,admin=fixture('project-admin')
    uid,_,vol=fixture('project-volunteer')
    vid,_,other=fixture('project-other')
    sql(f"UPDATE public.gi_profiles SET role='admin' WHERE id='{aid}';"
        f"UPDATE public.gi_profiles SET role='volunteer' WHERE id IN ('{uid}','{vid}');"
        f"INSERT INTO private.gi_time_reviewers VALUES ('chief','{aid}') ON CONFLICT DO NOTHING")
    today=date.fromisoformat(sql("SELECT (now() AT TIME ZONE 'Europe/Vilnius')::date"))
    yesterday=today-timedelta(days=1)
    def assign(label,start,end,token=admin,expected=None):
        return rpc('gi_set_time_project_default',{'p_user':uid,'p_project':label,'p_start':start.isoformat() if start else None,'p_end':end.isoformat() if end else None},token,expected)
    def log(day,token=vol,key=None):
        return rpc('gi_record_dated_time',{'p_date':day.isoformat(),'p_request':key or str(uuid.uuid4()),'p_general':True,'p_project':None,'p_minutes':75,'p_task_id':None,
            'p_activity_title':'Projekto testas','p_note':'Sintetiniai duomenys'},token)
    def check(id,label,state='submitted'):
        assert rows('gi_work_logs',admin,'select=project_label,general_activity,review_status&id=eq.'+id)==[{'project_label':label,'general_activity':label is None,'review_status':state}]
    prior=log(yesterday);check(prior,None)
    assign('ALF',yesterday,today,vol,{400,403})
    rpc('gi_get_time_project_defaults',{},vol,{400,403})
    assign('ALF',yesterday,today)
    assert rpc('gi_get_time_project_defaults',{},admin)==[{'user_id':uid,'project_label':'ALF','starts_on':yesterday.isoformat(),'ends_on':today.isoformat()}]
    key=str(uuid.uuid4());a=log(yesterday,key=key);check(a,'ALF');check(prior,None)
    b=log(today);check(b,'ALF');check(log(today,other),None)
    check(log(yesterday-timedelta(days=1)),None)
    rpc('gi_override_time_project',{'p_id':a,'p_project':None},vol,{400,403})
    rpc('gi_override_time_project',{'p_id':a,'p_project':None},admin);check(a,None)
    assert log(yesterday,key=key)==a
    assert sql(f"SELECT count(*) FROM private.gi_time_project_changes WHERE log_id='{a}'")=='1'
    review(admin,b);check(b,'ALF','approved')
    rpc('gi_override_time_project',{'p_id':b,'p_project':None},admin,{400,403})
    assign(None,None,None);check(b,'ALF','approved');check(log(today),None);check(log(yesterday),'ALF')
    assert rpc('gi_get_time_project_defaults',{},admin)==[]
    assign('Kitas projektas',today,today);check(log(today),'Kitas projektas')
    print('PASS automatic project by work date, no retroactive change, private admin defaults, override audit, retry, expiry/disable and replacement',flush=True)
if __name__=='__main__':
    exercise()
