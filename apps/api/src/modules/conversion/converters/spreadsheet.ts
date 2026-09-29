import ExcelJS from "exceljs";

export async function convertSpreadsheet(
  input: Buffer,
  sourceExt: string,
  targetFormat: string,
): Promise<{ data: Buffer; mimeType: string }> {
  const fmt = targetFormat.toLowerCase();

  if (sourceExt === "xlsx" && fmt === "csv") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(input as any);
    const sheet = wb.worksheets[0];
    const lines: string[] = [];
    sheet.eachRow((row) => {
      const cells = (row.values as (string | number | null | undefined)[]).slice(1); // index 0 is unused by exceljs
      lines.push(cells.map(csvEscape).join(","));
    });
    return { data: Buffer.from(lines.join("\r\n"), "utf-8"), mimeType: "text/csv" };
  }

  if (sourceExt === "csv" && fmt === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Sheet1");
    const text = input.toString("utf-8");
    const rows = text.split(/\r?\n/).filter((r) => r.length > 0);
    for (const row of rows) {
      sheet.addRow(parseCsvLine(row));
    }
    const buf = await wb.xlsx.writeBuffer();
    return { data: Buffer.from(buf), mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  }

  throw new Error(`Конвертация ${sourceExt} → ${fmt} не поддерживается`);
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCsvLine(line: string): string[] {
  // Minimal CSV parsing (handles quoted fields with commas/escaped quotes) —
  // sufficient for round-tripping our own xlsx→csv export; a full RFC 4180
  // parser is out of scope for the MVP.
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}
