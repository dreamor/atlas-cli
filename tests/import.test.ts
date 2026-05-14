import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  EXPECTED_MONTH_IMPORT_COLUMNS,
  summarizeHeaders,
  summarizeXlsx,
} from '../adapters/atlas/commands/_import_validate.js';

async function buildXlsxBuffer(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('TestSheet');
  for (const row of rows) {
    sheet.addRow([...row]);
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

describe('summarizeHeaders', () => {
  it('flags missing expected columns and detects extras', () => {
    // Arrange
    const headers = ['projectId', 'mp', 'unknownExtra'];

    // Act
    const out = summarizeHeaders(headers, 'Sheet1', 5);

    // Assert
    expect(out.headerRow).toEqual(headers);
    expect(out.rowCount).toBe(4);
    expect(out.missingColumns).toContain('areaCode');
    expect(out.missingColumns).not.toContain('projectId');
    expect(out.extraColumns).toContain('unknownExtra');
  });

  it('returns no missing when full schema present', () => {
    // Arrange
    const headers = [...EXPECTED_MONTH_IMPORT_COLUMNS];

    // Act
    const out = summarizeHeaders(headers, 'Sheet1', 1);

    // Assert
    expect(out.missingColumns).toEqual([]);
    expect(out.extraColumns).toEqual([]);
  });

  it('treats header matching as case-insensitive', () => {
    // Arrange
    const headers = EXPECTED_MONTH_IMPORT_COLUMNS.map((h) => h.toUpperCase());

    // Act
    const out = summarizeHeaders(headers, 'Sheet1', 1);

    // Assert
    expect(out.missingColumns).toEqual([]);
  });

  it('clamps row count below 0', () => {
    // Arrange + Act
    const out = summarizeHeaders(['projectId'], 'Sheet1', 0);

    // Assert
    expect(out.rowCount).toBe(0);
  });
});

describe('summarizeXlsx (in-memory buffer)', () => {
  it('reads headers and data row count from a real xlsx buffer', async () => {
    // Arrange
    const buf = await buildXlsxBuffer([
      ['projectId', 'mp', 'areaCode'],
      [2548, 'CL48', 'CN'],
      [2548, 'CL49', 'CN'],
    ]);

    // Act
    const out = await summarizeXlsx(buf);

    // Assert
    expect(out.headerRow).toEqual(['projectId', 'mp', 'areaCode']);
    expect(out.rowCount).toBeGreaterThanOrEqual(2);
    expect(out.missingColumns.length).toBeGreaterThan(0);
  });

  it('reports empty header for an empty workbook', async () => {
    // Arrange
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Empty');
    const ab = await wb.xlsx.writeBuffer();
    const buf = Buffer.from(ab as ArrayBuffer);

    // Act
    const out = await summarizeXlsx(buf);

    // Assert
    expect(out.headerRow).toEqual([]);
    expect(out.missingColumns).toEqual([...EXPECTED_MONTH_IMPORT_COLUMNS]);
  });
});
