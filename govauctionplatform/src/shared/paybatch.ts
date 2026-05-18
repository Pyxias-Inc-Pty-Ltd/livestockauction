/**
 * PayBatch SOAP client for PayGate refunds.
 *
 * Flow:
 *   1. submitRefundBatch() → uploadId
 *   2. confirmBatch(uploadId)  — tells PayGate to begin processing
 *   3. PayGate POSTs result to notifyUrl (or poll with queryBatch)
 *
 * Auth: HTTP Basic base64(PAYGATE_ID:PAYGATE_ENCRYPTION_KEY)
 * Endpoint: https://secure.paygate.co.za/paybatch/1.2/process.trans
 */
import { PAYGATE_ID, PAYGATE_ENCRYPTION_KEY } from '../globals';

const PAYBATCH_ENDPOINT = 'https://secure.paygate.co.za/paybatch/1.2/process.trans';

function buildAuth(): string {
  return Buffer.from(`${PAYGATE_ID}:${PAYGATE_ENCRYPTION_KEY}`).toString('base64');
}

export interface BatchLine {
  /** Transaction ID used as the batch line reference */
  reference: string;
  /** Cardholder name — commas stripped internally */
  cardholderName: string;
  /** Vault UUID returned by PayGate on the original payment */
  vaultId: string;
  /** Amount in cents (integer) */
  amountCents: number;
}

export interface BatchSubmitResult {
  uploadId: string;
}

export interface BatchQueryResult {
  uploadId: string;
  status: string;
  lines: Array<{ reference: string; resultCode: string; resultDesc: string }>;
}

async function soapRequest(action: string, bodyXml: string): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="http://www.paygate.co.za/PayBatch">
  <SOAP-ENV:Body>
    ${bodyXml}
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  const response = await fetch(PAYBATCH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': action,
      'Authorization': `Basic ${buildAuth()}`,
    },
    body: envelope,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PayBatch HTTP ${response.status}: ${text}`);
  }

  return response.text();
}

function extractXmlValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([^<]+)<`, 'i'));
  return match ? match[1].trim() : null;
}

/**
 * Submit a refund batch.
 * Batch line format: R,{reference},{cardholderName},{vaultId},00,{amountCents}
 */
export async function submitRefundBatch(
  batchReference: string,
  lines: BatchLine[],
  notifyUrl: string,
): Promise<BatchSubmitResult> {
  const csv = lines
    .map(l => `R,${l.reference},${l.cardholderName.replace(/,/g, '')},${l.vaultId},00,${l.amountCents}`)
    .join('\n');

  const bodyXml = `
    <ns1:Upload>
      <batchReference>${batchReference}</batchReference>
      <notifyUrl>${notifyUrl}</notifyUrl>
      <batch><![CDATA[${csv}]]></batch>
    </ns1:Upload>`;

  const xml = await soapRequest('Upload', bodyXml);
  const uploadId = extractXmlValue(xml, 'uploadId') ?? extractXmlValue(xml, 'UploadID');
  if (!uploadId) {
    throw new Error(`PayBatch Upload: missing uploadId in response: ${xml}`);
  }
  return { uploadId };
}

/**
 * Confirm a submitted batch so PayGate begins processing it.
 */
export async function confirmBatch(uploadId: string): Promise<void> {
  const bodyXml = `
    <ns1:Confirm>
      <uploadId>${uploadId}</uploadId>
    </ns1:Confirm>`;

  await soapRequest('Confirm', bodyXml);
}

/**
 * Query the processing status of a batch.
 */
export async function queryBatch(uploadId: string): Promise<BatchQueryResult> {
  const bodyXml = `
    <ns1:Query>
      <uploadId>${uploadId}</uploadId>
    </ns1:Query>`;

  const xml = await soapRequest('Query', bodyXml);
  const status = extractXmlValue(xml, 'status') ?? 'UNKNOWN';

  const lineResults: BatchQueryResult['lines'] = [];
  const lineMatches = xml.matchAll(/<[Ll]ine[^>]*>([\s\S]*?)<\/[Ll]ine>/g);
  for (const m of lineMatches) {
    const lineXml = m[1];
    lineResults.push({
      reference: extractXmlValue(lineXml, 'reference') ?? '',
      resultCode: extractXmlValue(lineXml, 'resultCode') ?? '',
      resultDesc: extractXmlValue(lineXml, 'resultDesc') ?? '',
    });
  }

  return { uploadId, status, lines: lineResults };
}
