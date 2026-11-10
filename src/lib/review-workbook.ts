import JSZip from "jszip";
import { SaxesParser } from "saxes";

// Timetable imports use cell values only. ExcelJS assumes specific note/VML
// filenames and cannot load otherwise valid files produced by openpyxl.
// Remove only those relationships from an in-memory copy, preserving the source
// file, cell data, styles (including time formats), and other relationships.
export async function workbookWithoutNotes(
  buffer: ArrayBuffer,
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  const namespace =
    "http://schemas.openxmlformats.org/package/2006/relationships";
  const noteTypes = new Set([
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing",
  ]);
  const escapeAttribute = (value: string) =>
    value.replace(
      /[&<>"\r\n\t]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "\r": "&#13;",
          "\n": "&#10;",
          "\t": "&#9;",
        })[char]!,
    );
  let changed = false;
  for (const file of zip.file(/^xl\/worksheets\/_rels\/[^/]+\.xml\.rels$/)) {
    const relationships: string[] = [];
    let removed = false;
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", (tag) => {
      if (tag.local !== "Relationship" || tag.uri !== namespace) return;
      const attributes = Object.values(tag.attributes).filter((a) => !a.prefix);
      if (
        noteTypes.has(attributes.find((a) => a.local === "Type")?.value ?? "")
      ) {
        removed = true;
        return;
      }
      relationships.push(
        `<Relationship ${attributes.map((a) => `${a.local}="${escapeAttribute(a.value)}"`).join(" ")}/>`,
      );
    });
    parser.write(await file.async("string")).close();
    if (removed) {
      zip.file(
        file.name,
        `<Relationships xmlns="${namespace}">${relationships.join("")}</Relationships>`,
      );
      changed = true;
    }
  }
  return changed ? zip.generateAsync({ type: "arraybuffer" }) : buffer;
}
