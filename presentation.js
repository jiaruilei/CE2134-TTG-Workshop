/* Original slide artwork plus the original live websites. */
const deck = new Reveal({
  width: 1280, height: 720, margin: 0.015, minScale: 0.1, maxScale: 3,
  hash: true, history: true, controls: false, progress: true, center: false,
  transition: 'none', backgroundTransition: 'none', overview: true,
  keyboard: true, slideNumber: false,
});
const previous = document.getElementById('previous');
const next = document.getElementById('next');
const counter = document.getElementById('counter');
const fullscreen = document.getElementById('fullscreen');
function notice(message) {
  const element = document.getElementById('notice');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => { element.hidden = true; }, 6000);
}
function loadWebpage(panel, url) {
  const frame = panel.querySelector('iframe');
  const loading = panel.querySelector('.web-loading');
  const address = panel.querySelector('.web-address');
  address.textContent = url;
  address.title = url;
  frame.dataset.webSrc = url;
  loading.textContent = 'Loading webpage…';
  loading.hidden = false;
  clearTimeout(panel.loadingTimer);
  panel.loadingTimer = setTimeout(() => {
    loading.textContent = 'Waiting for the website. It may take a moment to wake up. Use Reload to try again.';
  }, 15000);
  frame.onload = () => { clearTimeout(panel.loadingTimer); loading.hidden = true; };
  // Keep src when leaving the slide to preserve the site's state.
  // The comparison uses separate origins, so both versions keep independent state.
  frame.src = url;
}
function setExpanded(panel, expanded) {
  panel.classList.toggle('is-expanded', expanded);
  const button = panel.querySelector('.expand-web');
  button.textContent = expanded ? 'Back to slide' : 'Expand webpage';
  button.setAttribute('aria-expanded', String(expanded));
}
function getWebsites(panel) {
  return panel.classList.contains('comparison-panel')
    ? panel.querySelectorAll('.comparison-site') : [panel];
}
async function copyComparisonQuestion(panel) {
  const input = panel.querySelector('.comparison-question');
  if (!input.value.trim()) {
    input.focus();
    notice('Enter a question to compare.');
    return;
  }
  try {
    await navigator.clipboard.writeText(input.value.trim());
    notice('Question copied.');
  } catch {
    input.focus();
    input.select();
    notice('Copy the selected question.');
  }
}
document.querySelectorAll('.web-panel').forEach(panel => {
  panel.querySelector('.expand-web').addEventListener('click', () => {
    setExpanded(panel, !panel.classList.contains('is-expanded'));
  });
  getWebsites(panel).forEach(site => {
    site.querySelector('.reload-web').addEventListener('click', () => {
      loadWebpage(site, site.querySelector('iframe').dataset.webSrc);
    });
  });
  if (panel.classList.contains('comparison-panel')) {
    panel.querySelector('.copy-question').addEventListener('click', () => copyComparisonQuestion(panel));
    const form = panel.querySelector('.comparison-question-form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      copyComparisonQuestion(panel);
    });
    form.addEventListener('keydown', event => event.stopPropagation());
  }
});
function sync() {
  const index = deck.getIndices().h;
  const total = deck.getTotalSlides();
  counter.textContent = `${index + 1} / ${total}`;
  previous.disabled = deck.isFirstSlide() && !deck.availableFragments().prev;
  next.disabled = deck.isLastSlide() && !deck.availableFragments().next;
  const slide = deck.getCurrentSlide();
  document.title = `${index + 1}. ${slide.dataset.title} · CDE TTG Workshop`;
  const panel = slide.querySelector('.web-panel');
  if (panel) {
    getWebsites(panel).forEach(site => {
      if (!site.querySelector('iframe').hasAttribute('src')) {
        loadWebpage(site, site.querySelector('iframe').dataset.webSrc);
      }
    });
  }
}
function enterSlide() {
  const panel = deck.getCurrentSlide()?.querySelector('.web-panel');
  if (panel) setExpanded(panel, true);
  sync();
}
previous.addEventListener('click', () => deck.prev());
next.addEventListener('click', () => deck.next());
document.getElementById('overview').addEventListener('click', () => deck.toggleOverview());
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    notice('Use your browser’s full screen command (F11) to present.');
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreen.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const panel = deck.getCurrentSlide()?.querySelector('.is-expanded');
    if (panel) {
      setExpanded(panel, false);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
});
deck.on('slidechanged', event => {
  event.previousSlide?.querySelectorAll('.is-expanded').forEach(panel => setExpanded(panel, false));
  enterSlide();
});
deck.on('fragmentshown', sync);
deck.on('fragmenthidden', sync);
deck.initialize().then(enterSlide);
window.workshopDeck = deck;
