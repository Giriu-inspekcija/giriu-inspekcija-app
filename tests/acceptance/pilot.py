"""Run against a disposable loopback Supabase stack, with a real mail sink and PostgREST."""
import json
import os
import re
import secrets
import subprocess
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from html import unescape
from urllib.parse import parse_qs, urlparse
import requests

def local_url(name, fallback=''):
    value = os.environ.get(name, fallback).rstrip('/')
    if urlparse(value).hostname not in ('127.0.0.1', 'localhost'):
        raise ValueError(f'{name} must point to disposable local infrastructure')
    return value

BASE = local_url('API_URL')
AUTH = local_url('QA_AUTH', BASE+'/auth/v1')
REST = local_url('QA_REST', BASE+'/rest/v1')
MAIL = local_url('QA_MAIL', 'http://127.0.0.1:54324')
DB = local_url('DB_URL')
KEY = os.environ['ANON_KEY']
ADMIN = os.environ['SERVICE_ROLE_KEY']
RUN = uuid.uuid4().hex[:12]
PASSWORD = secrets.token_urlsafe(22)
http = requests.Session()
http.trust_env = False

def request(method,url,token=None,body=None,expected=None):
    headers={'apikey':KEY}
    if token: headers['Authorization']='Bearer '+token
    response=http.request(method,url,headers=headers,json=body,timeout=15)
    if expected is not None:
        assert response.status_code in expected,(urlparse(url).path,response.status_code)
    elif not response.ok:
        raise AssertionError((urlparse(url).path,response.status_code,response.text[:350]))
    return response.json() if response.content and response.headers.get('Content-Type','').startswith('application/json') else None

def rpc(name,params,token,expected=None):
    return request('POST',REST+'/rpc/'+name,token,params,expected)

def rows(table,token,query):
    return request('GET',REST+'/'+table+'?'+query,token)

def sql(query):
    return subprocess.check_output(['psql',DB,'-XAtq','-v','ON_ERROR_STOP=1','-c',query],text=True).strip()

def login(email):
    return request('POST',AUTH+'/token?grant_type=password',None,{'email':email,'password':PASSWORD})['access_token']

def fixture(label):
    email=f'gi-{label}-{RUN}@example.test'
    user=request('POST',AUTH+'/admin/users',ADMIN,{'email':email,'password':PASSWORD,'email_confirm':True,
        'user_metadata':{'full_name':'QA '+label}})
    return str(uuid.UUID(user['id'])),email,login(email)

def confirm_local_email(email,kind):
    for attempt in range(40):
        mailbox=http.get(MAIL+'/api/v1/messages',timeout=4).json()['messages']
        for message in mailbox:
            if not any(p['Address']==email for p in message['To']):
                continue
            body=http.get(MAIL+'/api/v1/message/'+message['ID'],timeout=5).json()['HTML']
            for raw in re.findall(r'href="([^"]+)"',body):
                link=urlparse(unescape(raw))
                if 'verify' in link.path and parse_qs(link.query).get('type')==[kind]:
                    return http.get(AUTH+'/verify?'+link.query,allow_redirects=False,timeout=8)
        time.sleep(.25)
    raise AssertionError('Local '+kind+' email missing')

def register(chief):
    email=f'gi-volunteer-{RUN}@example.test'
    user=request('POST',AUTH+'/signup',None,{'email':email,'password':PASSWORD,
        'data':{'full_name':'QA savanoris','membership_intent':'existing_volunteer'}})
    uid=str(uuid.UUID(user['id']))
    rpc('gi_approve_volunteer',{'p_user':uid},chief,{400,403})
    confirmed=confirm_local_email(email,'signup')
    assert confirmed.status_code in (302,303) and 'error=' not in confirmed.headers['Location']
    token=login(email)
    assert rows('gi_profiles',token,'select=role')==[{'role':'pending'}]
    assert rows('gi_tasks',token,'select=id')==[]
    assert rows('gi_profiles',chief,'select=role&id=eq.'+uid)==[{'role':'pending'}]
    rpc('gi_approve_volunteer',{'p_user':uid},chief)
    token=login(email)
    assert rows('gi_profiles',token,'select=role')==[{'role':'volunteer'}]
    return uid,email,token

def submit(token,ref,deadline=None):
    return rpc('gi_submit_task',{'p_source_ref':RUN+'-'+ref,'p_title':'QA '+ref,
        'p_details':'Sintetinis patikros darbas','p_priority':'high','p_due':deadline},token)

def step(task,action,token,note=None):
    return rpc('gi_task_action',{'p_id':task,'p_action':action,'p_note':note},token)

def record(token,task=None,project=None,request_id=None):
    return rpc('gi_record_dated_time',{'p_date':(date.today()-timedelta(days=1)).isoformat(),
        'p_request':request_id,'p_general':project is None,'p_project':project,'p_minutes':90,'p_task_id':task,
        'p_activity_title':None if task else 'Demonstracinis papildomas darbas','p_note':'Patikrintas testo įrašas'},token)

def review(token,log,expected=None):
    return rpc('gi_review_work_log',{'p_id':log,'p_action':'approve','p_note':None},token,expected)

