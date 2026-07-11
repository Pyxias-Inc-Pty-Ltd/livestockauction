/**
 * PayHost SOAP client for PayGate refunds.
 *
 * PayHost is PayGate's unified XML-based API for server-to-server payment
 * processing. Refunds are performed as "follow-up requests" on previously
 * settled transactions.
 *
 * Endpoint: https://secure.paygate.co.za/payhost/process.trans
 * WSDL:     https://secure.paygate.co.za/payhost/process.trans?wsdl
 *
 * Auth: PayGateId + Password are passed in the XML body (no HTTP Basic).
 */
import { PAYHOST_ENCRYPTION_KEY } from '../globals';

const PAYHOST_ENDPOINT = 'https://secure.paygate.co.za/payhost/process.trans';

export interface RefundRequestParams {
  /** Our original transaction MongoDB _id (sent as REFERENCE to PayWeb3). */
  merchantOrderId: string;
  /** Amount in cents (integer). Omit for full refund. */
  amountCents?: number;
  /** Our refund transaction ID — stored as Reference for tracking. */
  reference?: string;
  /** Seller's PayGate ID for the refund request. */
  paygateId: string;
}

export interface RefundResponse {
  /** PayGate transaction ID for the refund itself. */
  transactionId: string;
  /** e.g. "Completed", "Error", "Pending", "Cancelled". */
  statusName: string;
  resultCode: string;
  resultDescription: string;
}

async function soapRequest(bodyXml: string): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    ${bodyXml}
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  const response = await fetch(PAYHOST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '',
    },
    body: envelope,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PayHost HTTP ${response.status}: ${text}`);
  }

  return response.text();
}

function extractXmlValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([^<]+)<`, 'i'));
  return match ? match[1].trim() : null;
}

/**
 * Issue a refund for a previously settled transaction via PayHost.
 *
 * Uses SingleFollowUpRequest with a RefundRequest child element.
 * Identifies the original transaction by MerchantOrderId (our MongoDB _id
 * that was sent as REFERENCE in the original PayWeb3 call).
 */
export async function refundRequest(params: RefundRequestParams): Promise<RefundResponse> {
  const amountXml = params.amountCents != null
    ? `<Amount>${params.amountCents}</Amount>`
    : '';

  const referenceXml = params.reference
    ? `<Reference>${params.reference}</Reference>`
    : '';

  const bodyXml = `
    <SingleFollowUpRequest xmlns="http://www.paygate.co.za/PayHOST">
      <RefundRequest>
        <Account>
          <PayGateId>${params.paygateId}</PayGateId>
          <Password>${PAYHOST_ENCRYPTION_KEY}</Password>
        </Account>
        <MerchantOrderId>${params.merchantOrderId}</MerchantOrderId>
        ${amountXml}
        ${referenceXml}
      </RefundRequest>
    </SingleFollowUpRequest>`;

  const xml = await soapRequest(bodyXml);

  const transactionId = extractXmlValue(xml, 'TransactionId') ?? '';
  const statusName = extractXmlValue(xml, 'StatusName') ?? 'Unknown';
  const resultCode = extractXmlValue(xml, 'ResultCode') ?? '';
  const resultDescription = extractXmlValue(xml, 'ResultDescription') ?? '';

  return { transactionId, statusName, resultCode, resultDescription };
}
