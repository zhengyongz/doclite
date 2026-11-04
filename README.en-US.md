---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '87687e79-0b49-4c94-a418-9931ed01e3f6'
  PropagateID: '87687e79-0b49-4c94-a418-9931ed01e3f6'
  ReservedCode1: '057be41d-0b79-40e4-8caf-ef5db565251e'
  ReservedCode2: '057be41d-0b79-40e4-8caf-ef5db565251e'
---

# DocLite — Lightweight Document Toolbox

> Chinese version: [README.md](./README.md)

A desktop document toolbox built with Electron. It previews and converts Word, Excel, PPT, PDF, MOBI/AZW3 and Markdown files **entirely on your local machine — no file is ever uploaded to any server**.

## Features

### Document Preview

| Format | Rendering | Zoom |
|--------|-----------|------|
| Word (.docx) | docx-preview → HTML | 50%–200% |
| Excel (.xlsx/.xls) | SheetJS parse to table (incl. BIFF8 legacy format), multi-sheet tabs | 50%–200% |
| PPT (.pptx) | JSZip parse XML, extract shapes/backgrounds/images, absolute-positioned render | 50%–200% |
| PDF (.pdf) | pdfjs-dist per-page render to Canvas | 50%–200% |
| MOBI/AZW3 (.mobi/.azw3) | foliate-js render | 50%–200% |
| Markdown (.md/.markdown) | marked + DOMPurify sanitized render; GFM tables/code blocks/task lists/anchor jumps | 50%–200% |

### Format conversion

| Path | Implementation |
|------|----------------|
| Word → PDF | docx-preview → html2canvas → jsPDF |
| Excel → PDF | SheetJS → HTML table → html2canvas → jsPDF |
| PPT → PDF | JSZip parse → HTML slides → html2canvas → jsPDF |
| PDF → Word | pdf.js text extraction (line-grouped) → docx package |
| PDF → PNG | pdf.js 2x Canvas render → PNG (multi-page ZIP) |
| PDF → MOBI/AZW3 | pdf.js text/image extraction → custom mobiWriter (NCX TOC + TBS index) |

### Other highlights

- Electron desktop app with file-association (double-click a file to open it)
- Single-instance; a second file open is routed to the running window
- Built-in Chinese/English UI — toggle in the header (your choice is remembered; auto-detects system language on first run)
- Responsive layout for desktop and mobile browsers
- Drag-and-drop upload + click upload
- PPT keyboard ←/→ paging
- PDF → MOBI supports image extraction, chapter TOC, TBS index (Kindle/Boox compatible)

## Tech stack

- **React 18** + **Vite 6** — frontend framework & build
- **Electron 33** + **electron-builder** — desktop framework & packaging
- **Tailwind CSS 3** — styling (custom ink/accent palette)
- **SheetJS (xlsx)** — Excel parsing
- **docx-preview** — Word rendering
- **pdfjs-dist v4** — PDF rendering & text extraction
- **JSZip** — PPTX ZIP/XML parsing
- **foliate-js** — MOBI/AZW3 rendering (patched)
- **mobiWriter.js** — in-house MOBI6 generator (zero-dependency, TBS/INDX/CNCX indexes)
- **html2canvas + jsPDF** — HTML → PDF
- **docx** — Word document generation (PDF → Word)

## Installation

### Linux (deb)

```bash
sudo dpkg -i doclite_0.1.0_amd64.deb   # install
doclite                                  # launch
sudo dpkg -r doclite                     # uninstall
```

After install, double-click `.pdf/.docx/.xlsx/.xls/.pptx/.mobi/.azw3/.md/.markdown` to open with DocLite.

### Windows (NSIS)

Download the `.exe` installer and run it. File associations are registered automatically.

### macOS (dmg)

Download the matching `.dmg` from the [Releases page](https://github.com/zhengyongz/doclite/releases/latest):

- **Apple Silicon (M-series)**: `DocLite-x.x.x-arm64.dmg`
- **Intel**: `DocLite-x.x.x-x64.dmg`

Open the dmg and drag DocLite into the Applications folder.

**First launch**: DocLite is **not** Apple Developer-signed (avoids the $99/year cost), so macOS Gatekeeper will block a plain double-click. **Right-click the app → Open → Open** once, or go to **System Settings → Privacy & Security** and click **Open Anyway**. This is the standard first-time step for unsigned apps.

> If macOS says ““DocLite” is damaged and can't be opened” (typically after downloading from the browser, which sets the quarantine flag), run:
> ```bash
> xattr -cr /Applications/DocLite.app
> ```
> then open again. Builds are ad-hoc re-signed (this downgrades “damaged” to “cannot verify developer”); this command clears the download quarantine mark.

> macOS updates: clicking “Download update” opens the Releases page — install the latest dmg manually (auto-update is blocked by Gatekeeper until signing is completed).

### Build from source

```bash
git clone git@github.com:zhengyongz/doclite.git
cd doclite
npm install                       # runs patch-package for the foliate-js patch
npm run dev                       # dev mode
npm run build && npx electron-builder --linux deb   # Linux deb
npm run build && npx electron-builder --win nsis    # Windows NSIS
```

**CI auto-build**: pushing a `v*` tag triggers GitHub Actions (`.github/workflows/release.yml`) to produce macOS (dmg/zip × both arch), Windows (exe + blockmap), Linux (deb + converter components) assets on the Release page. The macOS icon (icon.icns) is generated on CI from `build/icon.png`; it is not committed.

## Project layout

See `README.md` (Chinese) for the annotated directory tree.

## Security

- All reading, rendering and conversion happens inside the **local sandboxed renderer**
- No backend server, no network upload of your files
- No login, no accounts, no data collection
- File buffers are released automatically after the file is closed

## License

[MIT License](./LICENSE)

> AI生成
