"""Project defaults, real API, local disposable Supabase only."""
from datetime import date,timedelta
import uuid
from pilot import fixture,sql,rpc,rows,record,review,PASSWORD

def exercise():
    aid,admin_email,admin=fixture('project-admin')
    uid,vol_email,vol=fixture('project-volunteer')
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
    assign('Būsimas projektas',today+timedelta(days=1),None);check(log(today),'Kitas projektas')
    assign(None,None,None);check(log(today),None)
    return admin_email,vol_email,uid,today
    print('PASS automatic project by work date, no retroactive change, private admin defaults, override audit, retry, expiry/disable and replacement',flush=True)
def browser_check(admin_email,vol_email,uid,today):
    from functools import partial
    from http.server import ThreadingHTTPServer
    from pathlib import Path
    import os,threading
    from playwright.sync_api import sync_playwright,expect
    from screens import App
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(App,directory=os.getcwd()))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}/pilot/'
    sdk=Path(os.environ['GI_TEST_SDK']).read_text()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            def signin(email,device):
                ctx=browser.new_context(**p.devices[device],timezone_id='Europe/Vilnius',service_workers='block')
                ctx.route('https://cdn.jsdelivr.net/**',lambda route:route.fulfill(content_type='text/javascript',body=sdk))
                page=ctx.new_page()
                page.goto(base)
                page.locator('#email').fill(email);page.locator('#password').fill(PASSWORD)
                page.locator('#authSubmit').click()
                expect(page.locator('#tasksHeading')).to_be_visible()
                return ctx,page
            ac,ap=signin(admin_email,'Desktop Chrome')
            ap.locator('[data-nav=team]').click()
            f=ap.locator('form[data-project-default="'+uid+'"]')
            f.locator('..').locator('summary').click()
            f.locator('[name=project]').fill('ALF UI')
            f.locator('[name=start]').fill(today.isoformat())
            f.locator('[name=end]').fill(today.isoformat())
            f.get_by_role('button',name='Išsaugoti projektą').click()
            expect(f.locator('..').locator('summary')).to_contain_text('ALF UI')
            vc,vp=signin(vol_email,'Pixel 7')
            vp.locator('[data-nav=time]').click()
            vp.locator('#timeEntryPanel summary').click()
            expect(vp.locator('#timeProject')).to_have_count(0)
            vp.locator('#manualTimeActivity').fill('UI ALF bandymas')
            vp.locator('#manualTimeNote').fill('Bandomasis įrašas')
            vp.locator('#manualTimeForm button[type=submit]').click()
            expect(vp.locator('#workLogsList')).to_contain_text('UI ALF bandymas')
            assert sql(f"SELECT project_label FROM public.gi_work_logs WHERE volunteer_id='{uid}' AND activity_title='UI ALF bandymas'")=='ALF UI'
            vc.close()
            ap.locator('#refresh').click()
            ap.locator('[data-nav=team]').click()
            f=ap.locator('form[data-project-default="'+uid+'"]')
            if not f.is_visible(): f.locator('..').locator('summary').click()
            f.locator('[data-project-disable]').click()
            ap.locator('#decisionSubmit').click()
            expect(f.locator('..').locator('summary')).to_contain_text('Bendra veikla')
            ac.close();browser.close()
        print('PASS browser admin assignment, volunteer mobile form without project, persisted ALF and disable',flush=True)
    finally:
        server.shutdown()

if __name__=='__main__':
    import os
    args=exercise()
    if os.environ.get('QA_PROJECT_BROWSER'): browser_check(*args)
