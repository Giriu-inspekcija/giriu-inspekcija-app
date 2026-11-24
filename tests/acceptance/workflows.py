import base64
import uuid
from datetime import datetime, timezone
from pilot import BASE,KEY,REST,http,rows,rpc,sql,request

def case_and_document(chief,coord,reporter,other_staff,owner_id):
    incident=str(uuid.uuid4())
    fields={'p_id':incident,'p_description':'Išgalvota vieta ir sukurta iliustracija',
            'p_category':'tree_damage','p_event_state':'needs_check','p_lat':0,'p_lon':0}
    draft={**fields,'p_observed':datetime.now(timezone.utc).isoformat()}
    assert rpc('gi_incident_draft',draft,reporter)==incident
    bucket=BASE+'/storage/v1/object/gi-pilot-incident-photos/'+incident
    png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')
    def upload(slot):
        return http.post(bucket+'/'+slot,data=png,headers={'apikey':KEY,'Authorization':'Bearer '+reporter,
                         'Content-Type':'image/png'},timeout=8)
    def download(slot,token):
        return http.get(bucket+'/'+slot,headers={'apikey':KEY,'Authorization':'Bearer '+token},timeout=8)
    for i in range(1,11):
        result=upload(f'{i:02d}')
        assert result.ok,(result.status_code,result.text[:180])
    assert not upload('11').ok
    assert not download('01',coord).ok
    assert rpc('gi_save_incident',{**fields,'p_submit':True},reporter)==incident
    assert download('10',coord).content==png
    case=rpc('gi_open_case',{'p_incident':incident},coord)
    assert rpc('gi_open_case',{'p_incident':incident},coord)==case
    params={'p_case':case,'p_ref':'check','p_title':'Patikrinti vietą','p_details':'Bandomoji atvejo patikra'}
    task=rpc('gi_case_task',params,coord)
    assert rpc('gi_case_task',params,coord)==task
    assert rows('gi_tasks',chief,'select=case_id&id=eq.'+task)==[{'case_id':case}]
    print('PASS G incident, 10 private images, staff review, linked case and task',flush=True)

    from pilot import fixture
    helper_id,_,helper=fixture('thread-helper')
    rpc('gi_approve_volunteer',{'p_user':helper_id},chief)
    endpoint=REST+'/gi_thread_entries'
    q='select=kind&incident_id=eq.'+incident
    assert rows('gi_incidents',helper,'select=id&id=eq.'+incident)==[]
    delegated=rpc('gi_delegate_incident',{'p_incident':incident,'p_ref':'delegation-test','p_details':'Patikrinti leidimus ir vietą','p_volunteer':helper_id},coord)
    assert rows('gi_incidents',helper,'select=id&id=eq.'+incident)==[{'id':incident}]
    assert download('01',helper).ok
    assert rows('gi_cases',helper,'select=id&id=eq.'+case)==[{'id':case}]
    rpc('gi_task_action',{'p_id':delegated,'p_action':'unassign','p_note':None},coord)
    assert rows('gi_incidents',helper,'select=id&id=eq.'+incident)==[]
    assert not download('01',helper).ok
    rpc('gi_set_team_visibility',{'p_kind':'incident','p_id':incident,'p_visible':True},coord)
    assert rows('gi_cases',helper,'select=id&id=eq.'+case)==[{'id':case}]
    assert download('01',helper).ok
    request('POST',endpoint,helper,{'incident_id':incident,'kind':'help'})
    request('POST',endpoint,helper,{'incident_id':incident,'kind':'help'},{409})
    entry=str(uuid.uuid4())
    object_name=f'{helper_id}/incident/{incident}/{entry}.png'
    file_url=BASE+'/storage/v1/object/gi-thread-files/'+object_name
    headers={'apikey':KEY,'Authorization':'Bearer '+helper,'Content-Type':'image/png'}
    upload=http.post(file_url,headers=headers,data=png,timeout=10)
    assert upload.ok,(upload.status_code,upload.text[:240])
    request('POST',endpoint,helper,{'id':entry,'incident_id':incident,'kind':'note','body':'Vietos papildymas',
        'attachment':object_name,'filename':'vietos-vaizdas.png'})
    assert http.get(file_url,headers={'apikey':KEY,'Authorization':'Bearer '+reporter},timeout=10).content==png
    assert len(rows('gi_thread_entries',reporter,q))==3
    assert rows('gi_tasks',helper,'select=id&id=eq.'+task)==[]
    rpc('gi_set_team_visibility',{'p_kind':'task','p_id':task,'p_visible':True},coord)
    request('POST',endpoint,helper,{'task_id':task,'kind':'note','body':'Papildoma užduoties informacija'})
    assert len(rows('gi_thread_entries',helper,'select=id&task_id=eq.'+task))==2
    rpc('gi_set_team_visibility',{'p_kind':'incident','p_id':incident,'p_visible':False},coord)
    assert rows('gi_thread_entries',helper,q)==[]
    assert not http.get(file_url,headers=headers,timeout=10).ok
    request('POST',endpoint,helper,{'incident_id':incident,'kind':'note','body':'Test'},{401,403})
    print('PASS restricted and shared threads, case link, helpers, contextual file and visibility revocation',flush=True)

    doc=str(uuid.uuid4())
    params={'p_id':doc,'p_revision':0,'p_action':'create','p_title':'Patikros pažyma',
            'p_body':'Išgalvoti patikros faktai','p_case':case,'p_task':task}
    rpc('gi_document_step',params,reporter,{400,403})
    assert rpc('gi_document_step',params,coord)==doc
    assert rows('gi_documents',reporter,'select=id&id=eq.'+doc)==[]
    # Staff explicitly share the entire incident context, including its document drafts and versions.
    doc_q='select=id&id=eq.'+doc
    versions_q='select=revision&document_id=eq.'+doc
    assert rows('gi_documents',helper,doc_q)==[]
    assert rows('gi_document_versions',helper,versions_q)==[]
    rpc('gi_set_team_visibility',{'p_kind':'incident','p_id':incident,'p_visible':True},chief)
    for reader in (reporter,helper):
        assert rows('gi_documents',reader,doc_q)==[{'id':doc}]
        assert rows('gi_document_versions',reader,versions_q)==[{'revision':1}]
        rpc('gi_document_step',dict(params,p_revision=1,p_action='save'),reader,{400,403})
    rpc('gi_set_team_visibility',{'p_kind':'incident','p_id':incident,'p_visible':False},chief)
    for reader in (reporter,helper):
        assert rows('gi_documents',reader,doc_q)==[]
        assert rows('gi_document_versions',reader,versions_q)==[]
    # An explicitly assigned volunteer retains only the assigned incident context.
    delegated_doc=rpc('gi_delegate_incident',{'p_incident':incident,'p_ref':'delegation-document-test','p_details':'Patikrinti susietus dokumentus','p_volunteer':helper_id},coord)
    assert rows('gi_documents',helper,doc_q)==[{'id':doc}]
    assert rows('gi_document_versions',helper,versions_q)==[{'revision':1}]
    rpc('gi_task_action',{'p_id':delegated_doc,'p_action':'unassign','p_note':None},coord)
    assert rows('gi_documents',helper,doc_q)==[]
    assert rows('gi_document_versions',helper,versions_q)==[]
    print('PASS explicit team sharing and assignment include case documents and versions, revocation removes access',flush=True)
    def action(rev,step,token,expected=None,**extra):
        return rpc('gi_document_step',{'p_id':doc,'p_revision':rev,'p_action':step,**extra},token,expected)
    action(1,'submit',coord,p_body='Pirmoji bandomoji redakcija')
    action(2,'approve',coord,{400,403})
    action(2,'return',chief,p_note='Patikslinkite datą')
    action(3,'submit',coord,p_body='Patikslinta bandomoji redakcija')
    action(4,'approve',chief)
    for forbidden in ('signed','sent'):
        action(5,forbidden,chief,{400,403})
    assert rows('gi_documents',coord,'select=phase,revision&id=eq.'+doc)==[{'phase':'ready','revision':5}]
    assert len(rows('gi_document_versions',chief,'select=revision&document_id=eq.'+doc))==5
    print('PASS H draft, independent return, revision, ready to sign; signed/sent actions unavailable',flush=True)

    message='Bandomoji pastaba '+str(uuid.uuid4())
    for body in (message,message.upper()):
        request('POST',REST+'/gi_feedback',reporter,{'reporter_id':owner_id,'category':'klaida','message':body})
    queue=rows('gi_feedback_review',chief,'select=id,reports,gi_feedback!example_id(message)&order=last_report_at.desc&limit=1')[0]
    assert queue['reports']==2 and queue['gi_feedback']['message']==message
    assert not rows('gi_feedback_review',reporter,'select=id')
    review_args={'p_id':queue['id'],'p_action':'task','p_title':'Patikrinti formą','p_note':'Peržiūrėti demonstracinį formos elgesį','p_priority':'normal'}
    task=rpc('gi_review_feedback_group',review_args,chief)
    assert rpc('gi_review_feedback_group',review_args,chief)==task
    rpc('gi_review_feedback_group',dict(review_args,p_action='resolve',p_note='Pakartotinai patikrinta'),chief)
    assert rows('gi_feedback_review',chief,'select=task_id,resolution&id=eq.'+queue['id'])==[{'task_id':task,'resolution':'Pakartotinai patikrinta'}]
    counts=rpc('gi_deadline_counts',{},chief)[0]
    assert 'overdue' in counts and 'upcoming' in counts
    print('PASS feedback grouping, internal task, restricted visibility, resolution and deadline counts',flush=True)
