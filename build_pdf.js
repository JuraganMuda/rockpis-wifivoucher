const fs = require('fs');
const path = require('path');

const mdPath = path.join(__dirname, 'MASTER_SYSTEM_DOCUMENTATION.md');
const htmlPath = path.join(__dirname, 'documentation_print.html');

if (!fs.existsSync(mdPath)) {
  console.error('File markdown tidak ditemukan:', mdPath);
  process.exit(1);
}

const markdownContent = fs.readFileSync(mdPath, 'utf8');

const htmlTemplate = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MASTER SYSTEM DOCUMENTATION: RTNA WI-FI VOUCHER SYSTEM</title>
  
  <!-- Google Fonts: Inter & JetBrains Mono -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  
  <!-- Marked.js, Highlight.js, & Mermaid -->
  <script src="https://cdn.jsdelivr.net/npm/marked@9.1.6/marked.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark-dimmed.min.css">
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/highlight.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>

  <style>
    :root {
      --primary: #4f46e5;
      --primary-dark: #3730a3;
      --text-main: #0f172a;
      --text-muted: #475569;
      --bg-code: #0f172a;
      --border-color: #cbd5e1;
      --table-header: #1e293b;
      --table-zebra: #f8fafc;
    }

    * {
      box-sizing: border-box;
      -webkit-font-smoothing: antialiased;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.58;
      color: var(--text-main);
      background-color: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 12.8px;
    }

    .container {
      max-width: 860px;
      margin: 0 auto;
      padding: 20px 28px;
    }

    /* Cover / Header Card */
    .cover-card {
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #4338ca 100%);
      color: #ffffff;
      border-radius: 14px;
      padding: 32px 30px;
      margin-bottom: 24px;
      position: relative;
      overflow: hidden;
      page-break-after: avoid;
      break-after: avoid;
    }

    .cover-badge {
      display: inline-block;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(8px);
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 12px;
      border: 1px solid rgba(255, 255, 255, 0.25);
    }

    .cover-title {
      font-size: 23px;
      font-weight: 800;
      line-height: 1.25;
      margin: 0 0 6px 0;
      color: #ffffff;
      letter-spacing: -0.02em;
    }

    .cover-subtitle {
      font-size: 13px;
      color: #c7d2fe;
      margin: 0 0 18px 0;
      font-weight: 400;
      line-height: 1.4;
    }

    .cover-meta {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
      padding-top: 14px;
      font-size: 11px;
      color: #e0e7ff;
    }

    .cover-meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Headings */
    h1, h2, h3, h4 {
      color: #0f172a;
      font-weight: 700;
      line-height: 1.3;
      page-break-after: avoid;
      break-after: avoid;
    }

    h2 {
      font-size: 16px;
      margin-top: 24px;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 2px solid #e2e8f0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Explicit Page Break Class */
    .page-break {
      page-break-before: always !important;
      break-before: page !important;
    }

    h3 {
      font-size: 13.8px;
      margin-top: 18px;
      margin-bottom: 8px;
      color: #1e293b;
    }

    h4 {
      font-size: 12.5px;
      margin-top: 14px;
      margin-bottom: 6px;
      color: #334155;
    }

    p {
      margin: 0 0 11px 0;
      color: #334155;
    }

    strong {
      color: #0f172a;
      font-weight: 600;
    }

    ul, ol {
      margin: 0 0 12px 0;
      padding-left: 22px;
      color: #334155;
    }

    li {
      margin-bottom: 4px;
    }

    hr {
      border: none;
      height: 1px;
      background: #e2e8f0;
      margin: 20px 0;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      margin: 14px 0 18px 0;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border-color);
      page-break-inside: avoid;
      break-inside: avoid;
      font-size: 11.8px;
    }

    th {
      background-color: var(--table-header);
      color: #ffffff;
      font-weight: 600;
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid #334155;
    }

    td {
      padding: 8px 12px;
      border-bottom: 1px solid #e2e8f0;
      color: #334155;
      vertical-align: top;
    }

    tr:nth-child(even) td {
      background-color: var(--table-zebra);
    }

    tr:last-child td {
      border-bottom: none;
    }

    /* Code Blocks */
    code {
      font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
      font-size: 10.8px;
    }

    p code, li code, td code {
      background-color: #f1f5f9;
      color: #be185d;
      padding: 2px 5px;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
      font-weight: 500;
    }

    pre {
      background-color: var(--bg-code);
      border-radius: 8px;
      padding: 12px 14px;
      margin: 12px 0 16px 0;
      overflow-x: auto;
      border: 1px solid #334155;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    pre code {
      background: transparent;
      color: #e2e8f0;
      padding: 0;
      border: none;
      font-size: 10.8px;
      line-height: 1.5;
    }

    /* Mermaid Container Card - Block mode strictly avoids Chromium flex print bug */
    .mermaid-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 16px 12px;
      margin: 14px 0 18px 0;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
      display: block;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
    }

    .mermaid-target {
      width: 100%;
      text-align: center;
      display: block;
    }

    .mermaid-target svg {
      max-width: 100% !important;
      max-height: 480px !important;
      height: auto !important;
      display: inline-block;
      margin: 0 auto;
    }

    /* Alerts */
    .alert-box {
      border-radius: 8px;
      padding: 10px 14px;
      margin: 14px 0;
      border-left: 4px solid;
      font-size: 11.8px;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .alert-important {
      background-color: #eef2ff;
      border-color: #4f46e5;
      color: #312e81;
    }

    .alert-note {
      background-color: #f0fdf4;
      border-color: #16a34a;
      color: #14532d;
    }

    .alert-title {
      font-weight: 700;
      margin-bottom: 3px;
    }

    blockquote {
      margin: 14px 0;
      padding: 10px 16px;
      background-color: #f8fafc;
      border-left: 4px solid var(--primary);
      border-radius: 0 8px 8px 0;
      color: #334155;
      font-style: italic;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    blockquote p {
      margin: 0;
      line-height: 1.6;
    }

    a {
      color: var(--primary);
      text-decoration: none;
      font-weight: 600;
    }

    a:hover {
      text-decoration: underline;
    }

    /* Math formula card */
    .formula-card {
      background: #f8fafc;
      border: 1px dashed #94a3b8;
      border-radius: 8px;
      padding: 9px 14px;
      margin: 12px 0;
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
      color: #1e293b;
      font-size: 11.5px;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    /* Print Specifics */
    @media print {
      body {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      
      @page {
        size: A4 portrait;
        margin: 14mm 12mm 15mm 12mm;
      }

      .container {
        padding: 0;
        max-width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header Cover -->
    <div class="cover-card">
      <div class="cover-badge">Buku Panduan Teknis & Manual Operasional</div>
      <h1 class="cover-title">MASTER SYSTEM DOCUMENTATION<br>RTNA WI-FI VOUCHER SYSTEM</h1>
      <div class="cover-subtitle">
        Arsitektur Sistem Captive Portal Mandiri Berbasis Single Board Computer (Rock Pi S ARM64)
      </div>
      <div class="cover-meta">
        <div class="cover-meta-item">📌 <strong>Versi:</strong> 2.0 (Final Production Edition)</div>
        <div class="cover-meta-item">⚡ <strong>Perangkat:</strong> Rock Pi S V1.3 (RAM 512MB)</div>
        <div class="cover-meta-item">🛡️ <strong>Keamanan:</strong> Zero-Touch MAC Trust</div>
        <div class="cover-meta-item">🔄 <strong>Resiliensi:</strong> PLN-Proof Auto-Healing 24/7</div>
        <div class="cover-meta-item" style="grid-column: span 2; border-top: 1px dashed rgba(255, 255, 255, 0.2); padding-top: 8px; margin-top: 2px;">
          ✍️ <strong>Arsitek & Pengembang:</strong> "Salam Hangat dari Bintaro - Indonesia" &bull; <a href="https://www.instagram.com/juraganmuda/" style="color:#ffffff; text-decoration:underline;">@JuraganMuda</a> | IG
        </div>
      </div>
    </div>

    <!-- Konten Rendered -->
    <div id="content"></div>
  </div>

  <script id="raw-markdown" type="text/plain">
${markdownContent.replace(/<\/script>/gi, '<\\/script>')}
  </script>

  <script>
    async function init() {
      if (document.fonts) {
        await document.fonts.ready;
      }

      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        fontFamily: "'Inter', sans-serif"
      });

      const rawMd = document.getElementById('raw-markdown').textContent;
      
      // Bersihkan duplikasi judul markdown di bagian paling atas
      let cleanMd = rawMd.replace(/^[\\s\\S]*?---\\s*\\r?\\n/, '');

      const renderer = new marked.Renderer();
      let diagramIndex = 0;
      const diagramDefinitions = [];

      // Render Mermaid diagrams dengan ID unik dan simpan definisi grafiknya
      const originalCode = renderer.code.bind(renderer);
      renderer.code = function(code, lang) {
        if (lang === 'mermaid') {
          const currentIndex = diagramIndex++;
          diagramDefinitions.push({ index: currentIndex, code: code });
          return '<div class="mermaid-card"><div class="mermaid-target" id="diagram-container-' + currentIndex + '"></div></div>';
        }
        return originalCode(code, lang);
      };

      marked.setOptions({
        renderer: renderer,
        highlight: function(code, lang) {
          if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
          }
          return hljs.highlightAuto(code).value;
        },
        gfm: true,
        breaks: false
      });

      let renderedHtml = marked.parse(cleanMd);

      // Manajemen Halaman Presisi (Page-Breaks)
      // Bab 2 mulai halaman baru
      renderedHtml = renderedHtml.replace(/(<h2 id="2-[\\s\\S]*?">)/i, '<div class="page-break"></div>$1');
      // Sub-bab 2.B Diagram Topologi mulai halaman baru agar lega
      renderedHtml = renderedHtml.replace(/(<h3 id="b-diagram-topologi-jaringan">)/i, '<div class="page-break"></div>$1');
      // Sub-bab 2.C Skema Pengalamatan IP mulai halaman baru bersama Bab 3
      renderedHtml = renderedHtml.replace(/(<h3 id="c-alokasi-skema-pengalamatan-ip-ip-addressing-scheme">)/i, '<div class="page-break"></div>$1');
      // Bab 4 Docker Stack mulai halaman baru
      renderedHtml = renderedHtml.replace(/(<h2 id="4-[\\s\\S]*?">)/i, '<div class="page-break"></div>$1');
      // Bab 5 Alur AppSheet mulai halaman baru
      renderedHtml = renderedHtml.replace(/(<h2 id="5-[\\s\\S]*?">)/i, '<div class="page-break"></div>$1');
      // Bab 6 Alur Pengguna mulai halaman baru
      renderedHtml = renderedHtml.replace(/(<h2 id="6-[\\s\\S]*?">)/i, '<div class="page-break"></div>$1');
      // Sub-bab 6.B Zero-Touch & diagramnya mulai halaman baru
      renderedHtml = renderedHtml.replace(/(<h3 id="b-fitur-zero-touch-auto-trust-bebas-login-ulang">)/i, '<div class="page-break"></div>$1');
      // Bab 7 Ketahanan PLN & Watchdog mulai halaman baru
      renderedHtml = renderedHtml.replace(/(<h2 id="7-[\\s\\S]*?">)/i, '<div class="page-break"></div>$1');
      // Bab 8 Cheatsheet mulai halaman baru
      renderedHtml = renderedHtml.replace(/(<h2 id="8-[\\s\\S]*?">)/i, '<div class="page-break"></div>$1');
      // Bab 9 Kesimpulan mulai halaman baru
      renderedHtml = renderedHtml.replace(/(<h2 id="9-[\\s\\S]*?">)/i, '<div class="page-break"></div>$1');

      // Format Alert Blocks: [!NOTE] dan [!IMPORTANT]
      renderedHtml = renderedHtml.replace(/<blockquote>\\s*<p>\\s*\\[!IMPORTANT\\]([\\s\\S]*?)<\\/blockquote>/gi, function(match, inner) {
        return '<div class="alert-box alert-important"><div class="alert-title">⚠️ PENTING (CRITICAL NOTICE)</div><p style="margin:0;">' + inner.trim() + '</p></div>';
      });
      renderedHtml = renderedHtml.replace(/<blockquote>\\s*<p>\\s*\\[!NOTE\\]([\\s\\S]*?)<\\/blockquote>/gi, function(match, inner) {
        return '<div class="alert-box alert-note"><div class="alert-title">ℹ️ CATATAN SISTEM (SYSTEM NOTE)</div><p style="margin:0;">' + inner.trim() + '</p></div>';
      });

      // Format Math Blocks $$...$$
      renderedHtml = renderedHtml.replace(/\\$\\$(.*?)\\$\\$/gi, function(match, formula) {
        let cleanFormula = formula.replace(/\\\\text\\{(.*?)\\}/g, '$1').replace(/\\\\/g, '');
        return '<div class="formula-card">' + cleanFormula + '</div>';
      });

      document.getElementById('content').innerHTML = renderedHtml;

      // Render setiap diagram Mermaid secara mandiri dengan ID unik
      for (const diag of diagramDefinitions) {
        try {
          const targetEl = document.getElementById('diagram-container-' + diag.index);
          if (targetEl) {
            const { svg } = await mermaid.render('mermaid-svg-' + diag.index, diag.code.trim());
            targetEl.innerHTML = svg;
          }
        } catch (err) {
          console.error('Error rendering diagram ' + diag.index, err);
        }
      }

      console.log('All Mermaid diagrams rendered successfully');
    }

    init();
  </script>
</body>
</html>`;

fs.writeFileSync(htmlPath, htmlTemplate, 'utf8');
console.log('HTML template berhasil diperbarui.');
