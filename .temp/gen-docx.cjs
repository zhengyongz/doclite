const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

async function main() {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '轻快文档工具箱测试报告' })],
        }),
        new Paragraph({
          children: [new TextRun({ text: '这是一份用于验证 Word 渲染引擎的测试文档。' })],
        }),
        new Paragraph({
          children: [new TextRun({ text: '段落一：docx-preview 库能够正确解析 OOXML 格式的 Word 文档，并将内容渲染为 HTML。' })],
        }),
        new Paragraph({
          children: [new TextRun({ text: '段落二：支持标题、正文、列表等多种样式。' })],
        }),
        new Paragraph({
          children: [new TextRun({ text: '段落三：所有文件处理均在浏览器本地完成，不会上传至任何服务器。' })],
        }),
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  const outPath = path.join(__dirname, 'test.docx');
  fs.writeFileSync(outPath, buf);
  console.log('Created test.docx, size:', buf.length);
}

main().catch(console.error);
