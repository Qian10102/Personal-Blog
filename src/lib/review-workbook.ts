import JSZip from "jszip";
import { SaxesParser } from "saxes";

const maxEntries = 256;
const maxEntryBytes = 4 * 1024 * 1024;
const maxExpandedBytes = 16 * 1024 * 1024;

// JSZip exposes this streaming API at runtime but omits it from JSZipObject's types.
type StreamingEntry = JSZip.JSZipObject & {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

function expandedSize(entry: JSZip.JSZipObject, remaining: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    const stream = (entry as StreamingEntry).internalStream("uint8array");
    stream
      .on("data", (chunk) => {
        if (settled) return;
        bytes += chunk.byteLength;
        if (bytes > maxEntryBytes || bytes > remaining) {
          settled = true;
          // Retain no output chunks. Pause stops later compressed chunks; JSZip
          // may still finish its current fixed-size compressed chunk.
          stream.pause();
          reject(new Error("workbook_too_large"));
        }
      })
      .on("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      })
      .on("end", () => {
        if (settled) return;
        settled = true;
        resolve(bytes);
      })
      .resume();
  });
}

async function checkExpansion(zip: JSZip): Promise<void> {
  const entries = Object.values(zip.files);
  if (entries.length > maxEntries) throw new Error("workbook_too_large");
  let total = 0;
  // ExcelJS expands all members, even ones it subsequently ignores. Check every
  // member sequentially before any complete string/buffer allocation or parsing.
  // Count actual output, not attacker-controlled ZIP size declarations.
  for (const entry of entries)
    if (!entry.dir) total += await expandedSize(entry, maxExpandedBytes - total);
}

// Timetable imports use cell values only. ExcelJS assumes specific note/VML
// filenames and cannot load otherwise valid files produced by openpyxl.
// Remove only those relationships from an in-memory copy, preserving the source
// file, cell data, styles (including time formats), and other relationships.
export async function workbookWithoutNotes(
  buffer: ArrayBuffer,
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  await checkExpansion(zip);
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
