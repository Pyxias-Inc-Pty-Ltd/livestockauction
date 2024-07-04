import { isMongoId } from "validator";
import { Schema } from 'mongoose';
import { Breed, IBreed, IBreedInput } from "../models/breed-model";
import { EBreedSortType, ESortOrderType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import categoryService from "./category-service";

/**
 * Add a breed.
 * 
 * @param input
 * @returns 
 */
async function createBreed(input: IBreedInput): Promise<IBreed> {
  try {

    // Find category
    const category = await categoryService.getById(input.categoryId, { _id: 1 });

    // Check if exists
    if (!category) {
      throw new NotFoundError('Category not found');
    }

    const newBreed = new Breed(input);
    return await newBreed.save();
  } catch (error) {
    throw error;
  }
}

// /**
//  * Delete a breed.
//  * 
//  * @param id 
//  * @param projection
//  * @returns 
//  */
// async function deleteBreed(currentUser: IAdmin, breedId: string | Schema.Types.ObjectId): Promise<undefined> {
//   try {
//     if (isMongoId(breedId.toString())) {

//       const breed = await getById(breedId);

//       if (!breed) {
//         return;
//       } else {
//         // Check if there are any animals currently using the breed
//         const animal = await Animal.findOne({ breedId: breedId }, { _id: 1 });

//         // Check if exists
//         if (animal) {
//           throw new ForbiddenError('This breed is being used by animals');
//         } else {
//           await Breed.findByIdAndDelete(breedId);
//           return;
//         }

//       }

//     } else {
//       return;
//     }
//   } catch (error) {
//     // Rethrow error
//     throw error;
//   }
// }

/**
 * Get a breed by id.
 * 
 * @param id 
 * @param projection
 * @returns 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<IBreed | null> {
  try {
    if (isMongoId(id.toString())) {
      const breed = await Breed.findById(id, projection);
      return breed;
    } else {
      return null;
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Get breeds.
 * 
 * @param conditions
 * @param projection
 * @returns 
 */
async function getBreeds(conditions: Map<string, any>, projection?: any): Promise<IBreed[]> {
  try {

    let _limit: number = LIST_LIMIT_NUMBER;

    //set custom limit
    if (conditions.get('limit') && conditions.get('limit') >= 1) {
      if (conditions.get('limit') > MAX_LIST_LIMIT_NUMBER) {
        throw new ForbiddenError(`limit must not exceed ${MAX_LIST_LIMIT_NUMBER}`);
      }
      _limit = conditions.get('limit');
    }

    // Query builder
    const q = Breed.find({}, projection);

    // Filters
    if (conditions.get('animalSpecies')) {
      q.where({animalSpecies: conditions.get('animalSpecies')});
    }

    if (conditions.get('categoryId')) {
      q.where({categoryId: conditions.get('categoryId')});
    }

    // Range
    if (conditions.get('startDate') && conditions.get('endDate')) {
      q.and([{ 'createdDate': { $gte: new Date(conditions.get('startDate')) } }, { 'createdDate': { $lte: new Date(conditions.get('endDate')) } }]);
    } else if (conditions.get('startDate')) {
      q.where({ 'createdDate': { $gte: new Date(conditions.get('startDate')) } });
    } else if (conditions.get('endDate')) {
      q.where({ 'createdDate': { $lte: new Date(conditions.get('endDate')) } });
    }

    // Sort
    if (conditions.get('sortBy')) {
      if (conditions.get('sortBy') === EBreedSortType.NAME) {
        q.sort({'name': conditions.get('sortOrder')});
      }
    }

    // Pagination
    if (conditions.get('lastDocumentId')) {
      // Check the sort order
      if (conditions.get('sortOrder') === ESortOrderType.ASC || conditions.get('sortOrder') === ESortOrderType.asc) {
        q.where("_id").gt(conditions.get('lastDocumentId'));
      } else {
        q.where("_id").lt(conditions.get('lastDocumentId'));
      }
    }

    // Limit
    q.limit(_limit);

    return await q;

  } catch (error) {
    // Rethrow error
    throw error;
  }
}

// Export default
export default {
  createBreed,
  // deleteBreed,
  getById,
  getBreeds
} as const;