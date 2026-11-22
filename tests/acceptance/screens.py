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
                card.get_by_role('button',name='Išsaugoti terminą').click()
                expect(card).to_contain_text('18:45')
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
                page.route('**/rpc/gi_set_task_due',lambda route:route.abort())
                due_button.click()
                expect(page.locator('#actionToast')).to_contain_text('Nepavyko')
                expect(field).to_have_value(date+'T19:30')
                page.unroute('**/rpc/gi_set_task_due')
                card.get_by_role('button',name='Pašalinti terminą').click()
                expect(card.get_by_text('Nustatyti terminą',exact=True)).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow '+name
                print('PASS browser '+name+' create, edit, fresh login, validation, network failure and clear',flush=True)
                browser.close()
    finally:
        server.shutdown()
