import { describe, it, expect } from 'vitest';
import {
  EnvelopeSchema,
  isEnvelopeSuccess,
  normalizePaginated,
} from '../adapters/atlas/schema/envelope.js';

describe('envelope', () => {
  it('parses standard envelope', () => {
    const env = EnvelopeSchema.parse({
      status: 1,
      code: 1,
      errCode: '1',
      errorMsg: null,
      success: true,
      data: { foo: 'bar' },
    });
    expect(isEnvelopeSuccess(env)).toBe(true);
  });

  it('parses slim envelope', () => {
    const env = EnvelopeSchema.parse({ status: 1, data: [1, 2, 3] });
    expect(isEnvelopeSuccess(env)).toBe(true);
  });

  it('flags failure envelope', () => {
    const env = EnvelopeSchema.parse({
      status: 0,
      code: 0,
      errCode: '500',
      errorMsg: 'oops',
      success: false,
    });
    expect(isEnvelopeSuccess(env)).toBe(false);
  });

  it('flags slim envelope with status 0 as failure', () => {
    const env = EnvelopeSchema.parse({ status: 0, data: null });
    expect(isEnvelopeSuccess(env)).toBe(false);
  });
});

describe('normalizePaginated', () => {
  it('treats array data as a complete page', () => {
    const items = [{ id: 1 }, { id: 2 }];
    const r = normalizePaginated(items, items);
    expect(r.total).toBe(2);
    expect(r.hasMore).toBe(false);
  });

  it('extracts metadata from object form', () => {
    const obj = { list: [{ id: 1 }], total: 50, pageNum: 1, pageSize: 10, hasMore: true };
    const r = normalizePaginated(obj, [{ id: 1 }]);
    expect(r.total).toBe(50);
    expect(r.pageNum).toBe(1);
    expect(r.hasMore).toBe(true);
  });
});
