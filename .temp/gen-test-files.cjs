const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const tempDir = __dirname;

async function main() {
  // ---- 1. Create test .docx ----
  const docxZip = new JSZip();
  docxZip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  docxZip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  docxZip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>轻快文档工具箱测试报告</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>这是一份用于验证 Word 渲染引擎的测试文档。</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>段落一：docx-preview 库能够正确解析 OOXML 格式的 Word 文档，并将内容渲染为 HTML。</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>段落二：支持标题、正文、列表等多种样式。</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>段落三：所有文件处理均在浏览器本地完成，不会上传至任何服务器。</w:t></w:r></w:p>' +
    '</w:body></w:document>');
  const docxBuf = await docxZip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(tempDir, 'test.docx'), docxBuf);
  console.log('Created test.docx, size:', docxBuf.length);

  // ---- 2. Create test .pptx ----
  const pptxZip = new JSZip();
  const slideXml = (title, body) =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>' + title + '</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>' + body + '</a:t></a:r></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld></p:sld>';

  pptxZip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
    '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '</Types>');
  pptxZip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
    '</Relationships>');
  pptxZip.file('ppt/presentation.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:sldIdLst><p:sldId id="1" r:id="rId1"/><p:sldId id="2" r:id="rId2"/></p:sldIdLst></p:presentation>');
  pptxZip.file('ppt/_rels/presentation.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>' +
    '</Relationships>');
  pptxZip.file('ppt/slides/slide1.xml', slideXml('轻快文档工具箱', 'PPT 渲染测试 - 第一页内容：验证 JSZip 解析 PPTX 的文本和布局能力。'));
  pptxZip.file('ppt/slides/slide2.xml', slideXml('功能特性', '完全本地处理 - 无需上传服务器 - 支持多种格式 - 极简界面设计。'));
  const pptxBuf = await pptxZip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(tempDir, 'test.pptx'), pptxBuf);
  console.log('Created test.pptx, size:', pptxBuf.length);

  // ---- 3. Create test .pdf ----
  const pdfContent = '%PDF-1.4\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n' +
    '4 0 obj\n<< /Length 120 >>\nstream\nBT /F1 24 Tf 72 700 Td (PDF Render Test) Tj ET BT /F1 14 Tf 72 660 Td (This is a test PDF for pdfjs-dist rendering.) Tj ET\nendstream\nendobj\n' +
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    'xref\n0 6\n' +
    '0000000000 65535 f \n' +
    '0000000009 00000 n \n' +
    '0000000058 00000 n \n' +
    '0000000115 00000 n \n' +
    '0000000266 00000 n \n' +
    '0000000439 00000 n \n' +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n510\n%%EOF';
  fs.writeFileSync(path.join(tempDir, 'test.pdf'), pdfContent, 'latin1');
  console.log('Created test.pdf');
}

main().catch(console.error);
