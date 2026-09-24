/**
 * Elasticsearch indexing tests for the auction stream fields.
 *
 * These exist because the `items` index backs a PUBLIC search endpoint, so what is and is not
 * indexed is a security decision, not just a mapping detail. `streamKey` identifies the stream
 * and must stay out; `streamProvider` is safe and is needed so the frontend can tell how to
 * play a livestream.
 *
 * The ES client is replaced with a spy: these assert what we would SEND, which is the part we
 * control. They deliberately do not talk to a real cluster.
 *
 * Uses MongoMemoryServer (no transactions here, so no replset needed).
 */
import { Types } from 'mongoose';
import { esService } from '../../../src/services/elasticsearch-service';
import { Auction } from '../../../src/models/auction-model';
import { IItem } from '../../../src/models/item-model';
import { EStreamProvider } from '../../../src/globals';
import { connectTestDb, disconnectTestDb, clearTestDb } from '../../helpers/db';

const indexSpy = jest.fn().mockResolvedValue({});

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
afterEach(async () => {
  await clearTestDb();
  indexSpy.mockClear();
});

/** Replace the service's real client with a spy before any test indexes anything. */
beforeAll(() => {
  (esService as any).client = { index: indexSpy };
});

/** Insert an auction straight into the collection. Bypasses schema defaults on purpose, so a
 *  fixture can represent a document written before a field existed. */
async function seedAuction(overrides: Record<string, unknown> = {}) {
  const _id = new Types.ObjectId();
  await Auction.collection.insertOne({
    _id,
    title: { en: 'A', tn: 'A' },
    titleSlug: { en: 'a', tn: 'a' },
    auctionNumber: 'A2026042001',
    auctionLocation: 'Gaborone',
    sectorType: 'GOVERNMENT',
    numberOfLots: 1,
    requiredAttributes: [],
    participantsWithBiddingNumbers: [],
    globallyEligibleBidders: [],
    creatorId: new Types.ObjectId(),
    categoryId: new Types.ObjectId(),
    participationType: 'EVERYONE',
    terms: { en: 't', tn: 't' },
    startTime: new Date(),
    endTime: new Date(Date.now() + 3_600_000),
    status: 'NOT_BEGUN',
    publishedStatus: 'UNPUBLISHED',
    isBeingLivestreamed: true,
    ...overrides,
  } as any);
  return _id;
}

/** The minimum IItem surface that prepareItemDocument touches. */
function buildItem(auctionId: Types.ObjectId): IItem {
  return {
    _id: new Types.ObjectId(),
    auctionId,
    creatorId: new Types.ObjectId(),
    sellerId: new Types.ObjectId(),
    gallery: [],
    title: { en: 'Lot', tn: 'Lot' },
    description: { en: 'd', tn: 'd' },
    terms: { en: 't', tn: 't' },
    metadata: {},
    createdDate: new Date(),
    updatedDate: new Date(),
  } as unknown as IItem;
}

/** The document body handed to the ES client by the most recent call. */
function lastIndexedBody(): Record<string, any> {
  expect(indexSpy).toHaveBeenCalledTimes(1);
  return indexSpy.mock.calls[0][0].body as Record<string, any>;
}

describe('elasticsearch-service — stream fields in the items index', () => {
  it('indexes the auction streamProvider', async () => {
    const auctionId = await seedAuction({ streamProvider: EStreamProvider.MEDIA_SERVER });

    await esService.indexItem(buildItem(auctionId));

    expect(lastIndexedBody().auctionId.streamProvider).toBe(EStreamProvider.MEDIA_SERVER);
  });

  it('does NOT index the auction streamKey, even when the auction has one', async () => {
    // The load-bearing security assertion: this index is queryable without authentication.
    const auctionId = await seedAuction({
      streamProvider: EStreamProvider.MEDIA_SERVER,
      streamKey: 'auc-abcdef0123456789abcdef0123456789',
    });

    await esService.indexItem(buildItem(auctionId));

    const body = lastIndexedBody();
    expect('streamKey' in body.auctionId).toBe(false);
    expect(JSON.stringify(body)).not.toContain('auc-abcdef0123456789abcdef0123456789');
  });

  it('reports an auction written before streamProvider existed as embed', async () => {
    // Such documents have no streamProvider at all, and the field must not reach the index as
    // undefined — that would leave the frontend unable to choose a player. The guarantee comes
    // from the schema's `default`, not from a fallback in the indexer: removing a `?? EMBED`
    // guard here leaves this test green (measured), because Mongoose fills the path in on
    // hydration. This test exists to keep that default from being removed unnoticed.
    const auctionId = await seedAuction(); // no streamProvider field written

    await esService.indexItem(buildItem(auctionId));

    expect(lastIndexedBody().auctionId.streamProvider).toBe(EStreamProvider.EMBED);
  });

  it('still indexes streamUrl, which the embed path needs', async () => {
    const auctionId = await seedAuction({
      streamProvider: EStreamProvider.EMBED,
      streamUrl: 'https://youtube.com/live/abc',
    });

    await esService.indexItem(buildItem(auctionId));

    expect(lastIndexedBody().auctionId.streamUrl).toBe('https://youtube.com/live/abc');
  });
});
