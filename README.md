# CE2134 · CDE TTG Workshop

[**Open the presentation**](https://jiaruilei.github.io/CE2134-TTG-Workshop/)

An 11-slide reveal.js presentation on AI-assisted experiential learning in CE2134 Fluid Mechanics, by Assistant Professor Lei Jiarui, Gary, National University of Singapore.

## Present

Open the link in Chrome or Edge. No installation or GitHub account is required. Use **Left/Right arrows** to navigate, **F** for fullscreen, **O** for the overview, and **S** or **Notes** for speaker view. Allow the speaker-view popup if requested. Move the pointer to reveal the controls.

**Slide 4** embeds the [original Bernoulli Pipe website](https://jiaruilei.github.io/Bernoulli-Pipe-HGL-EGL/) directly. Its original layout, simulation, AI tutor, quizzes and recording behaviour are preserved. The webpage loads once and retains its state between slides. Scroll inside the webpage to access its full interface, and use the presentation arrows at the top right to change slides after interacting with its inputs. Internet access is required; the AI tutor also depends on the original backend service.

## Files and updates

This repository contains the complete static presentation, with all assets beside `index.html`. Edit `index.html` for slide content, `styles.css` for appearance and `presentation.js` for controls. The simulation is loaded from its original live URL in the slide 4 iframe. Update the original simulator repository to change it; this presentation does not modify or substitute its code.

GitHub Pages publishes the root of the `main` branch. Updates to these files automatically update the presentation. Internet access is required to load the hosted site. All published files, including the embedded speaker notes, are public.

To run locally, use `python -m http.server 8764 --bind 127.0.0.1` in this folder and open `http://127.0.0.1:8764/`. An HTTP server is recommended for local preview; the embedded original webpage still requires internet access.

## Provenance

The slides, photographs and data come from `CE2134_AI_Findings_10min_Gary_Style.pptx`. The embedded animation is served directly by [Gary's Bernoulli simulator](https://github.com/jiaruilei/Bernoulli-Pipe-HGL-EGL). The original teaching website is unchanged. reveal.js 5.2.1 is included under its MIT license; see `LICENSE-reveal.txt`. That license covers reveal.js, not the presentation's photographs or teaching content.
