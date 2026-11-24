"""Exercise the actual PWA against the disposable Supabase API in three browser contexts."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright, expect
from pilot import BASE, KEY

class App(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0]=='/pilot/app.js':
            body=Path('pilot/app.js').read_text()
            # Only the loopback copy is pointed at the isolated Auth/PostgREST stack.
            import re
            body=re.sub(r"const URL = '[^']+';",f"const URL = '{BASE}';",body,count=1)
            body=re.sub(r"const KEY = '[^']+';",f"const KEY = '{KEY}';",body,count=1)
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.end_headers()
            self.wfile.write(body.encode());return
        super().do_GET()

    def log_message(self,*args):
        pass

def exercise(user,password):
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(App,directory=os.getcwd()))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}/pilot/'
    tomorrow=datetime.now(ZoneInfo('Europe/Vilnius'))+timedelta(days=2)
    date=tomorrow.strftime('%Y-%m-%d')
    sdk=Path(os.environ['GI_TEST_SDK']).read_text()
    try:
        with sync_playwright() as p:
            for name,engine,device,zone in [
                ('desktop',p.chromium,'Desktop Chrome','America/Los_Angeles'),
                ('android',p.chromium,'Pixel 7','Asia/Tokyo'),
                ('iphone',p.webkit,'iPhone 13','Europe/Vilnius')
            ]:
                browser=engine.launch()
                ctx=browser.new_context(**p.devices[device],timezone_id=zone,service_workers='block')
                ctx.route('https://cdn.jsdelivr.net/**',lambda route:route.fulfill(content_type='text/javascript',body=sdk))
                page=ctx.new_page();page.on('dialog',lambda d:d.accept())
                def sign_in():
                    page.goto(base)
                    page.locator('#email').fill(user);page.locator('#password').fill(password)
                    page.locator('#authSubmit').click()
                    expect(page.locator('#tasksHeading')).to_be_visible()
                sign_in()
                title='Naršyklės terminas '+name
                page.get_by_text('Sukurti naują bandomąją užduotį',exact=True).click()
                form=page.locator('#proposalForm')
                form.locator('[name=title]').fill(title)
                form.locator('[name=details]').fill('Demonstracinė užduoties termino patikra.')
                form.locator('[name=due]').fill(date+'T09:05')
                form.locator('button').click()
                card=page.locator('article.task').filter(has=page.get_by_role('heading',name=title,exact=True))
                expect(card).to_contain_text('09:05')
                # The coordinator's secondary actions are intentionally collapsed on mobile.
                management=card.locator('details[data-ui-key^="manage-"]')
                if management.count() and not management.is_visible():
                    raise AssertionError('Task management toggle must be visible')
                if management.count() and not management.evaluate('(element) => element.open'):
                    management.locator(':scope > summary').click()
                card.get_by_text('Keisti terminą',exact=True).click()
                field=card.get_by_label('Užduoties terminas')
                expect(field).to_have_value(date+'T09:05')
                field.fill(date+'T18:45')
                # Re-fetch with a focused date input, as happens after a mobile sync.
                # The field, draft date and viewport must not jump or lose focus.
                before=field.evaluate("""el => {
                    el.focus({preventScroll:true});
                    return {scroll:scrollY,top:el.getBoundingClientRect().top};
                }""")
                page.evaluate("""() => {
                    window.__giOldTaskCard=document.querySelector('#taskList article.task');
                    document.querySelector('#refresh').click();
                }""")
                page.wait_for_function(
                    "() => window.__giOldTaskCard !== document.querySelector('#taskList article.task')",
                    timeout=20000)
                expect(field).to_have_value(date+'T18:45')
                expect(field).to_be_focused()
                after=field.evaluate(
                    "el => ({scroll:scrollY,top:el.getBoundingClientRect().top})")
                assert abs(after['top']-before['top'])<18, (
                    'Focus/viewport jumped during refresh '+name+': '+str((before,after)))
                deadline_requests=[]
                page.on('request',lambda req: deadline_requests.append(1) if '/rpc/gi_change_task_due' in req.url else None)
                save=card.get_by_role('button',name='Išsaugoti terminą')
                save.evaluate('(button)=>{button.click();button.click()}')
                expect(card).to_contain_text('18:45')
                assert len(deadline_requests)==1
                # A fresh context enforces a new password login and a DB reread.
                ctx.close()
                ctx=browser.new_context(**p.devices[device],timezone_id=zone,service_workers='block')
                ctx.route('https://cdn.jsdelivr.net/**',lambda route:route.fulfill(content_type='text/javascript',body=sdk))
                page=ctx.new_page();page.on('dialog',lambda d:d.accept())
                sign_in()
                card=page.locator('article.task').filter(has=page.get_by_role('heading',name=title,exact=True))
                expect(card).to_contain_text('18:45')
                # The coordinator's secondary actions are intentionally collapsed on mobile.
                management=card.locator('details[data-ui-key^="manage-"]')
                if management.count() and not management.is_visible():
                    raise AssertionError('Task management toggle must be visible')
                if management.count() and not management.evaluate('(element) => element.open'):
                    management.locator(':scope > summary').click()
                card.get_by_text('Keisti terminą',exact=True).click()
                due_button=card.get_by_role('button',name='Išsaugoti terminą')
                field=card.get_by_label('Užduoties terminas')
                field.fill('')
                due_button.click()
                expect(page.locator('#actionToast')).to_contain_text('Pasirinkite datą')
                field.fill(date+'T19:30')
                page.route('**/rpc/gi_change_task_due',lambda route:route.abort())
                due_button.click()
                expect(page.locator('#actionToast')).to_contain_text('Nepavyko')
                expect(field).to_have_value(date+'T19:30')
                page.unroute('**/rpc/gi_change_task_due')
                card.get_by_role('button',name='Pašalinti terminą').click()
                page.locator('#decisionSubmit').click()
                expect(card.get_by_text('Nustatyti terminą',exact=True)).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow '+name
                print('PASS browser '+name+' create, edit, fresh login, validation, network failure and clear',flush=True)
                # v25: a proposed task can be assigned directly from the card without publishing first.
                expect(page.locator('#appVersion')).to_have_text('v26')
                proposal_title='Tiesioginis paskyrimas '+name
                create=page.locator('#proposalForm')
                if not create.is_visible():
                    page.get_by_text('Sukurti naują bandomąją užduotį',exact=True).click()
                create.locator('[name=title]').fill(proposal_title)
                create.locator('[name=details]').fill('Sintetinė tiesioginio paskyrimo patikra.')
                create.locator('[name=destination]').select_option('proposed')
                create.locator('button[type=submit]').click()
                direct=page.locator('#taskList article.task').filter(has=page.get_by_role('heading',name=proposal_title,exact=True))
                expect(direct.locator('[data-assign-self]')).to_be_visible()
                expect(direct.locator('summary[aria-label="Priskirti savanoriui"]')).to_be_visible()
                direct.locator('[data-assign-self]').click()
                expect(direct).to_contain_text('Paskirta man')
                expect(direct.locator('[data-assign-self]')).to_have_count(0)
                expect(direct.locator('[data-step="accept"]')).to_be_visible()
                expect(direct.locator('[data-time-for-task]')).to_be_visible()
                expect(direct.locator('[data-step="decline"]')).to_be_hidden()
                expect(direct.locator('.task-overflow > summary')).to_be_visible()
                direct.locator('.task-overflow > summary').click()
                expect(direct.locator('[data-step="decline"]')).to_be_visible()
                direct.locator('.task-overflow > summary').click()
                expect(direct.locator('[data-step="decline"]')).to_be_hidden()
                if name!='desktop':
                    a=direct.locator('[data-step="accept"]').bounding_box()
                    b=direct.locator('[data-time-for-task]').bounding_box()
                    assert abs(a['y']-b['y'])<3, 'Primary actions must fit one mobile row'
                print('PASS browser '+name+' visible version and direct proposed assignment',flush=True)
                if name=='desktop':
                    test_forms(page)
                    page.route('**/rest/v1/gi_profiles?**',lambda route:route.fulfill(status=401,
                        content_type='application/json',body='{"message":"JWT expired"}'))
                    page.locator('[data-nav=tasks]').click()
                    page.locator('#refresh').click()
                    expect(page.locator('#notice')).to_contain_text('Prisijungimo laikas baigėsi')
                    expect(page.locator('#workspace')).to_be_hidden()
                    page.unroute('**/rest/v1/gi_profiles?**')
                    ctx.clear_cookies()
                    page.evaluate('localStorage.clear()')
                    page.goto(base)
                    page.locator('#showSignup').click()
                    field=page.locator('#email')
                    field.fill('neteisingas-adresas')
                    assert not field.evaluate('(field)=>field.checkValidity()')
                    print('PASS J double click, invalid date/email, disconnected API, simulated expired session and role denials')
                browser.close()
    finally:
        server.shutdown()

def test_forms(page):
    import base64
    import io
    import zipfile
    from xml.etree import ElementTree
    expect(page.locator('#documentsNav')).to_be_visible()
    page.get_by_text('Atsarginis rankinis užduočių importas',exact=True).click()
    page.locator('#batchJson').fill('Palyginti išvykos schemas – sutikrinti žemėlapį')
    page.locator('#batchPreview').click()
    expect(page.locator('#batchReview')).to_contain_text('Palyginti išvykos schemas')
    expect(page.locator('#batchImport')).to_be_enabled()
    for attempt in range(2):
        if attempt:
            page.locator('#batchJson').fill('Palyginti išvykos schemas – sutikrinti žemėlapį')
            page.locator('#batchPreview').click()
        page.locator('#batchImport').click()
        expect(page.locator('#notice')).to_contain_text('Užduotys jau yra fonde.')
        expect(page.locator('#taskList h3').filter(has_text='Palyginti išvykos schemas')).to_have_count(1)
    page.locator('#captureIncident').click()
    page.locator('#incidentDescription').fill('Naršyklės demonstracinė patikra')
    page.locator('#incidentCoords').fill('0.0, 0.0')
    page.locator('#incidentPhotos').set_input_files({'name':'test.png','mimeType':'image/png',
        'buffer':base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')})
    send=page.get_by_role('button',name='Pateikti pranešimą')
    assert send.evaluate("(b)=>{b.click();return b.disabled && b.getAttribute('aria-busy')==='true' && b.textContent==='Pateikiama…'}")
    incident=page.locator('#incidentsList article').filter(has_text='Naršyklės demonstracinė patikra')
    expect(incident).to_contain_text('Pateikta')
    incident.get_by_role('button',name='Nuotraukos').click()
    expect(incident.locator('img')).to_have_count(1)
    incident.get_by_role('button',name='Pradėti atvejo patikrą').click()
    incident.locator('summary').click()
    form=incident.locator('form')
    form.locator('[name=title]').fill('Naršyklės atvejo užduotis')
    form.locator('[name=details]').fill('Peržiūrėti demonstracinį atvejį')
    form.locator('button').click()
    expect(page.locator('#actionToast')).to_contain_text('Užduotis sukurta')
    incident.get_by_role('link',name='Atverti kortelę ir istoriją').click()
    thread=page.locator('#threadDialog')
    expect(thread).to_contain_text('Pradėta atvejo patikra')
    expect(thread).to_contain_text('Naršyklės atvejo užduotis')
    thread.locator('[data-do=help]').click()
    expect(thread).to_contain_text('Prisijungė padėti')
    thread.locator('[name=body]').fill('Savanoris papildė patikros istoriją.')
    thread.get_by_role('button',name='Paskelbti papildymą').click()
    expect(thread.locator('.thread-history')).to_contain_text('Savanoris papildė patikros istoriją.')
    page.reload()
    expect(thread.locator('.thread-history')).to_contain_text('Savanoris papildė patikros istoriją.')
    # The identity provider returns to the allowlisted path without query parameters.
    page.evaluate("""() => sessionStorage.setItem('gi-thread-login-return',JSON.stringify({
        kind:'incident',id:new URL(location.href).searchParams.get('incident'),expires:Date.now()+60000}))""")
    page.goto(page.url.split('?')[0])
    expect(thread.locator('.thread-history')).to_contain_text('Savanoris papildė patikros istoriją.')
    assert '?incident=' in page.url
    thread.get_by_role('button',name='Uždaryti').click()
    page.locator('#documentsNav').click()
    page.get_by_text('Sukurti paprastą bandomąjį juodraštį',exact=True).click()
    form=page.locator('#documentCreate')
    form.locator('[name=title]').fill('Naršyklės pažyma')
    form.locator('[name=task]').select_option(label='Naršyklės atvejo užduotis')
    form.locator('button[type=submit]').click()
    doc=page.locator('#documentList article').filter(has_text='Naršyklės pažyma')
    expect(doc).to_contain_text('Juodraštis')
    doc.locator('[data-body]').fill('Patikros rezultatas <patikrinta> & aprašymas.')
    doc.get_by_role('button',name='Išsaugoti',exact=True).click()
    expect(doc).to_contain_text('2 versija')
    with page.expect_download() as download:
        doc.get_by_role('button',name='Atsisiųsti DOCX').click()
    path=download.value.path()
    with zipfile.ZipFile(path) as file:
        document=ElementTree.fromstring(file.read('word/document.xml'))
        assert 'Patikros rezultatas <patikrinta> & aprašymas.' in ''.join(document.itertext())
    page.evaluate('window.print=()=>{}')
    doc.get_by_role('button',name='Spausdinti / PDF').click()
    page.emulate_media(media='print')
    expect(page.locator('#printDocument')).to_be_visible()
    expect(page.locator('#printDocument')).to_contain_text('Patikros rezultatas')
    import subprocess
    pdf=page.pdf()
    assert pdf.startswith(b'%PDF-')
    text=subprocess.check_output(['pdftotext','-','-'],input=pdf).decode()
    assert 'Naršyklės pažyma' in text and 'Patikros rezultatas' in text
    page.emulate_media(media='screen')
    doc.get_by_role('button',name='Pateikti peržiūrai').click()
    expect(doc).to_contain_text('Peržiūrima')
    print('PASS browser incident, private photo, case task, document review submission, DOCX and print PDF',flush=True)
