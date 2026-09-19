# WWV application showcase

`wwv-demo.mp4` is a 20-second, 1920 × 1080, 30 fps application demo with H.264
video and 48 kHz AAC audio. `wwv-demo-poster.jpg` is its preview image.

The sequence shows the receiver, a recorded time announcement, the 12:35 UTC
minute marker, and the Standard tones switch being turned off and back on.
The soundtrack comes from the application's audio worklet and shipped voice
recordings. There is no added music. Browser frames use a deterministic clock
and waveforms sampled from that soundtrack so the display and audio stay in sync.

## README embed

The root README uses a GitHub video attachment URL on its own line to display
GitHub's inline player, including audio and playback controls:

```md
https://github.com/user-attachments/assets/990113e0-4c42-4cba-a707-936427ecdd45
```

Keep that URL as a standalone paragraph. A relative link to the repository's MP4
opens the file page instead of embedding a player. The MP4 remains here as the
downloadable source, and the poster remains available for other webpages.

After regenerating the video, upload the new MP4 as a GitHub attachment and
replace the URL in both READMEs; changing the repository file does not update the
attachment. See [GitHub's attachment guidance](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).

For a webpage that supports HTML:

```html
<video controls playsinline preload="metadata"
       poster="docs/media/wwv-demo-poster.jpg"
       width="1920" height="1080">
  <source src="docs/media/wwv-demo.mp4" type="video/mp4">
</video>
```

## Reproduce locally

These commands run from the repository root in PowerShell. They require Node.js,
Python 3, Google Chrome, and Windows' Segoe UI and Consolas fonts. Set
`$env:CHROME_PATH` if Chrome is installed somewhere other than
`C:/Program Files/Google/Chrome/Application/chrome.exe`.

1. Install the application and temporary rendering dependencies, then leave the
   development server running in this terminal:

   ```powershell
   npm ci
   python -m pip install Pillow numpy imageio-ffmpeg
   npm install --prefix artifacts/video-work/runtime --no-save --no-package-lock playwright
   npm run dev -- --port 5173 --strictPort
   ```

2. In a second terminal at the repository root, generate the actual signal and
   capture the 600 browser frames:

   ```powershell
   $demoFfmpeg = python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
   node scripts/video/render-audio.mjs --ffmpeg $demoFfmpeg
   node scripts/video/capture-demo.mjs
   ```

   The capture uses `http://127.0.0.1:5173/` by default. Set `$env:DEMO_URL` to
   another local Vite development server URL if needed.

3. Compose the final video and poster:

   ```powershell
   python scripts/video/compose-video.py
   ```

   Use `--preview` to generate the poster and contact sheet without encoding the
   MP4. Scratch frames, audio, the contact sheet, and capture/encoding reports
   are written under the ignored `artifacts/video-work/` directory. Final assets
   are written here. No capture hooks are added to the shipped application.
