# CE2134 · CDE TTG Workshop

[Open the presentation](https://jiaruilei.github.io/CE2134-TTG-Workshop/)

A 12-slide browser presentation based on the updated `CE2134_TTG.pptx`. Original slide artwork is exported directly by PowerPoint at 1920 × 1080. Slide 2 retains its two click-to-reveal steps, with both dates appearing in the final reveal. Slide 5 has a concise assignment overview using its original Arial 39-point title and 24-point text. The added slide 12 uses slide 2’s visual format to summarise past and continued AI integration into experiential learning. The title page includes the original group logo and the Laboratory for Eco-hydrodynamic Interactions name from the supplied `Title page.pptx`, preserving its orange L/E/I initials. These presentation revisions are maintained in the browser deck; the supplied PowerPoint is not modified.

## Present

Open the presentation in Chrome or Edge and choose **Full screen**. Use the on-screen arrows or Left/Right keys to advance. On slide 2 the arrows reveal the original animation steps before moving on. **Overview** shows all slides. The bottom navigation stays available after you click inside a webpage.

Slides **4, 6, 8 and 10** automatically open their live webpages in the expanded presentation area. Interact and scroll within each page. **Back to slide** restores the original layout, and **Expand webpage** returns to the demonstration without opening another window. **Reload** reloads just that page. Pages load when first visited and retain their state when you move between slides.

Slide **6** shows two independent live coaches side by side, initially positioned at their chat sections. Enter a shared question and choose **Copy question**, then paste it into each coach and press **Ask**. The presentation does not submit questions automatically. Both coaches remain visible together, with a light-blue header for B. Each pane scrolls and reloads independently. Moving between slides preserves both conversations; reloading a pane restarts only that webpage.

| Slide | Webpage |
| --- | --- |
| 4 | Original Wave Attenuation by Nature-Based Solutions lab |
| 6 | A: original AI-coach pressure lab; B: [separate Render copy](https://ce2134-ttg-pressure-b.onrender.com/) fixed to the original rule-based replies |
| 8 | Original Hydrostatic Force on Surfaces lab |
| 10 | Original Bernoulli Pipe HGL/EGL lab |

Internet access is required for the live pages and their services. Visit the demonstration slides before presenting to let the websites load. The free Render service for B may need a moment to wake up after inactivity. The original AI services retain their normal recording behavior. The separate B copy has no AI key and does not connect to the study's production backend.

The B copy avoids the original study site's `SameSite=Lax` assignment cookie: inside a cross-site iframe, that cookie is unavailable and the original backend defaults to A. A separate service always selects B, so the comparison does not depend on third-party cookie support. The original study site and its A/B allocation are unchanged.

The B service runs on Render's free plan in the NUS workspace, Singapore region. [Manage the service](https://dashboard.render.com/web/srv-daqmemjktnus73bdlci0). Automatic deployment is off so slide-only updates do not restart the demonstration service. After changing `demos/pressure-b`, deploy the latest commit from this service's Render dashboard. Its build/start commands are `npm --prefix demos/pressure-b ci` and `npm --prefix demos/pressure-b start`.

## Final-slide wave effect

On slide 12, the hand clap gesture fills the screen with the wave effect, then returns to the slide automatically. There is no visible launch button. At the ending, **PHYSICAL + DIGITAL** move together and merge into **PHYGITAL** in the centre of the water. The finished word remains fully visible for over four seconds while the water continues moving; total playback is about 16 seconds. This replaces the former upper-right wordmark on slide 12. Each clap restarts the sequence, and its timing pauses with the wave when the tab is hidden. The embedded lab starts its camera automatically on entry and asks for browser permission on first use. That single camera supplies both the lab controls and the wave gesture trigger.

For the gesture trigger, briefly hold both open hands apart, then clap them together. Keep both hands visible until they meet; the detector triggers just before contact, when they may obscure one another. Finger orientation is unrestricted, and shoulders and elbows do not need to be visible. After a wave, separate your hands before repeating. The slide has no camera icon, and playback shows only the water effect and caption, without buttons or a progress indicator. It returns to the slide automatically; Escape can end it early.

The lab runs hand tracking on-device without recording, video upload or microphone access. It shares only hand landmark coordinates and camera status with the presentation through a restricted browser `postMessage` connection. The presentation verifies the sending iframe, origin and session; it does not request a second camera or load a second hand tracker. First use needs internet to download the lab's hand-tracking assets. During wave playback the lab camera remains on and the wave trigger pauses. Leaving slide 12, entering overview or slide blackout, or hiding the tab stops the shared session. If the parent disappears, the lab releases its presentation-owned camera after six seconds without a heartbeat. Rehearse the gesture in the presentation browser before use.

The effect uses WebGL with a Canvas fallback. No scientific calculations are changed. Its sources are in `effects/final-slide/`, with slide controls in `custom/slide-12.html` and the shared overlay in `custom/wave-overlay.html`. Run `node --test effects/final-slide/hand-sweep.test.mjs effects/final-slide/shared-hand-input.test.mjs` for the gesture and shared-camera connection checks. The corresponding lab deployment must support `ce2134-hand-tracking` protocol version 1. Local presentation origins are `http://127.0.0.1:8770`, `http://localhost:8770`, `http://127.0.0.1:8765` and `http://localhost:8765`; the production presentation origin is `https://jiaruilei.github.io`.

## Files

- `index.html`, `styles.css`, `presentation.js`: browser presentation and controls.
- `slides/`: PowerPoint exports, animation builds, and a manifest with source and image SHA-256 hashes. Slide 6's screen background removes only the two hyperlink text boxes, which are replaced by the live comparison. The original slide image is retained for printing.
- `demos/pressure-b/`: independently hosted copy of the pressure lab, fixed to version B. See its README for upstream provenance and deployment commands.
- `scripts/source-inventory.json`: text, links and placement information extracted from this updated deck.
- `scripts/website-overrides.json`: replacement URL for the independently hosted B copy, when configured.
- `custom/slide-05.html`, `custom/slide-12.html`, `scripts/slide-overrides.json`: authored browser slides and source metadata, preserved when rebuilding.
- `scripts/export_slides.ps1`, `scripts/build_presentation.py`: reproducible export and browser-deck generation for this source deck.
- `reveal.js`, `reveal.css`, `LICENSE-reveal.txt`: bundled reveal.js 5.2.1 and MIT license. This license covers reveal.js, not the supplied teaching content.

GitHub Pages serves the root of `main`. The original PowerPoint is kept outside this public repository. Most slide artwork is displayed as images to preserve its appearance; edit the PowerPoint and regenerate to change those slides. Edit the HTML in `custom/` and rebuild to revise slides 5 and 12. Their styling is in `styles.css`; the 1280 × 720 canvas uses 52px and 32px for slide 5’s original 39pt and 24pt font sizes.

## Run locally

From this folder run `python -m http.server 8765 --bind 127.0.0.1` and open `http://127.0.0.1:8765/`. Keep the server running while presenting. The embedded websites still require internet access. To present the hosted version, no local server is needed.

## Rebuild this deck

On Windows with PowerPoint installed:

```powershell
./scripts/export_slides.ps1 -Source 'PATH/CE2134_TTG.pptx' -OutputDirectory '.slide-exports'
python scripts/build_presentation.py scripts/source-inventory.json .slide-exports 'PATH/CE2134_TTG.pptx'
```

The exporter works on a copy, closes only its own presentation and does not save edits to the source. The recorded inventory and animation shape IDs describe the supplied September 2026 deck; if slide structure changes, refresh the inventory and animation IDs before rebuilding.
