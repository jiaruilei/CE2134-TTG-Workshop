# CE2134 · CDE TTG Workshop

[**Open the presentation**](https://jiaruilei.github.io/CE2134-TTG-Workshop/)

An 11-slide reveal.js presentation on AI-assisted experiential learning in CE2134 Fluid Mechanics, by Assistant Professor Lei Jiarui, Gary, National University of Singapore.

## Present

Open the link in Chrome or Edge. No installation or GitHub account is required. Use **Left/Right arrows** to navigate, **F** for fullscreen, **O** for the overview, and **S** or **Notes** for speaker view. Allow the speaker-view popup if requested. Move the pointer to reveal the controls.

**Slide 4** contains the interactive Bernoulli simulation. It is loaded with the deck, retains settings between slides, and pauses while hidden. Use the controls at the top right after interacting with its inputs. The workshop tutor provides built-in explanations, not live AI, and does not send questions or quiz answers to the teaching service.

## Files and updates

This repository contains the complete static presentation, with all assets beside `index.html`. Edit `index.html` for slide content, `styles.css` for appearance and `presentation.js` for controls. The simulation is in `simulator.html`, `quiz-practice.js` and `workshop.css`.

GitHub Pages publishes the root of the `main` branch. Updates to these files automatically update the presentation. Internet access is required to load the hosted site. All published files, including the embedded speaker notes, are public.

To run locally, use `python -m http.server 8764 --bind 127.0.0.1` in this folder and open `http://127.0.0.1:8764/`. Do not open the HTML directly as a local file: JavaScript modules require an HTTP server.

## Provenance

The slides, photographs and data come from `CE2134_AI_Findings_10min_Gary_Style.pptx`. The animation is a workshop adaptation of [Gary's Bernoulli simulator](https://github.com/jiaruilei/Bernoulli-Pipe-HGL-EGL). The original teaching website is unchanged. reveal.js 5.2.1 is included under its MIT license; see `LICENSE-reveal.txt`. That license covers reveal.js, not the presentation's photographs or teaching content.
