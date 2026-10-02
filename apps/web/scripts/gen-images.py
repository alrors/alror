#!/usr/bin/env python3
"""Generate the site's studio product renders with the Gemini image API.

Usage (from web/):
    python scripts/gen-images.py            # generate all missing images
    python scripts/gen-images.py relax      # (re)generate one image by name
    python scripts/gen-images.py --force    # regenerate everything

Reads GEMINI_API_KEY from .env.local. Writes WebP files to public/generated/.
"""
import base64
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "generated"
MODEL = "gemini-3-pro-image"

RENDER = (
    "Art direction: photorealistic 3D studio product render in the style of precision industrial "
    "design (Teenage Engineering, Dieter Rams, Braun). Materials: matte graphite and dark anodized "
    "aluminium bodies, fine machined edges, small cream ceramic accents (#EFEDE6), and mint green "
    "LEDs (#35E08F) as the ONLY light-emitting colour (an amber LED only where stated). Seamless "
    "near-black background (#070708), soft overhead studio light, subtle reflections, shallow depth "
    "of field, calm and serious, generous negative space. Strictly no people, no hands, no text, "
    "no letters, no numbers, no logos, no screens with readable content, no watermarks."
)

HALFTONE = (
    "Art direction: serious documentary photograph rendered as a dithered halftone with fine "
    "horizontal scanlines, strict two-colour duotone: mint green (#35E08F) highlights on deep "
    "near-black (#070708), heavy film grain, low-key cinematic lighting, slightly dystopian, vast "
    "scale, quiet tension. People are professional engineers, focused and competent, dressed in "
    "plain dark work clothes, never posing, never relaxing, never sleeping, no sunglasses, faces "
    "mostly in shadow or seen from behind. Ghostly figures, where stated, dissolve into scanline "
    "strokes. No text, no letters, no logos, no readable screens, no watermarks."
)

RESTYLE = (
    "Keep EXACTLY the same layout, components, wiring and every piece of text and number from the "
    "input image (Pull request #4821, AI-assisted, 4 services, Risk model 62 / 100, GATE-01 PRODUCTION, "
    "checkout-api, #4821 Batch retries for payment capture, RISK 62, CANARY 50% TRAFFIC, 5% 25% 50% 100%, "
    "Datadog 3 of 3 checks passing, #deploys Promotion posted, ALROR RELEASE RECEIPT, Verified, Error rate "
    "0.20% / 0.22%, p95 latency 181 / 186 ms, SLO burn 0.5x / 0.7x, Promoted 100%). Spell every word exactly. "
    "Only change the visual treatment as described. Mint green #35E08F stays the single accent colour. "
    "Output a clean, premium product-marketing hero visual, 16:9, no extra text, no watermark."
)

STYLES = {"render": RENDER, "halftone": HALFTONE, "restyle": RESTYLE}  # site images use "halftone"

