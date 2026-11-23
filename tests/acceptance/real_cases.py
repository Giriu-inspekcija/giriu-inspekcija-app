"""Negative authorization / evidence checks for the isolated real-case schema only.
Never run this test against live GI data or the hosted Supabase project."""
import base64
import uuid
from pilot import BASE, KEY, REST, fixture, request, rows, http

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')

def exercise(chief_id,chief,coord,vol_id,vol):
    stranger_id,_,stranger=fixture('live-stranger')
    candidate_id,_,candidate=fixture('live-candidate')
    # No real identities: all synthetic fixtures, local disposable Supabase only.
    from pilot import sql
    sql(f"UPDATE public.gi_profiles SET role='volunteer' WHERE id='{stranger_id}'")
    internal_ref='GI-REAL-QA-'+uuid.uuid4().hex[:12]
    private_ref='GI-RESTRICTED-QA-'+uuid.uuid4().hex[:12]
    case_url=REST+'/gi_real_cases'
    def create(ref,sensitivity):
        request('POST',case_url,chief,{'external_ref':ref,'title':'Izoliuotas tikrinimo atvejis',
            'summary':'Tik sintetiniai testavimo duomenys be asmeninės informacijos.',
            'sensitivity':sensitivity,'opened_by':chief_id})
        return rows('gi_real_cases',chief,'select=id&external_ref=eq.'+ref)[0]['id']
    internal=create(internal_ref,'internal')
    restricted=create(private_ref,'restricted')
    assert len(rows('gi_real_cases',coord,'select=id'))==2
    assert rows('gi_real_cases',vol,'select=id')==[]
    assert rows('gi_real_cases',stranger,'select=id')==[]
    assert rows('gi_real_cases',candidate,'select=id')==[]
    request('POST',case_url,vol,{'external_ref':'GI-BLOCKED-'+uuid.uuid4().hex,
      'title':'Voluntary access escalation attempt','summary':'Must be denied by RLS',
      'opened_by':vol_id,'sensitivity':'internal'},expected={401,403})
    # Staff-granted membership is necessary, but not sufficient to access restricted cases.
    access_url=REST+'/gi_real_case_access'
    request('POST',access_url,chief,{'case_id':internal,'user_id':vol_id,
        'granted_by':chief_id,'can_upload':True})
    request('POST',access_url,chief,{'case_id':restricted,'user_id':vol_id,
        'granted_by':chief_id,'can_upload':True})
    visible=rows('gi_real_cases',vol,'select=id')
    assert visible==[{'id':internal}], visible
    assert rows('gi_real_cases',stranger,'select=id')==[]
    assert rows('gi_real_cases',candidate,'select=id')==[]
    # Row-level security applies also to direct API calls with guessed UUIDs.
    assert rows('gi_real_cases',vol,'select=id&id=eq.'+restricted)==[]
    assert rows('gi_real_case_access',vol,'select=user_id')==[
      {'user_id':vol_id},{'user_id':vol_id}]
    assert rows('gi_real_case_access',stranger,'select=user_id')==[]
    # Never allow a case initially marked restricted to be silently downgraded.
    request('PATCH',case_url+'?id=eq.'+restricted,chief,{'sensitivity':'internal'},expected={400,403})
    request('PATCH',case_url+'?id=eq.'+internal,vol,{'summary':'Attempt unauthorized change'},expected={401,403})
    request('DELETE',case_url+'?id=eq.'+internal,chief,expected={401,403,405})
    assert len(rows('gi_real_case_events',chief,'select=id&case_id=eq.'+internal))>=2

    def file_url(case,user):
        return BASE+'/storage/v1/object/gi-real-evidence/'+str(case)+'/'+str(user)+'/'+str(uuid.uuid4())+'.png'
    vfile=file_url(internal,vol_id)
    vheaders={'apikey':KEY,'Authorization':'Bearer '+vol,'Content-Type':'image/png'}
    upload=http.post(vfile,data=PNG,headers=vheaders,timeout=10)
    assert upload.ok,('volunteer upload failed',upload.status_code,upload.text[:180])
    foreign_headers={'apikey':KEY,'Authorization':'Bearer '+stranger,'Content-Type':'image/png'}
    assert http.get(vfile,headers=foreign_headers,timeout=10).status_code in (400,401,403,404)
    assert http.get(vfile,headers=vheaders,timeout=10).content==PNG
    # No public URL, no wildcard 'authenticated' access.
    assert not http.get(vfile,headers={'apikey':KEY},timeout=10).ok
    # Even with a membership row, restricted case evidence never becomes readable.
    rfile=file_url(restricted,vol_id)
    assert not http.post(rfile,data=PNG,headers=vheaders,timeout=10).ok
    # Revoked membership must remove both case and existing private file access.
    request('PATCH',access_url+'?case_id=eq.'+internal+'&user_id=eq.'+vol_id,
            chief,{'revoked_at':'2026-11-23T01:00:00+00:00'})
    assert rows('gi_real_cases',vol,'select=id')==[]
    assert not http.get(vfile,headers=vheaders,timeout=10).ok
    assert not http.post(file_url(internal,vol_id),data=PNG,headers=vheaders,timeout=10).ok
    assert rows('gi_real_case_events',vol,'select=id&case_id=eq.'+internal)==[]
    print('PASS real-case RLS: staff, approved volunteer, unrelated, candidate, restricted, revoked',flush=True)
    print('PASS private real evidence: upload, scoped read, no public read, revocation',flush=True)
