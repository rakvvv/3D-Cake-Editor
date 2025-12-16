import fs from 'fs';
import path from 'path';
import express from 'express';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DECORATIONS_PATH = path.join(projectRoot, 'backend', 'src', 'main', 'resources', 'decorations.json');
const OUTPUT_DIR = path.join(projectRoot, 'public', 'assets', 'decorations', 'thumbnails');
const RENDERER_PAGE = '/tools/thumb-renderer/thumb-renderer.html';
const PORT = process.env.THUMB_PORT ? Number(process.env.THUMB_PORT) : 4300;

async function loadDecorations() {
  const raw = await fs.promises.readFile(DECORATIONS_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function ensureOutputDir() {
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
}

function createServer() {
  const app = express();
  app.use(express.static(path.join(projectRoot, 'public')));
  app.use('/tools', express.static(path.join(projectRoot, 'tools')));
  app.use('/node_modules', express.static(path.join(projectRoot, 'node_modules')));
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

function resolveRendererUrl(modelUrl) {
  const encoded = encodeURIComponent(modelUrl);
  return `http://localhost:${PORT}${RENDERER_PAGE}?model=${encoded}`;
}

async function generateThumbnails(force = false) {
  const decorations = await loadDecorations();
  await ensureOutputDir();
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
    for (const decoration of decorations) {
      const outputPath = path.join(OUTPUT_DIR, `${decoration.id}.png`);
      if (!force && fs.existsSync(outputPath)) {
        console.log(`Skipping ${decoration.id} (already exists)`);
        continue;
      }

      const modelUrl = resolveModelUrl(decoration.modelFileName);
      const rendererUrl = resolveRendererUrl(modelUrl);

      try {
        await page.goto(rendererUrl, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => window.__THUMB_READY__ === true, { timeout: 30000 });

        const ok = await page.evaluate(() => window.__THUMB_OK__ === true);
        if (!ok) {
          console.error(`Renderer failed for ${decoration.id}. Skipping screenshot.`);
          continue;
        }

        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

        await page.screenshot({ path: outputPath });
        successCount += 1;
        console.log(`Generated thumbnail for ${decoration.id}`);
      } catch (error) {
        console.error(`Failed to generate thumbnail for ${decoration.id}:`, error?.message ?? error);
      }
    }

    console.log(`Finished. Generated ${successCount} thumbnails.`);
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
