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
                card.get_by_text('Keisti terminą',exact=True).click()
                field=card.get_by_label('Užduoties terminas')
                expect(field).to_have_value(date+'T09:05')
                field.fill(date+'T18:45')
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
                expect(card.get_by_text('Nustatyti terminą',exact=True)).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow '+name
                print('PASS browser '+name+' create, edit, fresh login, validation, network failure and clear',flush=True)
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
    page.locator('[data-nav=incidents]').click()
    page.locator('#incidentDescription').fill('Naršyklės demonstracinė patikra')
    page.locator('#incidentCoords').fill('0.0, 0.0')
    page.locator('#incidentPhotos').set_input_files({'name':'test.png','mimeType':'image/png',
        'buffer':base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')})
    page.get_by_role('button',name='Pateikti bandomąjį pranešimą').click()
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
    page.locator('#documentsNav').click()
    page.get_by_text('Rengti bandomąjį dokumentą',exact=True).click()
    form=page.locator('#documentCreate')
    form.locator('[name=title]').fill('Naršyklės pažyma')
    form.locator('[name=task]').select_option(label='Naršyklės atvejo užduotis')
    form.locator('button').click()
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
