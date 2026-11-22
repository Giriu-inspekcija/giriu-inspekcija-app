import base64
import uuid
from datetime import datetime, timezone
from pilot import BASE,KEY,http,rows,rpc,sql

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

    doc=str(uuid.uuid4())
    params={'p_id':doc,'p_revision':0,'p_action':'create','p_title':'Patikros pažyma',
            'p_body':'Išgalvoti patikros faktai','p_case':case,'p_task':task}
    rpc('gi_document_step',params,reporter,{400,403})
    assert rpc('gi_document_step',params,coord)==doc
    assert rows('gi_documents',reporter,'select=id&id=eq.'+doc)==[]
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
