"""Build from a PPTX inventory, PowerPoint PNG exports and the source PPTX.

Usage: python scripts/build_presentation.py INVENTORY EXPORT_DIRECTORY SOURCE_PPTX
The source PPTX is read only. PowerPoint owns the slide artwork and typography.
"""
import hashlib
import html
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
inventory_file, export_dir, source_file = map(Path, sys.argv[1:])
inventory = json.loads(inventory_file.read_text(encoding="utf-8-sig"))
overrides_path = ROOT / "scripts" / "website-overrides.json"
overrides = json.loads(overrides_path.read_text(encoding="utf-8")) if overrides_path.exists() else {}
slide_overrides_path = ROOT / "scripts" / "slide-overrides.json"
slide_overrides = json.loads(slide_overrides_path.read_text(encoding="utf-8")) if slide_overrides_path.exists() else {}
(ROOT / "slides").mkdir(exist_ok=True)
esc = html.escape
sections = []
manifest = {"source": source_file.name,
            "sha256": hashlib.sha256(source_file.read_bytes()).hexdigest(),
            "slides": []}

def copy_asset(source_path, destination_path):
    if source_path.resolve() != destination_path.resolve():
        shutil.copyfile(source_path, destination_path)

def authored_slide(number, revision):
    title = revision["title"]
    content_path = ROOT / revision["content"]
    content = content_path.read_text(encoding="utf-8")
    sections.append(f'<section id="slide-{number}" data-title="{esc(title)}" aria-label="Slide {number}: {esc(title)}">\n{content}\n</section>')
    record = {"number": number, "title": title, "content": revision["content"],
              "contentSha256": hashlib.sha256(content_path.read_bytes()).hexdigest(),
              "websites": [], "sourceWebsites": []}
    if number <= inventory["slide_count"]:
        record["sourceImage"] = f"slides/slide-{number:02}.png"
    manifest["slides"].append(record)

for slide in inventory["slides"]:
    number = slide["number"]
    title = slide["paragraphs"][0] if number != 3 else "Experiential learning: Physical"
    picture = f"slides/slide-{number:02}.png"
    copy_asset(export_dir / Path(picture).name, ROOT / picture)
    if str(number) in slide_overrides:
        authored_slide(number, slide_overrides[str(number)])
        continue
    paragraphs = slide["paragraphs"] + slide.get("diagram_paragraphs", [])
    transcript = " ".join(p for p in paragraphs if p and p != str(number))
    image = f'<img class="source-slide" src="{picture}" alt="{esc(transcript)}" draggable="false">'
    if number == 6:
        web_picture = "slides/slide-06-web.png"
        copy_asset(export_dir / Path(web_picture).name, ROOT / web_picture)
        image = (f'<img class="source-slide screen-slide" src="{web_picture}" alt="{esc(transcript)}" draggable="false">'
                 f'<img class="source-slide print-slide" src="{picture}" alt="{esc(transcript)}" draggable="false">')
    if number == 2:
        builds = []
        for step in range(2):
            build = f"slides/slide-02-build-{step}.png"
            copy_asset(export_dir / Path(build).name, ROOT / build)
            builds.append(build)
        image = (f'<img class="source-slide" src="{builds[0]}" alt="{esc(title)}" draggable="false">'
                 f'<img class="source-slide fragment" data-fragment-index="0" src="{builds[1]}" alt="{esc(" ".join(slide.get("diagram_paragraphs", [])))}" draggable="false">'
                 f'<img class="source-slide fragment" data-fragment-index="1" src="{picture}" alt="{esc(transcript)}" draggable="false">')
    panel = ""
    links = [r["Target"] for r in slide["relationships"] if r.get("TargetMode") == "External"]
    source_links = links[:]
    links = overrides.get(str(number), links)
    if number in (4, 6, 8, 10):
        region = slide["suggested_embed_pct"]
        box = ";".join(f"{key}:{region[value]}%" for key, value in
                       [("left", "x"), ("top", "y"), ("width", "w"), ("height", "h")])
        tabs = ""
        if number == 6:
            tabs = '<div class="study-tabs" role="group" aria-label="Study version">' + "".join(
                f'<button class="study-tab" data-url="{esc(url)}" aria-pressed="{str(i == 0).lower()}">{label}</button>'
                for i, (label, url) in enumerate(zip(["A: AI coach", "B: Rule-based"], links))) + '</div>'
        panel = f'''
  <div class="web-panel" style="{box}" data-initial-url="{esc(links[0])}">
    <div class="web-toolbar">
{tabs}
      <span class="web-address" title="{esc(links[0])}">{esc(links[0])}</span>
      <button class="reload-web" title="Reload this webpage">Reload</button>
      <button class="expand-web" aria-expanded="false">Expand webpage</button>
    </div>
    <div class="web-viewport">
      <div class="web-loading" role="status">Loading webpage…</div>
      <iframe title="Slide {number}: {esc(title)}" data-web-src="{esc(links[0])}" data-preload allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>
  </div>'''
    sections.append(f'''<section id="slide-{number}" data-title="{esc(title)}" aria-label="Slide {number}: {esc(title)}">
  {image}{panel}
</section>''')
    manifest["slides"].append({"number": number, "title": title, "image": picture,
                               "websites": links, "sourceWebsites": source_links,
                               "imageSha256": hashlib.sha256((ROOT / picture).read_bytes()).hexdigest()})

for number in sorted(int(key) for key in slide_overrides if int(key) > inventory["slide_count"]):
    authored_slide(number, slide_overrides[str(number)])

(ROOT / "index.html").write_text('''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CE2134 · CDE TTG Workshop</title>
  <meta name="description" content="CE2134 TTG workshop slides with live webpages on slides 4, 6, 8 and 10.">
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="reveal.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
<main class="reveal" aria-label="CE2134 workshop presentation"><div class="slides">
''' + "\n".join(sections) + '''
</div></main>
<nav class="deck-controls" aria-label="Presentation controls">
  <button id="previous" aria-label="Previous slide or reveal" title="Previous (Left arrow)">‹</button>
  <span id="counter" aria-live="polite">1 / TOTAL_SLIDES</span>
  <button id="next" aria-label="Next slide or reveal" title="Next (Right arrow)">›</button>
  <span class="divider"></span>
  <button id="overview" title="Slide overview (O)">Overview</button>
  <button id="fullscreen" title="Full screen (F)">Full screen</button>
</nav>
<div id="notice" role="status" hidden></div>
<script src="reveal.js"></script><script src="presentation.js"></script>
</body></html>
''', encoding="utf-8", newline="\n")
(ROOT / "slides" / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
# Bust cached controls/styles when this deck replaces an older published version.
page = ROOT / "index.html"
content = page.read_text(encoding="utf-8")
content = content.replace("TOTAL_SLIDES", str(len(sections)))
for asset in ("styles.css", "presentation.js", "slides/slide-02-build-0.png", "slides/slide-02-build-1.png"):
    version = hashlib.sha256((ROOT / asset).read_bytes()).hexdigest()[:12]
    content = content.replace(f'"{asset}"', f'"{asset}?v={version}"')
page.write_text(content, encoding="utf-8", newline="\n")
print(f"Built {len(sections)} slides from {source_file.name}")
