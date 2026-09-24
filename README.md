# CE2134 · CDE TTG Workshop

[Open the presentation](https://jiaruilei.github.io/CE2134-TTG-Workshop/)

An 11-slide browser presentation of the updated `CE2134_TTG.pptx`. The slide artwork is exported directly by PowerPoint at 1920 × 1080 so the original wording, figures, tables, fonts and layout are preserved. Slide 2 retains its two click-to-reveal steps. The supplied PowerPoint remains the editable source and is not modified.

## Present

Open the presentation in Chrome or Edge and choose **Full screen**. Use the on-screen arrows or Left/Right keys to advance. On slide 2 the arrows reveal the original animation steps before moving on. **Overview** shows all slides. The bottom navigation stays available after you click inside a webpage.

Slides **4, 6, 8 and 10** contain live webpages. Interact and scroll within each page. **Expand webpage** fills the presentation area, and **Back to slide** restores the original layout without opening another window. **Reload** reloads just that page. Pages load when first visited and retain their state when you move between slides. Switching A/B deliberately loads the selected version afresh.

| Slide | Webpage |
| --- | --- |
| 4 | Original Wave Attenuation by Nature-Based Solutions lab |
| 6 | A: original AI-coach pressure lab; B: [separate Render copy](https://ce2134-ttg-pressure-b.onrender.com/) fixed to the original rule-based replies |
| 8 | Original Hydrostatic Force on Surfaces lab |
| 10 | Original Bernoulli Pipe HGL/EGL lab |

Internet access is required for the live pages and their services. Visit the demonstration slides before presenting to let the websites load. The free Render service for B may need a moment to wake up after inactivity. The original AI services retain their normal recording behavior. The separate B copy has no AI key and does not connect to the study's production backend.

The B copy avoids the original study site's `SameSite=Lax` assignment cookie: inside a cross-site iframe, that cookie is unavailable and the original backend defaults to A. A separate service always selects B, so switching versions does not depend on third-party cookie support. The original study site and its A/B allocation are unchanged.

The B service runs on Render's free plan in the NUS workspace, Singapore region. [Manage the service](https://dashboard.render.com/web/srv-daqmemjktnus73bdlci0). Automatic deployment is off so slide-only updates do not restart the demonstration service. After changing `demos/pressure-b`, deploy the latest commit from this service's Render dashboard. Its build/start commands are `npm --prefix demos/pressure-b ci` and `npm --prefix demos/pressure-b start`.

## Files

- `index.html`, `styles.css`, `presentation.js`: browser presentation and controls.
- `slides/`: PowerPoint exports, animation builds, and a manifest with source and image SHA-256 hashes. Slide 6's screen background removes only the two hyperlink text boxes, which are replaced by the live page selector. The original slide image is retained for printing.
- `demos/pressure-b/`: independently hosted copy of the pressure lab, fixed to version B. See its README for upstream provenance and deployment commands.
- `scripts/source-inventory.json`: text, links and placement information extracted from this updated deck.
- `scripts/website-overrides.json`: replacement URL for the independently hosted B copy, when configured.
- `scripts/export_slides.ps1`, `scripts/build_presentation.py`: reproducible export and browser-deck generation for this source deck.
- `reveal.js`, `reveal.css`, `notes.js`, `LICENSE-reveal.txt`: bundled reveal.js 5.2.1 and MIT license. This license covers reveal.js, not the supplied teaching content.

GitHub Pages serves the root of `main`. The original PowerPoint is kept outside this public repository. Slide artwork is displayed as images to preserve its appearance; edit the PowerPoint and regenerate to change slide content.

## Run locally

From this folder run `python -m http.server 8765 --bind 127.0.0.1` and open `http://127.0.0.1:8765/`. Keep the server running while presenting. The embedded websites still require internet access. To present the hosted version, no local server is needed.

## Rebuild this deck

On Windows with PowerPoint installed:

```powershell
./scripts/export_slides.ps1 -Source 'PATH/CE2134_TTG.pptx' -OutputDirectory '.slide-exports'
python scripts/build_presentation.py scripts/source-inventory.json .slide-exports 'PATH/CE2134_TTG.pptx'
```

The exporter works on a copy, closes only its own presentation and does not save edits to the source. The recorded inventory and animation shape IDs describe the supplied September 2026 deck; if slide structure changes, refresh the inventory and animation IDs before rebuilding.
