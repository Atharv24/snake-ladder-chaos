"""Tiny local web server for the game: run `python serve.py`, it opens http://localhost:8000.
Browsers refuse to read the assets/ folder when index.html is opened by double-click, so use this instead.
Includes a low-latency HTTP/1.1 + SSE room relay (/api/events, /api/poll, /api/send) for smooth multiplayer over tunnels."""
import http.server, json, os, socketserver, sys, threading, time, urllib.parse, webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

ROOMS_LOCK = threading.Lock()
ROOMS_COND = threading.Condition(ROOMS_LOCK)
ROOMS = {}   # room_code -> {"seq": int, "msgs": list of (seq, dst, src, data)}


def get_pending(room, peer, after):
    r = ROOMS.get(room)
    if not r:
        return after, []
    seq = r["seq"]
    out = [
        {"seq": sq, "src": s, "data": d}
        for (sq, dst, s, d) in r["msgs"]
        if sq > after and s != peer and (dst == peer or dst == "*")
    ]
    return seq, out


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        if not self.path.startswith("/api/events"):
            self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            return
        super().log_message(fmt, *args)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/events"):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            room = (qs.get("room", [""])[0]).upper()
            peer = qs.get("peer", [""])[0]
            cursor = int(qs.get("after", ["0"])[0])

            self.close_connection = True
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            try:
                # Initial hello frame flushes proxy headers immediately
                self.wfile.write(b": connected\n\n")
                self.wfile.flush()
                while True:
                    with ROOMS_COND:
                        seq, msgs = get_pending(room, peer, cursor)
                        if not msgs:
                            ROOMS_COND.wait(timeout=15.0)
                            seq, msgs = get_pending(room, peer, cursor)
                    if msgs:
                        cursor = seq
                        payload = json.dumps({"seq": seq, "msgs": msgs}).encode("utf-8")
                        self.wfile.write(b"data: " + payload + b"\n\n")
                        self.wfile.flush()
                    else:
                        # Keep-alive comment every 15s so tunnels never idle-timeout
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            return

        if self.path.startswith("/api/poll"):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            room = (qs.get("room", [""])[0]).upper()
            peer = qs.get("peer", [""])[0]
            after = int(qs.get("after", ["0"])[0])
            wait_s = min(12.0, float(qs.get("wait", ["0"])[0] or 0))

            with ROOMS_COND:
                seq, out = get_pending(room, peer, after)
                if not out and wait_s > 0:
                    ROOMS_COND.wait(timeout=wait_s)
                    seq, out = get_pending(room, peer, after)

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
                batch = payload.get("batch")
                with ROOMS_COND:
                    r = ROOMS.setdefault(room, {"seq": 0, "msgs": []})
                    if isinstance(batch, list):
                        for item in batch:
                            r["seq"] += 1
                            r["msgs"].append((r["seq"], str(item.get("dst", "*")), src, item.get("data")))
                    else:
                        dst = str(payload.get("dst", "*"))
                        data = payload.get("data")
                        r["seq"] += 1
                        r["msgs"].append((r["seq"], dst, src, data))
                    if len(r["msgs"]) > 400:
                        r["msgs"] = r["msgs"][-400:]
                    ROOMS_COND.notify_all()
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
        self.send_header("Content-Length", "0")
        self.end_headers()


class DaemonThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


with DaemonThreadingServer(("", PORT), Handler) as server:
    url = f"http://localhost:{PORT}/"
    print(f"Serving the game at {url}  (Ctrl+C to stop)")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