IMAGES = {
    "wf-iso": {
        "aspect": "16:9",
        "style": "restyle",
        "source": "public/generated/workflow.webp",
        "prompt": (
            "Restyle this release-workflow UI as a 3D isometric scene viewed from about 30 degrees above: "
            "each card is a thick floating glass-and-graphite slab with soft depth shadows on a dark "
            "studio floor, the cables are glowing mint fibre-optic lines running across the floor between "
            "slabs, the receipt is real curling paper. Cinematic soft lighting, shallow depth of field."
        ),
    },
    "wf-light": {
        "aspect": "16:9",
        "style": "restyle",
        "source": "public/generated/workflow.webp",
        "prompt": (
            "Restyle this release-workflow UI in a light, tactile industrial-hardware style like a "
            "Teenage Engineering or Superlinked device: warm light-grey matte plastic panels with "
            "subtle bevels and screws, cream paper receipt, small mint LEDs, printed-circuit traces with "
            "tiny moving dots between modules, soft studio shadows on a pale grey background."
        ),
    },
    "wf-glass": {
        "aspect": "16:9",
        "style": "restyle",
        "source": "public/generated/workflow.webp",
        "prompt": (
            "Restyle this release-workflow UI as a refined dark glassmorphism dashboard: frosted smoked-"
            "glass cards with thin luminous edges, a faint mint aurora glow behind the central gate card, "
            "precise thin vector connectors with small arrowheads, crisp typography, subtle noise texture, "
            "near-black background. Sleek, modern SaaS hero illustration."
        ),
    },
    "agents": {
        "aspect": "21:9",
        "style": "halftone",
        "prompt": (
            "A vast dim open-plan hall with long rows of identical desks receding into darkness. At "
            "every desk sits a ghostly translucent figure made of scanlines, an AI coding agent, "
            "typing at a glowing laptop. In the foreground, one human engineer stands at a single "
            "console, seen from behind, overseeing the rows."
        ),
    },
    "datacenter": {
        "aspect": "16:9",
        "style": "halftone",
        "prompt": (
            "A long, cold data centre aisle between towering server racks with countless tiny status "
            "lights, symmetrical one-point perspective. A single engineer in the far distance walks "
            "down the aisle carrying a laptop. Oppressive scale, controlled order."
        ),
    },
    "warroom": {
        "aspect": "16:9",
        "style": "halftone",
        "prompt": (
            "Three engineers in a dark operations room at night, seen from behind and in profile, "
            "standing close together in front of a large wall display of abstract line charts. One "
            "points at a single sharp spike on the chart. Tense, focused, professional."
        ),
    },
    "pipeline": {
        "aspect": "16:9",
        "style": "halftone",
        "prompt": (
            "A brutalist concrete hall at night where thick bundles of cables and pipes run from "
            "the walls into one massive industrial gate structure in the centre, its frame glowing. "
            "A lone engineer stands at its base for scale, inspecting a handheld device."
        ),
    },
}


def api_key() -> str:
    text = (ROOT / ".env.local").read_text(encoding="utf-8")
    match = re.search(r'GEMINI_API_KEY\s*=\s*"?([^"\s]+)', text)
    if not match:
        sys.exit("GEMINI_API_KEY not found in .env.local")
    return match.group(1)


def generate(name: str, spec: dict, key: str) -> Path:
    parts = [{"text": f"{spec['prompt']}\n\n{STYLES[spec.get('style', 'render')]}"}]
    if spec.get("source"):  # image-to-image: restyle an existing picture, keep its content
        buf = io.BytesIO()
        Image.open(ROOT / spec["source"]).convert("RGB").save(buf, "PNG")
        parts.insert(0, {"inline_data": {"mime_type": "image/png", "data": base64.b64encode(buf.getvalue()).decode()}})
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": spec["aspect"], "imageSize": "2K"},
        },
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
    )
    for attempt in range(4):  # the API returns transient 429/5xx under load
        try:
            with urllib.request.urlopen(req, timeout=300) as res:
                data = json.load(res)
            break
        except urllib.error.HTTPError as err:
            if err.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
            print(f"{name}: HTTP {err.code}, retrying in {20 * (attempt + 1)}s")
            time.sleep(20 * (attempt + 1))
    for part in data["candidates"][0]["content"]["parts"]:
        inline = part.get("inlineData") or part.get("inline_data")
        if inline:
            img = Image.open(io.BytesIO(base64.b64decode(inline["data"]))).convert("RGB")
            img.thumbnail((2400, 2400))
            path = OUT / f"{name}.webp"
            img.save(path, "WEBP", quality=82, method=6)
            return path
    raise RuntimeError(f"{name}: no image in response: {json.dumps(data)[:400]}")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv or bool(args)
    names = args or list(IMAGES)
    OUT.mkdir(parents=True, exist_ok=True)
    key = api_key()
    for name in names:
        target = OUT / f"{name}.webp"
        if target.exists() and not force:
            print(f"skip {name} (exists)")
            continue
        path = generate(name, IMAGES[name], key)
        print(f"wrote {path.relative_to(ROOT)} {Image.open(path).size}")


if __name__ == "__main__":
    main()
