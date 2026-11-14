"""Serve built UI plus a local-only water review layer. No raw dataset exposure."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class Preview(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT/'frontend/out'),**kwargs)
 def do_GET(self):
  if self.path.split('?')[0] in ['/water/sample.geojson','/roads/sample.geojson']:
   path=ROOT/('data/processed/water/sample-water.geojson' if self.path.startswith('/water/') else 'data/processed/roads/sample-roads.geojson')
   if not path.exists():self.send_error(404);return
   body=path.read_bytes();self.send_response(200);self.send_header('Content-Type','application/geo+json; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
  super().do_GET()
if __name__=='__main__':
 print('Find My Shelter local preview: http://127.0.0.1:4174',flush=True)
 ThreadingHTTPServer(('127.0.0.1',4174),Preview).serve_forever()
