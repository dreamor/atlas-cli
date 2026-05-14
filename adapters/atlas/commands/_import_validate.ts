import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

/**
 * Expected month-import columns. Server-side schema is not fully published —
 * these are the conservative columns the SPA emits when downloading the
 * template (per recon §11). Headers may be Chinese in the canonical export;
 * we accept either the canonical key or the Chinese label.
 *
 * Treat this list as a soft contract: missing columns are warned, extras
 * pass through.
 */
export const EXPECTED_MONTH_IMPORT_COLUMNS: ReadonlyArray<string> = [
  'projectId',
  'mp',
  'areaCode',
  'mpType',
  'departmentId',
  'linePlanType',
  'month',
  'value',
];

export interface WorkbookSummary {
  readonly sheetName: string;
  readonly headerRow: ReadonlyArray<string>;
  readonly rowCount: number;
  readonly missingColumns: ReadonlyArray<string>;
  readonly extraColumns: ReadonlyArray<string>;
}

export interface LoadedWorkbook {
  readonly buffer: Buffer;
  readonly summary: WorkbookSummary;
}

/**
 * Load a workbook from disk (.xlsx native, .csv converted in-memory) and
 * return both the binary the server will receive AND a header summary
 * suitable for dry-run validation.
 */
export async function loadWorkbook(filePath: string): Promise<LoadedWorkbook> {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.xlsx') {
    const buffer = await readFile(filePath);
    const summary = await summarizeXlsx(buffer);
    return { buffer, summary };
  }
  if (ext === '.csv') {
    const text = await readFile(filePath, 'utf8');
    const buffer = await csvToXlsxBuffer(text);
    const summary = await summarizeXlsx(buffer);
    return { buffer, summary };
  }
  throw new Error(`Unsupported file type "${ext}". Use .xlsx or .csv.`);
}

export async function summarizeXlsx(buffer: Buffer): Promise<WorkbookSummary> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS expects an ArrayBuffer; convert by slicing the underlying buffer.
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  await wb.xlsx.load(ab);
  const sheet = wb.worksheets[0];
  if (!sheet) {
    return {
      sheetName: '(empty)',
      headerRow: [],
      rowCount: 0,
      missingColumns: [...EXPECTED_MONTH_IMPORT_COLUMNS],
      extraColumns: [],
    };
  }
  const headerRowRaw = sheet.getRow(1);
  const header: string[] = [];
  headerRowRaw.eachCell({ includeEmpty: false }, (cell) => {
    header.push(String(cell.value ?? '').trim());
  });

  return summarizeHeaders(header, sheet.name, sheet.rowCount);
}

export function summarizeHeaders(
  header: ReadonlyArray<string>,
  sheetName: string,
  rowCount: number,
): WorkbookSummary {
  const headerSet = new Set(header.map((h) => h.toLowerCase()));
  const expectedSet = new Set(EXPECTED_MONTH_IMPORT_COLUMNS.map((h) => h.toLowerCase()));

  const missing = EXPECTED_MONTH_IMPORT_COLUMNS.filter(
    (c) => !headerSet.has(c.toLowerCase()),
  );
  const extras = header.filter((c) => !expectedSet.has(c.toLowerCase()));

  // -1 because of header row; clamp at 0.
  const dataRows = Math.max(0, rowCount - 1);

  return {
    sheetName,
    headerRow: header,
    rowCount: dataRows,
    missingColumns: missing,
    extraColumns: extras,
  };
}

async function csvToXlsxBuffer(text: string): Promise<Buffer> {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`CSV parse error: ${first?.message ?? 'unknown'}`);
  }
  const rows = parsed.data;
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  for (const row of rows) {
    sheet.addRow(row);
  }
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
