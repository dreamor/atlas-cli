import { describe, it, expect, vi } from 'vitest';
import {
  fetchManpowerConfirm,
  fetchTeamProjectConfirm,
  fetchProjectManpowerDetail,
  type FetchManpowerConfirmOpts,
} from '../adapters/atlas/commands/_manhours.js';
import type { BanmaClient } from '../adapters/atlas/http/client.js';

// ---------------------------------------------------------------------------
// Mock BanmaClient
// ---------------------------------------------------------------------------

function mockClient(responseData: unknown): BanmaClient {
  return {
    request: vi.fn().mockResolvedValue({ envelope: { success: true, data: responseData }, data: responseData }),
    rawJson: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseOpts: FetchManpowerConfirmOpts = {
  projectId: '2548',
  month: '2026-06',
  staffId: '527449',
};

const sampleConfirmResponse = {
  hc: 9,
  mp: 33,
  projMp: [],
  teamMp: [
    {
      p: null,
      c: [
        {
          p: null,
          c: [
            {
              p: null,
              d: '527449',
              n: '王野平 - 527449',
              r: '产品',
              t: 15,
              h: '1',
              m: '0',
              s: 1,
              weeklyActuals: [
                { startDate: 1748822400000, actualManpower: 5, week: 1748822400000 },
                { startDate: 1749427200000, actualManpower: 5, week: 1749427200000 },
                { startDate: 1750032000000, actualManpower: 5, week: 1750032000000 },
              ],
            },
          ],
          d: '065527',
          t: 15,
          h: '1',
          m: '0',
          n: '范正斌 - 065527',
        },
      ],
      d: '065527',
      t: 15,
      h: '9',
      m: '0',
      n: '范正斌 - 065527',
    },
  ],
};

// ---------------------------------------------------------------------------
// fetchManpowerConfirm
// ---------------------------------------------------------------------------

describe('fetchManpowerConfirm', () => {
  it('calls correct endpoint with required params', async () => {
    const client = mockClient(sampleConfirmResponse);
    await fetchManpowerConfirm(client, baseOpts);

    expect(client.request).toHaveBeenCalledTimes(1);
    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    const opts = calls[0]![0] as Record<string, unknown>;
    expect(opts.path).toBe(
      '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
    );
    expect(opts.method).toBe('GET');
    expect(opts.query).toMatchObject({
      month: '2026-06',
      projectList: '2548',
      staff_ID: '527449',
    });
  });

  it('passes status=0 when provided', async () => {
    const client = mockClient(sampleConfirmResponse);
    await fetchManpowerConfirm(client, { ...baseOpts, status: 0 });

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    const opts = calls[0]![0] as Record<string, unknown>;
    expect((opts.query as Record<string, unknown>).status).toBe('0');
  });

  it('passes status=1 when approved', async () => {
    const client = mockClient(sampleConfirmResponse);
    await fetchManpowerConfirm(client, { ...baseOpts, status: 1 });

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    const opts = calls[0]![0] as Record<string, unknown>;
    expect((opts.query as Record<string, unknown>).status).toBe('1');
  });

  it('omits status param when not provided', async () => {
    const client = mockClient(sampleConfirmResponse);
    await fetchManpowerConfirm(client, baseOpts);

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    const opts = calls[0]![0] as Record<string, unknown>;
    expect((opts.query as Record<string, unknown>).status).toBeUndefined();
  });

  it('parses and returns the response data', async () => {
    const client = mockClient(sampleConfirmResponse);
    const result = await fetchManpowerConfirm(client, { ...baseOpts, status: 0 });

    expect(result.hc).toBe(9);
    expect(result.mp).toBe(33);
    expect(result.teamMp).toHaveLength(1);
  });

  it('returns raw data even when Zod validation partially fails', async () => {
    // Response with extra/unknown fields — passthrough schema should handle it
    const responseWithExtra = {
      ...sampleConfirmResponse,
      unknownField: 'should be ignored by passthrough',
    };
    const client = mockClient(responseWithExtra);
    const result = await fetchManpowerConfirm(client, { ...baseOpts, status: 0 });

    expect(result.hc).toBe(9);
  });

  it('handles empty teamMp array', async () => {
    const emptyResponse = { hc: 0, mp: 0, projMp: [], teamMp: [] };
    const client = mockClient(emptyResponse);
    const result = await fetchManpowerConfirm(client, { ...baseOpts, status: 0 });

    expect(result.teamMp).toEqual([]);
    expect(result.hc).toBe(0);
  });

  it('handles null teamMp', async () => {
    const nullResponse = { hc: 0, mp: 0, projMp: null, teamMp: null };
    const client = mockClient(nullResponse);
    const result = await fetchManpowerConfirm(client, { ...baseOpts, status: 0 });

    // When Zod validation fails on null teamMp, falls back to raw data
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// fetchTeamProjectConfirm
// ---------------------------------------------------------------------------

describe('fetchTeamProjectConfirm', () => {
  it('calls correct endpoint', async () => {
    const client = mockClient({});
    await fetchTeamProjectConfirm(client, {
      projectId: '2548',
      month: '2026-06',
      status: 1,
    });

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    const opts = calls[0]![0] as Record<string, unknown>;
    expect(opts.path).toBe(
      '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
    );
    expect(opts.method).toBe('GET');
    expect(opts.query).toMatchObject({
      month: '2026-06',
      projectId: '2548',
      status: '1',
    });
  });

  it('omits status when not provided', async () => {
    const client = mockClient({});
    await fetchTeamProjectConfirm(client, {
      projectId: '2548',
      month: '2026-06',
    });

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    const opts = calls[0]![0] as Record<string, unknown>;
    expect((opts.query as Record<string, unknown>).status).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchProjectManpowerDetail
// ---------------------------------------------------------------------------

describe('fetchProjectManpowerDetail', () => {
  it('calls correct endpoint', async () => {
    const client = mockClient({});
    await fetchProjectManpowerDetail(client, {
      month: '2026-06',
      staffId: '527449',
    });

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    const opts = calls[0]![0] as Record<string, unknown>;
    expect(opts.path).toBe(
      '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
    );
    expect(opts.method).toBe('GET');
    expect(opts.query).toMatchObject({
      month: '2026-06',
      staff_ID: '527449',
    });
  });
});
