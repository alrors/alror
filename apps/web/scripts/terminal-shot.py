#!/usr/bin/env python3
"""Render real `alror` CLI output (ANSI, true colour) as a terminal window image.

Usage:
    alror --color always deploy ... > deploy.ansi
    python scripts/terminal-shot.py deploy.ansi public/generated/cli-deploy.webp \
        --cmd "alror deploy -s checkout-api -i registry/checkout:1.42" --title "~/shop"

Builds an HTML page in the site's style, screenshots it with headless Chrome at 2x,
crops to the window and saves WebP. Fonts are loaded from node_modules (offline).
"""
import argparse
import html
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
FONT = (ROOT / "node_modules/geist/dist/fonts/geist-mono").as_uri()
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
SGR = re.compile(r"\x1b\[([0-9;]*)m")


def ansi_to_html(text: str) -> str:
    out, fg, bg, bold = [], None, None, False
    pos = 0

    def emit(chunk: str):
        if not chunk:
            return
        style = []
        if fg:
            style.append(f"color:{fg}")
        if bg:
            style.append(f"background:{bg}")
        if bold:
            style.append("font-weight:700")
        esc = html.escape(chunk)
        out.append(f'<span style="{";".join(style)}">{esc}</span>' if style else esc)

    for m in SGR.finditer(text):
        emit(text[pos:m.start()])
        pos = m.end()
        codes = [int(c) if c else 0 for c in m.group(1).split(";")]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0:
                fg, bg, bold = None, None, False
            elif c == 1:
                bold = True
            elif c == 22:
                bold = False
            elif c == 39:
                fg = None
            elif c == 49:
                bg = None
            elif c in (38, 48) and i + 4 < len(codes) and codes[i + 1] == 2:
                rgb = f"rgb({codes[i + 2]},{codes[i + 3]},{codes[i + 4]})"
                if c == 38:
                    fg = rgb
                else:
                    bg = rgb
                i += 4
            i += 1
    emit(text[pos:])
    return "".join(out)


PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:GM;src:url('{font}/GeistMono-Regular.woff2') format('woff2');font-weight:400}}
@font-face{{font-family:GM;src:url('{font}/GeistMono-Bold.woff2') format('woff2');font-weight:700}}
html,body{{margin:0;background:#070708}}
.win{{display:inline-block;margin:0;border-radius:22px;padding:8px;background:linear-gradient(180deg,#1d1d21,#121214);
 border:1px solid #28282d;box-shadow:inset 0 1px 0 rgba(255,255,255,.07)}}
.bar{{display:flex;align-items:center;justify-content:space-between;padding:6px 12px 12px;font:11px GM,monospace;
 letter-spacing:.16em;text-transform:uppercase;color:#6b6b74}}
.bar b{{display:inline-block;width:7px;height:7px;border-radius:50%;background:#35e08f;box-shadow:0 0 6px #35e08f;margin-right:9px}}
.screws i{{display:inline-block;width:8px;height:8px;margin-left:6px;border-radius:50%;background:#0c0c0e;box-shadow:inset 0 1px 1px #000}}
pre{{margin:0;padding:20px 24px 24px;background:#0a0a0b;border:1px solid #1f1f23;border-radius:14px;
 box-shadow:inset 0 2px 6px rgba(0,0,0,.8);font:{size}px/{lh} {family};color:#d4d4d8;white-space:pre}}
pre span[style*="background"]{{display:inline-block;height:{lh}em;vertical-align:top}}
.p{{color:#35e08f}} .c{{color:#f2f2f3}}
</style></head><body><div class="win"><div class="bar"><span><b></b>{title}</span><span class="screws"><i></i><i></i></span></div>
<pre><span class="p">$</span> <span class="c">{cmd}</span>
{body}</pre></div></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ansi")
    ap.add_argument("out")
    ap.add_argument("--cmd", required=True)
    ap.add_argument("--title", default="~/shop · zsh")
    ap.add_argument("--size", type=int, default=14)
    ap.add_argument("--skip", type=int, default=0, help="drop this many leading lines")
    ap.add_argument("--take", type=int, default=0, help="keep at most this many lines")
    ap.add_argument("--font", default="GM,monospace", help="CSS font-family for the terminal text")
    ap.add_argument("--lh", default="1.32", help="line height (use 1.0 for block-letter art)")
    a = ap.parse_args()

    lines = Path(a.ansi).read_text(encoding="utf-8").rstrip("\n").split("\n")[a.skip:]
    if a.take:
        lines = lines[: a.take]
    page = PAGE.format(font=FONT, title=html.escape(a.title), cmd=html.escape(a.cmd),
                       body=ansi_to_html("\n".join(lines)), size=a.size, family=a.font, lh=a.lh)

    with tempfile.TemporaryDirectory() as tmp:
        src, shot = Path(tmp) / "t.html", Path(tmp) / "t.png"
        src.write_text(page, encoding="utf-8")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--force-device-scale-factor=2", "--allow-file-access-from-files",
                        "--window-size=1400,2000", "--virtual-time-budget=3000",
                        f"--screenshot={shot}", src.as_uri()], check=True, capture_output=True)
        im = Image.open(shot).convert("RGB")
    box = ImageChops.difference(im, Image.new("RGB", im.size, (7, 7, 8))).convert("L").point(
        lambda v: 255 if v > 6 else 0).getbbox()
    im = im.crop(box)
    im.save(a.out, "WEBP", quality=92, method=6)
    print(f"wrote {a.out} {im.size}")


if __name__ == "__main__":
    main()
