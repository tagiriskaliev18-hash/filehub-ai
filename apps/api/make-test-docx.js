const { Document, Packer, Paragraph, HeadingLevel } = require("docx");
const fs = require("fs");
const path = require("path");

const doc = new Document({
  sections: [
    {
      children: [
        new Paragraph({ text: "Отчёт о проекте", heading: HeadingLevel.TITLE }),
        new Paragraph({ text: "Введение", heading: HeadingLevel.HEADING_1 }),
        new Paragraph("Наш проект направлен на автоматизацию рутинных задач."),
        new Paragraph("Проект стартовал в этом квартале."),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(process.env.TEMP, "test-report.docx");
  fs.writeFileSync(out, buf);
  console.log("created:", out);
});
