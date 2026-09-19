/** Deterministic capture of the real application for the README demo.
 * Requires a local Vite server and Playwright in artifacts/video-work/runtime.
 * No recording hooks are added to the shipped application.
 */
import { chromium } from '../../artifacts/video-work/runtime/node_modules/playwright/index.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const work = resolve(root, 'artifacts/video-work');
const framesPath = resolve(work, 'frames');
await mkdir(framesPath, { recursive: true });
const waveform = JSON.parse(await readFile(resolve(work, 'demo-waveform.json'), 'utf8'));
const audio = JSON.parse(await readFile(resolve(work, 'demo-audio.json'), 'utf8'));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  timeout: 30000,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--hide-scrollbars'],
});
console.log('Headless renderer ready.');
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text()); });
  // Control UI frames explicitly while keeping the original app and interactions.
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options) { super({ ...options, sampleRate: 48000 }); }
    };
  });
  await page.route('**/src/main.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: `${body}\nwindow.__video = { engine, state, renderTime, drawScope, refreshControls };\n` });
  });
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 20000 });
  console.log('Application loaded.');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Start listening', exact: true }).click();
  console.log('Preparing audio.');
  await page.waitForFunction(() => window.__video?.state.loaded && window.__video.engine.playing && !window.__video.state.busy, null, { timeout: 20000, polling: 50 });
  await page.evaluate(async ({ epoch, data }) => {
    const demo = window.__video;
    await demo.engine.start({ epochMs: epoch });
    demo.engine.analyser.fftSize = 1024;
    demo.waveform = data;
    demo.index = 0;
    demo.engine.analyser.getFloatTimeDomainData = target => {
      const samples = demo.waveform.frames[demo.index].samples;
      for (let i = 0; i < target.length; i++) {
        const position = i / (target.length - 1) * (samples.length - 1);
        const a = Math.floor(position), b = Math.min(a + 1, samples.length - 1);
        target[i] = samples[a] + (samples[b] - samples[a]) * (position - a);
      }
    };
    demo.refreshControls();
    demo.renderTime(epoch);
    demo.drawScope();
    document.activeElement?.blur();
  }, { epoch: Date.parse(audio.startIso), data: waveform });
  const selectors = ['.receiver', '.mix-panel', '.clock-display', '.scope', '.minute-panel', '#toggle-tones', '#power', '#utc-clock'];
  const geometry = {};
  for (const selector of selectors) geometry[selector] = await page.locator(selector).boundingBox();
  await writeFile(resolve(work, 'capture-geometry.json'), JSON.stringify({ width: 1440, height: 1050, startIso: audio.startIso, fps: 30, geometry }, null, 2));
  console.log(JSON.stringify(geometry));
  const count = process.argv.includes('--sample') ? 1 : 600;
  for (let frame = 0; frame < count; frame++) {
    if (frame === 468 || frame === 516) await page.getByRole('switch', { name: 'Standard tones', exact: true }).click();
    await page.evaluate(({ frame, epoch }) => {
      const demo = window.__video;
      demo.index = frame;
      demo.renderTime(epoch + frame * 1000 / 30);
      demo.drawScope();
      document.activeElement?.blur();
    }, { frame, epoch: Date.parse(audio.startIso) });
    await page.screenshot({ path: resolve(framesPath, `frame-${String(frame).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 95, animations: 'disabled' });
    if (frame % 100 === 0) console.log(`Captured ${frame + 1}/${count}`);
  }
  await writeFile(resolve(work, 'capture-report.json'), JSON.stringify({ frames: count, fps: 30, errors, viewport: { width: 1440, height: 1050 }, source: 'Actual Vite application, with a deterministic UI clock and worklet-rendered waveform fixtures', toneToggleFrames: [468, 516] }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Capture complete: ${count} frames, zero browser errors.`);
} finally {
  await browser.close();
}
