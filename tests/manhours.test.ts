import { describe, it, expect, vi } from 'vitest';
import { fetchWeeklySummary } from '../adapters/atlas/commands/_manhours.js';
import type { BanmaClient } from '../adapters/atlas/http/client.js';

function mockClient(responseData: unknown): BanmaClient {
  return {
    request: vi.fn().mockResolvedValue({ envelope: { success: true, data: responseData }, data: responseData }),
    rawJson: vi.fn(),
  };
}

const baseOpts = {
  month: '2026-06',
  staffId: '527449',
};

const sampleWeeklyResponse = {
  status: 1,
  code: 1,
  errCode: '1',
  errorMsg: null,
  success: true,
  data: [
    {
      staffId: '527449',
      realname: '王野平',
      manpower: 28.0,
      hc: 189,
      children: [
        {
          staffId: '092480',
          realname: '李海鸥',
          manpower: 5.0,
          hc: 21,
          role: '项目管理',
          department: '斑马网络-斑马智行-PMO-I组',
          detail: [
            {
              id: 193956,
              manpower: 5.0,
              cycle: 1,
              month: 1780243200000,
              projectId: 2548,
              projectName: 'BMW IPA LLM 0726 项目',
              status: 0,
              remark: '项目管理',
            },
          ],
        },
      ],
    },
  ],
};

describe('fetchWeeklySummary', () => {
  it('calls correct endpoint with POST method and body', async () => {
    const client = mockClient(sampleWeeklyResponse);
    await fetchWeeklySummary(client, baseOpts);

    expect(client.request).toHaveBeenCalledTimes(1);
    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(call.path).toBe('/yuntu-service/manpower/weekly/summaryByTeam.json');
    expect(call.method).toBe('POST');
    expect(call.body).toMatchObject({
      month: '2026-06',
      staffIds: [],
      projectIds: [],
      isConfirm: false,
      loginStaffId: '527449',
    });
  });

  it('returns parsed data on success', async () => {
    const client = mockClient(sampleWeeklyResponse);
    const result = await fetchWeeklySummary(client, baseOpts);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.staffId).toBe('527449');
    expect(result.data[0]?.children?.[0]?.detail?.[0]?.manpower).toBe(5.0);
  });

  it('handles empty data array', async () => {
    const client = mockClient({ status: 1, code: 1, success: true, data: [] });
    const result = await fetchWeeklySummary(client, baseOpts);
    expect(result.data).toEqual([]);
  });

  it('passes isConfirm when set', async () => {
    const client = mockClient(sampleWeeklyResponse);
    await fetchWeeklySummary(client, { ...baseOpts, isConfirm: true });
    const call = (client.request as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect((call.body as Record<string, unknown>).isConfirm).toBe(true);
  });
});