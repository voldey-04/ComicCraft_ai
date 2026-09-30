import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { generateOutline, generateStory } from './src/server/geminiService.js';
import { generateImage, ensureDirectories } from './src/server/imageService.js';
import { buildComicLayout } from './src/server/layoutBuilder.js';
import { savePdf } from './src/server/exporters.js';
import { ComicPanel, ComicStory, PanelOutline } from './src/types/comic.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Ensure required static folders exist
ensureDirectories();

// In-memory archive of generated comics (satisfies PDF page 20 all_users.html / archive)
const comicArchive: ComicStory[] = [];

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static panels and exports with explicit mime types
app.use('/static/panels', express.static(path.resolve(process.cwd(), 'static', 'panels')));
app.use('/static/exports', express.static(path.resolve(process.cwd(), 'static', 'exports'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
    }
  }
}));
app.use('/static', express.static(path.resolve(process.cwd(), 'static')));

// Dedicated PDF download route with explicit attachment header
app.get(['/api/download-pdf/:filename', '/download/:filename'], (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.resolve(process.cwd(), 'static', 'exports', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'PDF file not found' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
});

// Endpoint serving the README.md documentation
app.get('/api/readme', (_req: Request, res: Response) => {
  const readmePath = path.resolve(process.cwd(), 'README.md');
  if (fs.existsSync(readmePath)) {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(readmePath);
  } else {
    res.status(404).json({ error: 'README.md not found' });
  }
});

// Helper to render simple Jinja2-like templates
function renderTemplate(templateName: string, context: Record<string, any>): string {
  const filePath = path.resolve(process.cwd(), 'templates', templateName);
  if (!fs.existsSync(filePath)) {
    return `<h1>Template ${templateName} not found</h1>`;
  }
  let html = fs.readFileSync(filePath, 'utf-8');

  // Replace simple variables {{ key }}
  for (const [key, val] of Object.entries(context)) {
    if (typeof val === 'string' || typeof val === 'number') {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      html = html.replace(regex, String(val));
    }
  }

  // Simple loop for layout: {% for panel in layout %} ... {% endfor %}
  const loopRegex = /\{%\s*for\s+(\w+)\s+in\s+layout\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/;
  const loopMatch = html.match(loopRegex);
  if (loopMatch && Array.isArray(context.layout)) {
    const itemVar = loopMatch[1];
    const itemTemplate = loopMatch[2];
    const generatedHtml = context.layout
      .map((item: any) => {
        let panelHtml = itemTemplate;
        // replace {{ panel.prop }}
        for (const [propKey, propVal] of Object.entries(item)) {
          const varRegex = new RegExp(`{{\\s*${itemVar}\\.${propKey}\\s*}}`, 'g');
          panelHtml = panelHtml.replace(varRegex, String(propVal ?? ''));
        }
        // handle simple {% if panel.prop %}
        panelHtml = panelHtml.replace(
          new RegExp(`\\{%\\s*if\\s+${itemVar}\\.(\\w+)\\s*%\\}([\\s\\S]*?)\\{%\\s*endif\\s*%\\}`, 'g'),
          (_m, prop, inner) => (item[prop] ? inner : '')
        );
        return panelHtml;
      })
      .join('\n');
    html = html.replace(loopRegex, generatedHtml);
  }

  // Handle remaining {% if pdf_path %}
  if (context.pdf_path) {
    html = html.replace(/\{%\s*if\s+pdf_path\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, '$1');
  } else {
    html = html.replace(/\{%\s*if\s+pdf_path\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, '');
  }

  return html;
}

// -------------------------------------------------------------
// Core Comic Generation Pipeline
// -------------------------------------------------------------
async function runComicPipeline(params: {
  prompt: string;
  character_name: string;
  setting: string;
  tone: string;
  style: string;
  mode?: 'high_thinking' | 'low_latency' | 'standard';
}) {
  const { prompt, character_name, setting, tone, style, mode = 'standard' } = params;

  // Combine user input into a single full prompt as in PDF Page 16:
  const fullPrompt = `${prompt}\nThe main character is ${character_name}.\nThe setting is a ${setting}.\nThe tone is ${tone}. The art style is ${style}.`;

  // Step 1: Generate panel outline (gemini_flash.py)
  const outline: PanelOutline[] = await generateOutline(fullPrompt, mode);

  // Step 2: Generate story (gemini_pro.py)
  const fullStory: string = await generateStory(
    outline,
    { prompt, character_name, setting, tone, style },
    mode
  );

  // Step 3: Generate images for each panel (image_generator.py)
  const imagePaths: string[] = [];
  for (let i = 0; i < outline.length; i++) {
    const panel = outline[i];
    const imgPrompt = panel.image_prompt || `${style} comic panel of ${character_name} in ${setting}, ${tone} atmosphere`;
    const imgPath = await generateImage(imgPrompt, panel.panel, panel.title, style);
    imagePaths.push(imgPath);
  }

  // Step 4: Build Layout (layout_builder.py)
  const layout: ComicPanel[] = buildComicLayout(imagePaths, fullStory, outline);

  // Step 5: Export to PDF (exporters.py)
  const pdfPath = savePdf(layout, `${character_name}'s Adventure`);

  const comicRecord: ComicStory = {
    id: `comic_${Date.now()}`,
    prompt,
    character_name,
    setting,
    tone,
    style,
    model_used:
      mode === 'high_thinking'
        ? 'gemini-3.1-pro-preview (Thinking Level HIGH)'
        : mode === 'low_latency'
        ? 'gemini-3.1-flash-lite'
        : 'gemini-3.5-flash',
    created_at: new Date().toISOString(),
    outline,
    full_story: fullStory,
    layout,
    pdf_path: pdfPath,
  };
  comicArchive.unshift(comicRecord);

  return { layout, pdf_path: pdfPath, outline, full_story: fullStory, record: comicRecord };
}

// -------------------------------------------------------------
// Route: /generate (Matches PDF page 14 & 16)
// Handles both form submissions and JSON requests
// -------------------------------------------------------------
app.post('/generate', async (req: Request, res: Response) => {
  try {
    const prompt = (req.body.prompt as string) || 'A brave fox exploring an enchanted forest.';
    const character_name = (req.body.character_name as string) || 'Free';
    const setting = (req.body.setting as string) || 'Forest';
    const tone = (req.body.tone as string) || 'Dramatic';
    const style = (req.body.style as string) || 'Realistic';
    const mode = (req.body.mode as any) || 'standard';

    const result = await runComicPipeline({ prompt, character_name, setting, tone, style, mode });

    // If client requested JSON (e.g. from React frontend)
    const acceptsJson = req.headers.accept?.includes('application/json') || req.is('application/json');
    if (acceptsJson) {
      return res.json({
        status: 'success',
        layout: result.layout,
        pdf_path: result.pdf_path,
        full_story: result.full_story,
        outline: result.outline,
        record: result.record,
      });
    }

    // HTML Form response -> render comic_preview.html template
    const rendered = renderTemplate('comic_preview.html', {
      layout: result.layout,
      pdf_path: result.pdf_path,
    });
    return res.setHeader('Content-Type', 'text/html').send(rendered);
  } catch (error: any) {
    console.error('Error in /generate:', error);
    res.status(500).json({ error: error.message || 'Generation failed' });
  }
});

// -------------------------------------------------------------
// Route: /generate-comic/json (Matches PDF page 14)
// An API route that accepts JSON payloads and returns comic data
// -------------------------------------------------------------
app.post('/generate-comic/json', async (req: Request, res: Response) => {
  try {
    const { prompt, character_name, setting, tone, style, mode } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Field "prompt" is required' });
    }

    const result = await runComicPipeline({
      prompt,
      character_name: character_name || 'Hero',
      setting: setting || 'Forest',
      tone: tone || 'Dramatic',
      style: style || 'Comic Book',
      mode: mode || 'standard',
    });

    return res.json({
      status: 'success',
      message: 'Comic generated successfully',
      layout: result.layout,
      pdf_path: result.pdf_path,
      outline: result.outline,
      full_story: result.full_story,
      record: result.record,
    });
  } catch (error: any) {
    console.error('Error in /generate-comic/json:', error);
    res.status(500).json({ error: error.message || 'API Comic generation failed' });
  }
});

// Also support GET for /generate-comic/json with query params for easy testing
app.get('/generate-comic/json', async (req: Request, res: Response) => {
  const prompt = (req.query.prompt as string) || 'A brave fox exploring an enchanted forest.';
  const character_name = (req.query.character_name as string) || 'Free';
  const setting = (req.query.setting as string) || 'Forest';
  const tone = (req.query.tone as string) || 'Dramatic';
  const style = (req.query.style as string) || 'Realistic';
  const mode = (req.query.mode as any) || 'standard';

  try {
    const result = await runComicPipeline({ prompt, character_name, setting, tone, style, mode });
    return res.json({
      status: 'success',
      layout: result.layout,
      pdf_path: result.pdf_path,
      outline: result.outline,
      full_story: result.full_story,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// Route: /test-image (Matches PDF page 14 & 16)
// A developer utility route to test image generation from a direct prompt
// -------------------------------------------------------------
app.get('/test-image', async (req: Request, res: Response) => {
  try {
    const prompt = (req.query.prompt as string) || 'A futuristic city at sunset, sci-fi, cinematic, artstation';
    const imagePath = await generateImage(prompt, 1, 'Test Scene', 'Cinematic');
    return res.json({
      message: 'Image generated successfully',
      path: imagePath,
      prompt,
    });
  } catch (error: any) {
    console.error('Error in /test-image:', error);
    res.status(500).json({ error: error.message || 'Image generation failed' });
  }
});

// -------------------------------------------------------------
// Route: /export-success (Matches PDF page 14 & 16)
// -------------------------------------------------------------
app.get('/export-success', (req: Request, res: Response) => {
  const pdfPath = (req.query.pdf_path as string) || '';
  const rendered = renderTemplate('export_success.html', {
    pdf_path: pdfPath,
  });
  res.setHeader('Content-Type', 'text/html').send(rendered);
});

// -------------------------------------------------------------
// Route: /api/all-comics & /all_users (Matches PDF page 20)
// -------------------------------------------------------------
app.get(['/api/all-comics', '/all_users'], (_req: Request, res: Response) => {
  res.json({
    total: comicArchive.length,
    comics: comicArchive,
  });
});

// -------------------------------------------------------------
// Route: /docs (Matches PDF page 7 & 21)
// Interactive API documentation for ComicCraft
// -------------------------------------------------------------
app.get('/docs', (_req: Request, res: Response) => {
  const docsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ComicCraft API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .top-banner { background: #0f172a; color: white; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; }
    .top-banner a { color: #38bdf8; text-decoration: none; font-weight: bold; }
  </style>
</head>
<body>
  <div class="top-banner">
    <div><strong>ComicCraft</strong> - AI Comic Story Creator API</div>
    <div><a href="/">← Return to App</a></div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        spec: {
          openapi: "3.0.0",
          info: {
            title: "ComicCraft API",
            version: "1.0.0",
            description: "FastAPI & Gemini-integrated endpoints for generating multi-panel comics, outlines, illustrations, and PDFs."
          },
          paths: {
            "/generate-comic/json": {
              post: {
                summary: "Generate comic via JSON payload",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          prompt: { type: "string", example: "A brave fox exploring an enchanted forest." },
                          character_name: { type: "string", example: "Free" },
                          setting: { type: "string", example: "Forest" },
                          tone: { type: "string", example: "Dramatic" },
                          style: { type: "string", example: "Comic Book" },
                          mode: { type: "string", enum: ["high_thinking", "low_latency", "standard"], example: "high_thinking" }
                        }
                      }
                    }
                  }
                },
                responses: {
                  200: { description: "Comic generated successfully with layout and PDF path" }
                }
              }
            },
            "/generate": {
              post: {
                summary: "Form-based or JSON comic creation endpoint",
                responses: {
                  200: { description: "Returns HTML comic preview page or JSON result" }
                }
              }
            },
            "/test-image": {
              get: {
                summary: "Test image generation from direct prompt",
                parameters: [
                  { name: "prompt", in: "query", schema: { type: "string" }, description: "Visual prompt" }
                ],
                responses: {
                  200: { description: "Returns generated image path" }
                }
              }
            },
            "/export-success": {
              get: {
                summary: "Success confirmation page after comic PDF export",
                parameters: [
                  { name: "pdf_path", in: "query", schema: { type: "string" } }
                ],
                responses: {
                  200: { description: "Rendered HTML page" }
                }
              }
            },
            "/api/all-comics": {
              get: {
                summary: "List all created comics in current session",
                responses: {
                  200: { description: "List of comic records" }
                }
              }
            }
          }
        },
        dom_id: '#swagger-ui',
      });
    };
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html').send(docsHtml);
});

// -------------------------------------------------------------
// Vite Integration (Development vs Production)
// -------------------------------------------------------------
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ComicCraft server running on port ${PORT}`);
    console.log(`Visit http://127.0.0.1:${PORT} for web app`);
    console.log(`Visit http://127.0.0.1:${PORT}/docs for API documentation`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
});
