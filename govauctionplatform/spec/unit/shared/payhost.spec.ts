/**
 * PayHost SOAP client unit tests.
 * Mocks fetch to verify SOAP envelope construction and response parsing.
 */

// Mock globals before the payhost module imports it (Jest hoists these).
jest.mock('../../../src/globals', () => ({
  PAYGATE_ID: 'test-paygate-id',
  PAYHOST_ENCRYPTION_KEY: 'test-payhost-key',
}));

import { refundRequest } from '../../../src/shared/payhost';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(responseXml: string, ok = true, status = 200): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(responseXml),
  });
  global.fetch = fn as any;
  return fn;
}

function successResponse(overrides: Partial<{
  transactionId: string;
  statusName: string;
  resultCode: string;
  resultDescription: string;
}> = {}): string {
  const t = {
    transactionId: 'payhost-tx-123',
    statusName: 'Completed',
    resultCode: '990017',
    resultDescription: 'Approved',
    ...overrides,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <SingleFollowUpResponse xmlns="http://www.paygate.co.za/PayHOST">
      <RefundResponse>
        <Status>
          <TransactionId>${t.transactionId}</TransactionId>
          <StatusName>${t.statusName}</StatusName>
          <ResultCode>${t.resultCode}</ResultCode>
          <ResultDescription>${t.resultDescription}</ResultDescription>
        </Status>
      </RefundResponse>
    </SingleFollowUpResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

function errorResponse(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <SingleFollowUpResponse xmlns="http://www.paygate.co.za/PayHOST">
      <RefundResponse>
        <Status>
          <StatusName>Error</StatusName>
          <ResultCode>900001</ResultCode>
          <ResultDescription>${message}</ResultDescription>
        </Status>
      </RefundResponse>
    </SingleFollowUpResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

// ─── Restore fetch after each test ────────────────────────────────────────────

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('payhost refundRequest', () => {

  it('builds a valid SOAP envelope with Full RefundRequest payload', async () => {
    const fetchFn = mockFetch(successResponse());

    await refundRequest({
      merchantOrderId: '675df518df5dde426982a090',
      amountCents: 3295,
      reference: 'refund-ref-abc',
    });

    const body: string = fetchFn.mock.calls[0]![1]!.body! as string;

    // Envelope wrapper
    expect(body).toContain('xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"');
    // PayHost namespace
    expect(body).toContain('xmlns="http://www.paygate.co.za/PayHOST"');
    // Request type
    expect(body).toContain('<SingleFollowUpRequest');
    expect(body).toContain('<RefundRequest>');
    // Account credentials
    expect(body).toContain('<PayGateId>test-paygate-id</PayGateId>');
    expect(body).toContain('<Password>test-payhost-key</Password>');
    // Transaction identifiers
    expect(body).toContain('<MerchantOrderId>675df518df5dde426982a090</MerchantOrderId>');
    expect(body).toContain('<Amount>3295</Amount>');
    expect(body).toContain('<Reference>refund-ref-abc</Reference>');
  });

  it('omits Amount and Reference elements when not provided', async () => {
    const fetchFn = mockFetch(successResponse());

    await refundRequest({ merchantOrderId: 'order-1' });

    const body: string = fetchFn.mock.calls[0]![1]!.body! as string;
    expect(body).not.toContain('<Amount>');
    expect(body).not.toContain('<Reference>');
  });

  it('includes Amount when amountCents is zero', async () => {
    const fetchFn = mockFetch(successResponse());

    await refundRequest({ merchantOrderId: 'order-1', amountCents: 0 });

    const body: string = fetchFn.mock.calls[0]![1]!.body! as string;
    expect(body).toContain('<Amount>0</Amount>');
  });

  it('sends the request to the PayHost endpoint', async () => {
    const fetchFn = mockFetch(successResponse());

    await refundRequest({ merchantOrderId: 'order-1' });

    const url = fetchFn.mock.calls[0]![0];
    expect(url).toBe('https://secure.paygate.co.za/payhost/process.trans');
  });

  it('sets correct SOAP headers', async () => {
    const fetchFn = mockFetch(successResponse());

    await refundRequest({ merchantOrderId: 'order-1' });

    const init = fetchFn.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(init.headers!['Content-Type']).toBe('text/xml; charset=utf-8');
    expect(init.headers!['SOAPAction']).toBe('');
  });

  it('parses a successful response correctly', async () => {
    mockFetch(successResponse({
      transactionId: 'payhost-tx-999',
      statusName: 'Completed',
      resultCode: '990017',
      resultDescription: 'Approved',
    }));

    const result = await refundRequest({ merchantOrderId: 'order-1' });

    expect(result).toEqual({
      transactionId: 'payhost-tx-999',
      statusName: 'Completed',
      resultCode: '990017',
      resultDescription: 'Approved',
    });
  });

  it('parses an error response correctly', async () => {
    mockFetch(errorResponse('Insufficient funds'));

    const result = await refundRequest({ merchantOrderId: 'order-1' });

    expect(result.statusName).toBe('Error');
    expect(result.resultDescription).toBe('Insufficient funds');
  });

  it('handles Pending status (refund not immediate)', async () => {
    mockFetch(successResponse({
      transactionId: '',
      statusName: 'Pending',
      resultCode: '',
      resultDescription: '',
    }));

    const result = await refundRequest({ merchantOrderId: 'order-1' });

    expect(result.statusName).toBe('Pending');
    expect(result.transactionId).toBe('');
  });

  it('throws when HTTP response is not ok', async () => {
    mockFetch('<html>502 Bad Gateway</html>', false, 502);

    await expect(
      refundRequest({ merchantOrderId: 'order-1' })
    ).rejects.toThrow('PayHost HTTP 502');
  });
});
