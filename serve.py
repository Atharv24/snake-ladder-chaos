"""Tiny local web server for the game: run `python serve.py`, it opens http://localhost:8000.
Browsers refuse to read the assets/ folder when index.html is opened by double-click, so use this instead.
Also provides a lightweight /api/send & /api/poll relay so friends behind strict NAT/CGNAT can always connect."""
import http.server, json, os, socketserver, sys, threading, urllib.parse, webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

ROOMS_LOCK = threading.Lock()
ROOMS = {}   # room_code -> {"seq": int, "msgs": list of (seq, dst, src, data)}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")      # edited SVGs show up on a simple refresh
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/poll"):
            return
        super().log_message(fmt, *args)

    def do_GET(self):
        if self.path.startswith("/api/poll"):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            room = (qs.get("room", [""])[0]).upper()
            peer = qs.get("peer", [""])[0]
            after = int(qs.get("after", ["0"])[0])
            with ROOMS_LOCK:
                r = ROOMS.get(room, {"seq": 0, "msgs": []})
                seq = r["seq"]
                out = [
                    {"src": s, "data": d}
                    for (sq, dst, s, d) in r["msgs"]
                    if sq > after and s != peer and (dst == peer or dst == "*")
                ]
            body = json.dumps({"seq": seq, "msgs": out}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/send"):
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8"))
                room = str(payload.get("room", "")).upper()
                src = str(payload.get("src", ""))
                dst = str(payload.get("dst", "*"))
                data = payload.get("data")
                with ROOMS_LOCK:
                    r = ROOMS.setdefault(room, {"seq": 0, "msgs": []})
                    r["seq"] += 1
                    r["msgs"].append((r["seq"], dst, src, data))
                    if len(r["msgs"]) > 250:
                        r["msgs"] = r["msgs"][-250:]
                body = b'{"ok":true}'
                self.send_response(200)
            except Exception as e:
                body = json.dumps({"ok": False, "error": str(e)}).encode("utf-8")
                self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()


socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("", PORT), Handler) as server:
    url = f"http://localhost:{PORT}/"
    print(f"Serving the game at {url}  (Ctrl+C to stop)")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
