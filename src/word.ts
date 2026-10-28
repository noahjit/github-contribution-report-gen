import {Document, Packer, Paragraph, TextRun, HeadingLevel} from "docx";

function plain(text: string) {
  return text.replace(/\\([\\`*_\[\]#])/g, "$1").replace(/\*\*/g, "")
    .replace(/&#64;/g, "@").replace(/&#124;/g, "|").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
// Accept only the declaration generator's small Markdown vocabulary, not HTML.
export async function declarationWord(markdown: string): Promise<Buffer> {
  const children: Paragraph[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.trim() || line.startsWith("<details>") || line.startsWith("</details>") || line.startsWith("<summary>")) continue;
    const heading = line.match(/^(#{2,5}) (.+)$/);
    if (heading) {
      const level = heading[1].length;
      children.push(new Paragraph({text: plain(heading[2]).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g," ").trim(),
        heading: level === 2 ? HeadingLevel.TITLE : level === 3 ? HeadingLevel.HEADING_1 : level === 4 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        keepNext: true, spacing: {before: level === 2 ? 0 : 200, after: 100}}));
      continue;
    }
    const checkbox = line.startsWith("- [ ] ");
    const content = plain(checkbox ? "☐ " + line.slice(6) : line.replace(/^- /, "").replace(/^_(.*)_$/, "$1"));
    const field = content.match(/^(\d\. [^:]+:)(.*)$/);
    children.push(new Paragraph({children: field ? [new TextRun({text: field[1], bold: true}), new TextRun(field[2])] : [new TextRun(content)],
      spacing: {after: 120, line: 276}, keepLines: false}));
  }
  return Packer.toBuffer(new Document({title: "AI use declaration draft", creator: "GitHub contribution report",
    styles: {default: {document: {run: {font: "Calibri", size: 22, color: "000000"}}},
      paragraphStyles: [
        {id: "Title", name: "Title", basedOn: "Normal", run: {font: "Calibri", size: 34, bold: true, color: "000000"}},
        ...[1,2,3].map(n => ({id: `Heading${n}`, name: `Heading ${n}`, basedOn: "Normal", run: {font: "Calibri", size: 28 - n * 2, bold: true, color: "000000"}, paragraph: {keepNext: true}})),
      ]},
    sections: [{properties: {page: {size: {width: 12240, height: 15840}, margin: {top: 1080, bottom: 1080, left: 1080, right: 1080}}}, children}]}));
}