def main():
    chief_id,chief_email,chief=fixture('chief')
    coord_id,coord_email,coord=fixture('coordinator')
    other_id,_,other=fixture('other-staff')
    sql(f"UPDATE public.gi_profiles SET role='admin' WHERE id='{chief_id}';"
        f"UPDATE public.gi_profiles SET role='coordinator' WHERE id IN ('{coord_id}','{other_id}');"
        f"INSERT INTO private.gi_time_reviewers VALUES ('chief','{chief_id}');"
        f"INSERT INTO private.gi_reviewer_nomination(appointment,email) VALUES ('coordinator','{coord_email}')")
    assert rpc('gi_reviewer_candidate',{},chief)==coord_id
    rpc('gi_appoint_reviewer',{'p_user':coord_id},other,{400,403})
    rpc('gi_appoint_reviewer',{'p_user':other_id},chief,{400,403})
    rpc('gi_appoint_reviewer',{'p_user':coord_id},chief)
    assert rpc('gi_reviewer_candidate',{},chief) is None
    uid,email,vol=register(chief)
    print('PASS A registration, local email, confirmation, approval, login and RLS',flush=True)
    due=(datetime.now(timezone.utc)+timedelta(days=7)).replace(second=0,microsecond=0).isoformat()
    task=submit(chief,'deleguota',due)
    assert str(uuid.UUID(task))==submit(chief,'deleguota',due)
    assert rows('gi_tasks',chief,'select=status&id=eq.'+task)==[{'status':'proposed'}]
    assert len(rows('gi_task_events',chief,'select=id&action=eq.propose&task_id=eq.'+task))==1
    print('PASS I authenticated REST submission, stable ID and one draft',flush=True)
    step(task,'publish',chief)
    rpc('gi_assign_task',{'p_id':task,'p_volunteer':uid},chief)
    saved=rows('gi_tasks',login(email),'select=due_at,status&id=eq.'+task)[0]
    assert datetime.fromisoformat(saved['due_at'])==datetime.fromisoformat(due) and saved['status']=='assigned'
    step(task,'accept',vol);step(task,'start',vol)
    criteria={'p_before_created_at':None,'p_before_id':None,'p_limit':15,'p_filter':'assigned',
        'p_search':'deleguota','p_owner':uid,'p_due_filter':'week'}
    assert [t['id'] for t in rpc('gi_search_tasks_page',criteria,vol)]==[task]
    print('PASS B assign, new password session reread, accept, start and server filters',flush=True)
    log=record(vol,task)
    step(task,'submit',vol,'Pateiktas bandomasis rezultatas.')
    assert rpc('gi_approve_result_with_time',{'p_task_id':task},chief)==1
    assert rows('gi_tasks',chief,'select=status&id=eq.'+task)==[{'status':'approved'}]
    assert rows('gi_work_logs',vol,'select=minutes,review_status&id=eq.'+log)==[{'minutes':90,'review_status':'approved'}]
    print('PASS C atomic result and 90-minute approval',flush=True)
    own=submit(chief,'savo');step(own,'publish',chief);step(own,'claim',chief);step(own,'accept',chief);step(own,'start',chief)
    ownlog=record(chief,own);review(chief,ownlog)
    assert sql(f"SELECT self_review FROM private.gi_time_review_events WHERE log_id='{ownlog}'")=='t'
    funded=record(chief,own,'Bandomasis projektas');review(chief,funded,{400,403})
    print('PASS D chief self-review, audit and funded self-review restriction',flush=True)
    independent=record(vol)
    review(other,independent,{400,403});review(coord,independent)
    coordinator_hours=record(coord);review(coord,coordinator_hours,{400,403});review(chief,coordinator_hours)
    print('PASS E appointed coordinator reviews volunteer only; chief reviews coordinator',flush=True)
    assert rows('gi_work_logs',vol,'select=task_id,minutes,review_status&id=eq.'+independent)==[
        {'task_id':None,'minutes':90,'review_status':'approved'}]
    print('PASS F standalone activity and review',flush=True)
    key=str(uuid.uuid4())
    first=record(vol,request_id=key)
    assert record(vol,request_id=key)==first
    assert rows('gi_work_logs',vol,'select=id&request_id=eq.'+key)==[{'id':first}]
    updated={'p_id':own,'p_expected':None,'p_due':due}
    rpc('gi_change_task_due',updated,chief);rpc('gi_change_task_due',updated,chief)
    rpc('gi_change_task_due',dict(updated,p_due=None),chief,{400})
    rpc('gi_change_task_due',dict(updated,p_due=None,p_expected=due),chief)
    assert rows('gi_tasks',chief,'select=due_at&id=eq.'+own)==[{'due_at':None}]
    assert rpc('gi_my_time_totals',{},vol)[0]['approved']==180
    project_log=record(vol,project='ALF TEST / V2.1')
    review(chief,project_log)
    record(vol,project='ALF TEST / V2.1') # intentionally unapproved
    print('PASS retries, concurrent deadline edit rejection, clearing and full time totals',flush=True)
    from workflows import case_and_document
    case_and_document(chief,coord,vol,other,uid)
    # The recovery link comes from the local mail sink, independent of the signup link.
    request('POST',AUTH+'/recover',None,{'email':email})
    recovery=confirm_local_email(email,'recovery')
    assert recovery.status_code in (302,303)
    token=parse_qs(urlparse(recovery.headers['Location']).fragment)['access_token'][0]
    password=secrets.token_urlsafe(24)
    request('PUT',AUTH+'/user',token,{'password':password})
    request('POST',AUTH+'/token?grant_type=password',None,{'email':email,'password':PASSWORD},{400,401})
    signed=request('POST',AUTH+'/token?grant_type=password',None,{'email':email,'password':password})
    assert signed['user']['id']==uid
    print('PASS isolated password recovery email, password change and fresh login',flush=True)
    if os.environ.get('QA_VOLUME'):
        from volume import measure
        measure(chief)
    return chief_email

if __name__=='__main__':
    user=main()
    if os.environ.get('QA_BROWSER'):
        from screens import exercise
        exercise(user,PASSWORD)
