import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import * as Joi from 'joi';
import { SuperAdminOnly } from '../shared/middleware';
import breedService from '../services/breed-service';
import { EAnimalSpecies, EBreedSortType, ESortOrderType } from '../globals';
import { isStringNumberLike, mongoIdValidation } from '../shared/functions';

// Constants
const router = Router();
const { CREATED, OK } = StatusCodes;

// Paths
export const p = {
  createBreed: '/createBreed',
  getBreeds: '/getBreeds'
} as const;

/**
 * Create a breed
 */
router.post(p.createBreed, SuperAdminOnly(), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      name: Joi.string().required().messages({
        'any.required': '"name" is a required field'
      }),
      categoryId: mongoIdValidation.required().messages({
        'any.required': '"categoryId" is a required field'
      }),
      animalSpecies: Joi.string().valid(EAnimalSpecies.BOVINE, EAnimalSpecies.CAPRINE, EAnimalSpecies.EQUINE, EAnimalSpecies.OVINE, EAnimalSpecies.PORCINE).required().messages({
        'any.required': '"animalSpecies" is a required field'
      })
    }).required();
    
    // Validate schema against input
    Joi.assert(req.body, schema);

    const breed = await breedService.createBreed(req.body as any);
    return res.status(CREATED).json({breed});
  } catch (error) {
    throw error;
  }
});

/**
 * Get breeds.
 */
router.get(p.getBreeds, SuperAdminOnly(), async (req: Request, res: Response) => {
  try {

    const conditions = new Map<string, any>();
    // Query checks
    const qSchema = Joi.object().keys({
      sortOrder: Joi.string().required().valid(ESortOrderType.ASC, ESortOrderType.DESC, ESortOrderType.asc, ESortOrderType.desc).messages({
        'any.required': '"sortOrder" is a required field'
      }),
      sortBy: Joi.string().required().valid(EBreedSortType.NAME).messages({
        'any.required': '"sortBy" is a required field'
      }),
      animalSpecies: Joi.string().valid(EAnimalSpecies.BOVINE, EAnimalSpecies.CAPRINE, EAnimalSpecies.EQUINE, EAnimalSpecies.OVINE, EAnimalSpecies.PORCINE),
      limit: isStringNumberLike.required().messages({
        'any.required': '"limit" is a required field'
      }),
      categoryId: mongoIdValidation,
      lastDocumentId: mongoIdValidation
    }).required();
    
    // Validate schema against query
    Joi.assert(req.query, qSchema);

    const { limit, sortBy, sortOrder, lastDocumentId, animalSpecies, categoryId } = req.query;
  
    conditions.set('limit', parseInt(limit as string));
    conditions.set('sortBy', sortBy);
    conditions.set('sortOrder', sortOrder);

    if (lastDocumentId) {
      conditions.set('lastDocumentId', lastDocumentId);
    }

    if (categoryId) {
      conditions.set('categoryId', categoryId);
    }

    if (animalSpecies) {
      conditions.set('animalSpecies', animalSpecies);
    }

    const breeds = await breedService.getBreeds(conditions);
    return res.status(OK).json({breeds});
  } catch (error) {
    throw error;
  }
});

// Export default
export default router;