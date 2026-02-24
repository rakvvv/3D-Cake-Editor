/**
 * Generuje dwa zestawy miniaturek dekoracji 3D: light (jasne tło) i dark (ciemne tło).
 * Zapis do: public/assets/decorations/thumbnails/light/*.png i thumbnails/dark/*.png.
 * Aplikacja wybiera zestaw według aktualnego motywu (tryb jasny/ciemny).
 * Uruchomienie: npm run thumbs:decorations   lub   npm run thumbs:decorations:force  (nadpisuje istniejące).
 */
import fs from 'fs';
import path from 'path';
import express from 'express';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');

const DECORATIONS_PATH = path.join(repoRoot, 'backend', 'src', 'main', 'resources', 'decorations.json');
const THUMBNAILS_BASE = path.join(frontendRoot, 'public', 'assets', 'decorations', 'thumbnails');
const THEMES = ['light', 'dark'];
const RENDERER_PAGE = '/tools/thumb-renderer/thumb-renderer.html';
const PORT = process.env.THUMB_PORT ? Number(process.env.THUMB_PORT) : 4300;

async function loadDecorations() {
  const raw = await fs.promises.readFile(DECORATIONS_PATH, 'utf-8');
  return JSON.parse(raw);
}

function resolveRendererUrl(modelUrl, theme) {
  const encoded = encodeURIComponent(modelUrl);
  return `http://localhost:${PORT}${RENDERER_PAGE}?model=${encoded}&theme=${theme}`;
}

async function ensureOutputDirs() {
  for (const theme of THEMES) {
    await fs.promises.mkdir(path.join(THUMBNAILS_BASE, theme), { recursive: true });
  }
}

function createServer() {
  const app = express();
  app.use(express.static(path.join(frontendRoot, 'public')));
  app.use('/tools', express.static(path.join(frontendRoot, 'tools')));
  app.use('/node_modules', express.static(path.join(frontendRoot, 'node_modules')));
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`Static server running at http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

function resolveModelUrl(modelFileName) {
  return `http://localhost:${PORT}/models/${encodeURIComponent(modelFileName)}`;
}


async function generateThumbnails(force = false) {
  const decorations = await loadDecorations();
  await ensureOutputDirs();
  const server = await createServer();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 256, height: 256 });

    let successCount = 0;
    for (const theme of THEMES) {
      const outputDir = path.join(THUMBNAILS_BASE, theme);
      console.log(`\n--- Theme: ${theme} ---`);
      for (const decoration of decorations) {
        const outputPath = path.join(outputDir, `${decoration.id}.png`);
        if (!force && fs.existsSync(outputPath)) {
          console.log(`Skipping ${decoration.id} [${theme}] (already exists)`);
          continue;
        }

        const modelUrl = resolveModelUrl(decoration.modelFileName);
        const rendererUrl = resolveRendererUrl(modelUrl, theme);

        try {
          await page.goto(rendererUrl, { waitUntil: 'networkidle0' });
          await page.waitForFunction(() => window.__THUMB_READY__ === true, { timeout: 30000 });

          const ok = await page.evaluate(() => window.__THUMB_OK__ === true);
          if (!ok) {
            console.error(`Renderer failed for ${decoration.id} [${theme}]. Skipping screenshot.`);
            continue;
          }

          await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

          await page.screenshot({ path: outputPath });
          successCount += 1;
          console.log(`Generated ${decoration.id} [${theme}]`);
        } catch (error) {
          console.error(`Failed ${decoration.id} [${theme}]:`, error?.message ?? error);
        }
      }
    }

    console.log(`\nFinished. Generated ${successCount} thumbnails total.`);
  } finally {
    await browser.close();
    server.close();
  }
}

const force = process.argv.includes('--force');
void generateThumbnails(force).catch((error) => {
  console.error('Thumbnail generation failed', error);
  process.exit(1);
});
