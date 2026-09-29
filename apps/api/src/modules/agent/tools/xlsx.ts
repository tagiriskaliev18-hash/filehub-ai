import ExcelJS from "exceljs";

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs's bundled @types/node version defines a non-generic `Buffer`,
  // which structurally mismatches Node 22's generic `Buffer<T>` — a type-only
  // clash, not a real incompatibility, hence the cast.
  await wb.xlsx.load(buffer as any);
  return wb;
}

function sheetOrThrow(wb: ExcelJS.Workbook, sheetName?: string): ExcelJS.Worksheet {
  const sheet = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
  if (!sheet) throw new Error(sheetName ? `Лист "${sheetName}" не найден` : "В книге нет листов");
  return sheet;
}

export async function readSheet(buffer: Buffer, sheetName?: string, maxRows = 200): Promise<string> {
  const wb = await loadWorkbook(buffer);
  const sheet = sheetOrThrow(wb, sheetName);
  const lines: string[] = [`Лист: ${sheet.name} (${sheet.rowCount} строк x ${sheet.columnCount} столбцов)`];
  const rowLimit = Math.min(sheet.rowCount, maxRows);
  for (let r = 1; r <= rowLimit; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      const cell = row.getCell(c);
      cells.push(`${cell.address}=${formatCellValue(cell)}`);
    }
    lines.push(cells.join(" | "));
  }
  return lines.join("\n");
}

function formatCellValue(cell: ExcelJS.Cell): string {
  if (cell.formula) return `=${cell.formula}`;
  if (cell.value === null || cell.value === undefined) return "";
  return String(cell.value);
}

export async function listSheetNames(buffer: Buffer): Promise<string[]> {
  const wb = await loadWorkbook(buffer);
  return wb.worksheets.map((s) => s.name);
}

export async function setCell(buffer: Buffer, sheetName: string | undefined, cellRef: string, value: string | number): Promise<Buffer> {
  const wb = await loadWorkbook(buffer);
  const sheet = sheetOrThrow(wb, sheetName);
  sheet.getCell(cellRef).value = value;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function setFormula(buffer: Buffer, sheetName: string | undefined, cellRef: string, formula: string): Promise<Buffer> {
  const wb = await loadWorkbook(buffer);
  const sheet = sheetOrThrow(wb, sheetName);
  sheet.getCell(cellRef).value = { formula: formula.replace(/^=/, "") };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function addSheet(buffer: Buffer, name: string): Promise<Buffer> {
  const wb = await loadWorkbook(buffer);
  wb.addWorksheet(name);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
