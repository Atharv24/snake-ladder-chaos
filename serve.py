"""Tiny local web server for the game: run `python serve.py`, it opens http://localhost:8000.
Browsers refuse to read the assets/ folder when index.html is opened by double-click, so use this instead."""
import http.server, os, socketserver, sys, webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")      # edited SVGs show up on a simple refresh
        super().end_headers()


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("", PORT), Handler) as server:
    url = f"http://localhost:{PORT}/"
    print(f"Serving the game at {url}  (Ctrl+C to stop)")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
