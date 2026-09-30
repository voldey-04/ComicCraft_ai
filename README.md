# ComicCraft - AI Comic Story Creator with Gemini Models

An end-to-end AI-powered web application that automates the comic book creation process using Google's Gemini models and comic illustration pipelines. The system generates structured panel outlines, dialogue scripts, comic-style illustrations, and compiles them into downloadable, print-ready PDF comic books.

---

## 📖 Project Overview

ComicCraft transforms high-level story ideas and prompts into complete, illustrated 5-panel comic strips. By orchestrating multi-tiered generative intelligence, the application structures a narrative arc, develops scene atmospheres and character dialogue, synthesizes matching visual panels, and binds everything into an exportable multi-page publication PDF.

---

## 🏗️ Core Architecture & Pipeline Components

The pipeline consists of five decoupled modules:

### 1. Outline Generation (`gemini_flash.py`)
- **Engine**: Google Gemini Flash (`gemini-3.5-flash` / `gemini-3.1-flash-lite`) & Gemini Pro (`gemini-3.1-pro-preview`)
- **Role**: Takes user prompt, character name, setting, and tone to generate a structured 5-panel outline formatted as JSON.
- **Output Schema**:
  - `panel`: Integer index (1 to 5)
  - `title`: Descriptive comic panel title
  - `scene_description`: Narrative atmosphere and environment setting
  - `image_prompt`: Specific visual prompt crafted for illustration synthesis

### 2. Story Narration & Dialogue Generation (`gemini_pro.py`)
- **Engine**: Google Gemini Pro (`gemini-3.5-flash` / `gemini-3.1-pro-preview`)
- **Role**: Expands the 5-panel outline into an engaging comic book script.
- **Output Structure**:
  - `**Panel [N]: [Title]**`
  - `**SCENE:**` Ambient scene setting and visual cues
  - `**CAPTION:**` Environmental sound effects and atmospheric captions
  - `**NARRATION:**` Internal monologue and story progression
  - `**DIALOGUE:**` Character dialogue lines and speech balloons

### 3. Illustration Synthesis (`image_generator.py`)
- **Engine**: Comic Illustration Synthesis Engine
- **Role**: Sanitizes image prompts from the outline and generates stylized comic illustrations for each panel.
- **Storage**: Renders and stores panels with unique timestamped filenames in `static/panels/`.

### 4. Layout Builder (`layout_builder.py`)
- **Engine**: Backend Layout Orchestrator
- **Role**: Integrates synthesized panel images with their corresponding titles, scene descriptions (formatted in italics), ambient captions, dialogues, and original image prompt references into a unified comic sequence.

### 5. PDF Export & Compilation (`exporters.py`)
- **Engine**: Multi-Page PDF Compiler (FPDF & jsPDF)
- **Role**: Assembles the 5 comic panels into consecutive printable A4 pages with comic banner headers, illustration bounding boxes, and styled dialogue blocks.
- **Storage**: Exports timestamped documents (`comic_YYYYmmdd-HHMMSS.pdf`) into `static/exports/`.

---

## 🌐 Application Endpoints & Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Web application home interface and comic creation studio |
| `POST` | `/generate` | Submits form inputs, executes the 5-step pipeline, and renders the comic preview |
| `POST` | `/generate-comic/json` | REST API endpoint returning full comic JSON payload (outline, script, layout, and PDF path) |
| `GET` | `/api/all-comics` | Retrieves the archive list of previously generated comics |
| `GET` | `/api/download-pdf/:filename` | Dedicated binary download route serving publication PDFs with attachment headers |
| `GET` | `/test-image` | Diagnostic endpoint generating and validating a test comic panel image |
| `GET` | `/export-success` | Confirmation page for completed PDF exports |
| `GET` | `/docs` | Interactive OpenAPI Swagger documentation |

---

## 🎨 Supported Art Styles & Narrative Tones

### Art Styles:
- **Realistic**: High-detail graphic novel realism with cinematic lighting
- **Anime / Manga**: Japanese cell-shaded aesthetics with dramatic screen tones
- **Comic Book**: Classic superhero comic style with bold inks and halftone textures
- **Pixel Art**: 16-bit retro indie game aesthetic

### Narrative Tones:
- **Dramatic & Suspenseful**: Tense pacing and intense character conflicts
- **Light-hearted & Warm**: Heartwarming adventures and wholesome journeys
- **Humorous & Comic**: Comedic timing, slapstick moments, and playful dialogues
- **Poetic & Noir**: Moody atmosphere, reflective monologues, and rich metaphors
- **Action-Packed**: High-stakes trials, dynamic confrontations, and heroic climaxes

---

## ⚙️ Environment Configuration

Set the following variable in your `.env` file:

```env
GEMINI_API_KEY="your-google-gemini-api-key"
```

---

## 🚀 Running the Project

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```
The server will run on `http://localhost:3000` with interactive API documentation available at `http://localhost:3000/docs`.

### Production Build
```bash
npm run build
npm start
```

---

## 📁 Directory Structure

```text
├── index.html                   # HTML entry point
├── metadata.json                # Application metadata
├── requirements.txt             # Python pipeline requirements specification
├── server.ts                    # Full-stack backend server & API routes
├── templates/
│   ├── index.html               # Comic creation form template
│   ├── comic_preview.html       # Web comic reader & panel preview template
│   ├── export_success.html      # PDF export confirmation template
│   └── all_users.html           # Comic archive gallery template
├── src/
│   ├── App.tsx                  # Responsive interactive web interface
│   ├── main.tsx                 # Client application entry point
│   ├── types/
│   │   └── comic.ts             # TypeScript definitions for Comic, Panel, and Outline
│   └── server/
│       ├── geminiService.ts     # Outline & story generation with Gemini models
│       ├── imageService.ts      # Panel illustration generator
│       └── exporters.ts         # Multi-page publication PDF compiler
└── static/
    ├── panels/                  # Synthesized comic panel image assets
    └── exports/                 # Generated multi-page comic PDF files
```
