import * as Joi from 'joi';
import { EParticipationType, EStreamProvider } from '../globals';
import { isoDateValidation, mongoIdValidation } from './functions';

// These schemas live here rather than inline in auction-router.ts so they can be unit tested.
// Importing the router in a spec drags in `jose` (via shared/middleware) which this project's
// CommonJS Jest cannot parse, so a schema defined inline there is untestable by construction.
// The router builds its schemas once at module load instead of per request; Joi schemas are
// immutable descriptors, so that is behaviour-preserving.

/**
 * Validation schema for POST /createAuction.
 */
export const createAuctionSchema = Joi.object().keys({
  title: Joi.object().keys({
    en: Joi.string().required().messages({
      'any.required': '"title.en" is a required field'
    }),
    tn: Joi.string().required().messages({
      'any.required': '"title.tn" is a required field'
    }),
  }).required().messages({
    'any.required': '"title" is a required field'
  }),
  auctionLocation: Joi.string().required().messages({
    'any.required': '"auctionLocation" is a required field'
  }),
  auctionCoordinates: Joi.object().keys({
    coordinates: Joi.array().items(Joi.number().min(-180).max(180)).length(2).required().messages({
      'any.required': '"auctionCoordinates.coordinates" is a required field'
    }),
  }).required().messages({
    'any.required': '"auctionCoordinates" is a required field'
  }),
  terms: Joi.object().keys({
    en: Joi.string().required().messages({
      'any.required': '"terms.en" is a required field'
    }),
    tn: Joi.string().required().messages({
      'any.required': '"terms.tn" is a required field'
    }),
  }).required().messages({
    'any.required': '"terms" is a required field'
  }),
  isBeingLivestreamed: Joi.boolean().required().messages({
    'any.required': '"isBeingLivestreamed" is a required field'
  }),
  isClosedBidding: Joi.boolean().default(false),
  // Defaults to 'embed' so any existing caller that knows nothing about streamProvider
  // keeps its current behaviour: a third-party URL, required, rendered in an iframe.
  streamProvider: Joi.string()
    .valid(EStreamProvider.EMBED, EStreamProvider.MEDIA_SERVER)
    .default(EStreamProvider.EMBED),
  // streamUrl is only needed for third-party embeds. With our own media server the publish
  // and playback URLs are derived from the server-generated streamKey, so there is nothing
  // for the caller to type — and nothing for it to get wrong.
  //
  // Omitting streamProvider still requires streamUrl: the declared default lands in the
  // validated output but does not satisfy this `when`, so an omitted provider takes the
  // `otherwise` (embed) branch. Intended — omitting the provider means embed. Both halves
  // are asserted in auction-validation.spec.ts.
  streamUrl: Joi.string().uri().when('isBeingLivestreamed', {
    is: true,
    then: Joi.when('streamProvider', {
      is: EStreamProvider.MEDIA_SERVER,
      then: Joi.optional(),
      otherwise: Joi.required().messages({
        'any.required': '"streamUrl" is a required field'
      })
    }),
    otherwise: Joi.optional()
  }),
  thumbnailUrl: Joi.required().messages({
    'any.required': '"thumbnailUrl" is a required field'
  }),
  hasRegistrationFee: Joi.boolean().required().messages({
    'any.required': '"hasRegistrationFee" is a required field'
  }),
  registrationFee: Joi.number().min(0).when('hasRegistrationFee', {
    is: true,
    then: Joi.required().messages({
      'any.required': '"registrationFee" is a required field'
    }),
    otherwise: Joi.optional()
  }),
  categoryId: mongoIdValidation.required().messages({
    'any.required': '"categoryId" is a required field'
  }),
  startTime: isoDateValidation.required().messages({
    'any.required': '"startTime" is a required field'
  }),
  endTime: isoDateValidation.required().messages({
    'any.required': '"endTime" is a required field'
  }),
  participationType: Joi.string().valid(
    EParticipationType.CITIZEN_ONLY,
    EParticipationType.EVERYONE
  ).required().messages({
    'any.required': '"participationType" is a required field'
  }),
  requiredAttributes: Joi.array().items(mongoIdValidation).messages({
    'array.base': '"requiredAttributes" should be an array of valid MongoDB IDs'
  }).required().default([]).messages({
    'any.required': '"requiredAttributes" is a required field'
  }),
  collectionWindowDays: Joi.number().integer().min(1).required().messages({
    'any.required': '"collectionWindowDays" is a required field'
  }),
  collectionStartTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required().messages({
    'any.required': '"collectionStartTime" is a required field',
    'string.pattern.base': '"collectionStartTime" must be in HH:mm format'
  }),
  collectionEndTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required().messages({
    'any.required': '"collectionEndTime" is a required field',
    'string.pattern.base': '"collectionEndTime" must be in HH:mm format'
  }),
  isInviteOnly: Joi.boolean().default(false),
  invitedBidders: Joi.array().items(mongoIdValidation).default([]),
}).required();

/**
 * Validation schema for PUT /updateAuction.
 */
export const updateAuctionSchema = Joi.object().keys({
  auctionId: mongoIdValidation.required().messages({
    'any.required': '"auctionId" is a required field'
  }),
  title: Joi.object().keys({
    en: Joi.string().required(),
    tn: Joi.string().required(),
  }),
  auctionLocation: Joi.string(),
  auctionCoordinates: Joi.object().keys({
    coordinates: Joi.array().items(Joi.number().min(-180).max(180)).length(2).required(),
  }),
  terms: Joi.object().keys({
    en: Joi.string().required(),
    tn: Joi.string().required(),
  }),
  isBeingLivestreamed: Joi.boolean(),
  isClosedBidding: Joi.boolean(),
  streamProvider: Joi.string().valid(EStreamProvider.EMBED, EStreamProvider.MEDIA_SERVER),
  // Same rule as creation: an embed needs a URL to embed, our own media server does not.
  streamUrl: Joi.string().uri().when('isBeingLivestreamed', {
    is: true,
    then: Joi.when('streamProvider', {
      is: EStreamProvider.MEDIA_SERVER,
      then: Joi.optional(),
      otherwise: Joi.required()
    }),
    otherwise: Joi.optional()
  }),
  thumbnailUrl: Joi.string(),
  hasRegistrationFee: Joi.boolean(),
  registrationFee: Joi.number().min(0).when('hasRegistrationFee', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  categoryId: mongoIdValidation,
  startTime: isoDateValidation,
  endTime: isoDateValidation,
  participationType: Joi.string().valid(
    EParticipationType.CITIZEN_ONLY,
    EParticipationType.EVERYONE
  ),
  requiredAttributes: Joi.array().items(mongoIdValidation),
  collectionWindowDays: Joi.number().integer().min(1),
  collectionStartTime: Joi.string().pattern(/^\d{2}:\d{2}$/).messages({
    'string.pattern.base': '"collectionStartTime" must be in HH:mm format'
  }),
  collectionEndTime: Joi.string().pattern(/^\d{2}:\d{2}$/).messages({
    'string.pattern.base': '"collectionEndTime" must be in HH:mm format'
  }),
  isInviteOnly: Joi.boolean(),
  invitedBidders: Joi.array().items(mongoIdValidation),
}).required();
