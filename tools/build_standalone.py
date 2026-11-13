"""Packs the game into ONE self-contained HTML file (dist/snakes-ladders-and-chaos.html).
Handy for previewing or sharing. The normal folder (served with serve.py) stays the real project.
Usage:  python tools/build_standalone.py
How it works: index.html's CSS and scripts are pasted in, and every file in assets/ goes into window.EMBED
(SVG/JSON as text under "name#text", sounds and the font as base64 data addresses) which art.js / audio.js already know how to read."""
import base64, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(ROOT, p), encoding="utf-8").read()
b64 = lambda p: base64.b64encode(open(os.path.join(ROOT, p), "rb").read()).decode()

embed = {}
for dp, _, files in os.walk(os.path.join(ROOT, "assets")):
    for f in files:
        rel = os.path.relpath(os.path.join(dp, f), os.path.join(ROOT, "assets")).replace(os.sep, "/")
        if f.endswith((".svg", ".json")):
            embed[rel + "#text"] = rd("assets/" + rel)
        elif f.endswith(".mp3"):
            embed[rel] = "data:audio/mpeg;base64," + b64("assets/" + rel)

css = rd("css/style.css").replace("url(../assets/Minecraft.ttf)", "url(data:font/ttf;base64," + b64("assets/Minecraft.ttf") + ")")
css = css.replace("url(../assets/Little_Monster_DEMO.ttf)", "url(data:font/ttf;base64," + b64("assets/Little_Monster_DEMO.ttf") + ")")
html = rd("index.html")
html = re.sub(r'<link rel="stylesheet"[^>]*>', lambda m: "<style>" + css + "</style>", html)
def inline_img(m):   # <img src="assets/x.svg"> written directly in index.html: embed as a data address
    return 'src="data:image/svg+xml;base64,' + b64("assets/" + m.group(1)) + '"'
html = re.sub(r'src="assets/([^"]+\.svg)"', inline_img, html)
scripts = [s.split("?")[0] for s in re.findall(r'<script src="(js/[^"]+)"></script>', html)]   # (drop the ?v=3 cache-busting tail)
html = re.sub(r'\s*<script src="js/[^"]+"></script>', "", html)
bundle = "<script>window.EMBED=" + json.dumps(embed).replace("</", "<\\/") + ";</script>\n" + \
         "".join("<script>" + rd(s).replace("</script", "<\\/script") + "</script>\n" for s in scripts)
html = html.replace("</body>", bundle + "</body>")
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
out = os.path.join(ROOT, "dist", "snakes-ladders-and-chaos.html")
open(out, "w", encoding="utf-8").write(html)
print("wrote", out, round(len(html) / 1e6, 2), "MB")
