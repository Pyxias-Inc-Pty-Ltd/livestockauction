import { createAuctionSchema, updateAuctionSchema } from '../../../src/shared/auction-validation';
import { EParticipationType, EStreamProvider } from '../../../src/globals';

// A minimal body that satisfies every *other* required field, so a failure can only come from
// the streamProvider/streamUrl pair under test. Everything else here is filler.
const baseCreateBody = {
  title: { en: 'Bull sale', tn: 'Bull sale' },
  auctionLocation: 'Gaborone',
  auctionCoordinates: { coordinates: [25.9, -24.6] },
  terms: { en: 'terms', tn: 'terms' },
  isBeingLivestreamed: true,
  thumbnailUrl: 'https://example.com/thumb.png',
  hasRegistrationFee: false,
  categoryId: '507f1f77bcf86cd799439011',
  startTime: '2026-10-01T08:00:00.000Z',
  endTime: '2026-10-01T16:00:00.000Z',
  participationType: EParticipationType.EVERYONE,
  requiredAttributes: [],
  collectionWindowDays: 3,
  collectionStartTime: '08:00',
  collectionEndTime: '16:00',
};

const createError = (body: Record<string, unknown>): string | undefined =>
  createAuctionSchema.validate(body, { abortEarly: true }).error?.message;

const updateError = (body: Record<string, unknown>): string | undefined =>
  updateAuctionSchema.validate(body, { abortEarly: true }).error?.message;

// ─────────────────────────────────────────────────────────────────────────────
// The other required fields must genuinely be required, otherwise every
// assertion below would pass for the wrong reason.
// ─────────────────────────────────────────────────────────────────────────────
describe('createAuctionSchema — sanity of the fixture', () => {
  it('accepts the base body as a valid embed auction', () => {
    const body = { ...baseCreateBody, streamUrl: 'https://youtube.com/live/abc' };
    expect(createError(body)).toBeUndefined();
  });

  it('rejects the base body when an unrelated required field is missing', () => {
    const withoutThumbnail = { ...baseCreateBody, thumbnailUrl: undefined };
    expect(createError({ ...withoutThumbnail, streamUrl: 'https://youtube.com/live/abc' }))
      .toBe('"thumbnailUrl" is a required field');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAuctionSchema — streamProvider / streamUrl interaction
// ─────────────────────────────────────────────────────────────────────────────
describe('createAuctionSchema — streamProvider and streamUrl', () => {
  it('requires streamUrl when livestreaming with the embed provider', () => {
    const error = createError({
      ...baseCreateBody,
      isBeingLivestreamed: true,
      streamProvider: EStreamProvider.EMBED,
    });
    expect(error).toBe('"streamUrl" is a required field');
  });

  it('requires streamUrl when livestreaming and streamProvider is omitted', () => {
    // The schema declares default('embed'), but the sibling `when` is evaluated against the
    // RAW input, so an omitted provider reads as undefined and falls to the `otherwise` branch.
    // If Joi ever applied the default first this test would fail — which is the point: the
    // claim is asserted here rather than trusted from the schema's comment.
    const error = createError({ ...baseCreateBody, isBeingLivestreamed: true });
    expect(error).toBe('"streamUrl" is a required field');
  });

  it('does not require streamUrl when livestreaming with our own media server', () => {
    const error = createError({
      ...baseCreateBody,
      isBeingLivestreamed: true,
      streamProvider: EStreamProvider.MEDIA_SERVER,
    });
    expect(error).toBeUndefined();
  });

  it('does not require streamUrl when the auction is not livestreamed at all', () => {
    const error = createError({
      ...baseCreateBody,
      isBeingLivestreamed: false,
      streamProvider: EStreamProvider.EMBED,
    });
    expect(error).toBeUndefined();
  });

  it('still rejects a malformed streamUrl for the embed provider', () => {
    const error = createError({
      ...baseCreateBody,
      streamProvider: EStreamProvider.EMBED,
      streamUrl: 'not-a-url',
    });
    expect(error).toBe('"streamUrl" must be a valid uri');
  });

  it('rejects an unknown streamProvider value', () => {
    const error = createError({
      ...baseCreateBody,
      streamProvider: 'youtube',
      streamUrl: 'https://youtube.com/live/abc',
    });
    expect(error).toContain('"streamProvider" must be one of');
  });

  it('rejects a null streamProvider', () => {
    // This is the measurement behind a comment in elasticsearch-service.ts: the indexer leaves
    // streamProvider unguarded on the grounds that a stored `null` is unreachable, because the
    // only route into Mongo is through this schema. A `null` reaching Mongo *would* index
    // unguarded (unlike an absent field, which the model's default normalises), so if this
    // assertion ever stops holding, that comment is wrong too and the guard needs restoring.
    const error = createError({
      ...baseCreateBody,
      streamProvider: null,
      streamUrl: 'https://youtube.com/live/abc',
    });
    expect(error).toContain('"streamProvider" must be one of');
  });

  it('applies the embed default when streamProvider is omitted', () => {
    const { error, value } = createAuctionSchema.validate(
      { ...baseCreateBody, streamUrl: 'https://youtube.com/live/abc' },
    );
    expect(error).toBeUndefined();
    expect(value.streamProvider).toBe(EStreamProvider.EMBED);
  });

  it('rejects a client-supplied streamKey (server-generated only)', () => {
    // A caller must not be able to name its own stream: a guessable key would let it collide
    // with, or impersonate, another auction's stream.
    const error = createError({
      ...baseCreateBody,
      streamProvider: EStreamProvider.MEDIA_SERVER,
      streamKey: 'auc-attacker-chosen',
    });
    expect(error).toContain('"streamKey" is not allowed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateAuctionSchema — mirrors the create rule
// ─────────────────────────────────────────────────────────────────────────────
describe('updateAuctionSchema — streamProvider and streamUrl', () => {
  const auctionId = '507f1f77bcf86cd799439011';

  it('requires streamUrl when enabling livestream with the embed provider', () => {
    const error = updateError({
      auctionId,
      isBeingLivestreamed: true,
      streamProvider: EStreamProvider.EMBED,
    });
    expect(error).toBe('"streamUrl" is required');
  });

  it('requires streamUrl when enabling livestream and streamProvider is omitted', () => {
    const error = updateError({ auctionId, isBeingLivestreamed: true });
    expect(error).toBe('"streamUrl" is required');
  });

  it('does not require streamUrl for our own media server', () => {
    const error = updateError({
      auctionId,
      isBeingLivestreamed: true,
      streamProvider: EStreamProvider.MEDIA_SERVER,
    });
    expect(error).toBeUndefined();
  });

  it('accepts a partial update that touches neither field', () => {
    expect(updateError({ auctionId, title: { en: 'New', tn: 'New' } })).toBeUndefined();
  });
});
