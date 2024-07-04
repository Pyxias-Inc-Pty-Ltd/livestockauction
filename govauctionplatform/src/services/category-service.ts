import { isMongoId } from "validator";
import { Schema } from 'mongoose';
import { Category, ICategory, ICategoryInput } from "../models/category-model";

/**
 * Add a category.
 * 
 * @param input
 * @returns 
 */
async function createCategory(input: ICategoryInput): Promise<ICategory> {
  try {
    const newCategory = new Category(input);
    return await newCategory.save();
  } catch (error) {
    throw error;
  }
}

// /**
//  * Delete a category.
//  * 
//  * @param id 
//  * @param projection
//  * @returns 
//  */
// async function deleteCategory(currentUser: IAdmin, itemId: string | Schema.Types.ObjectId): Promise<undefined> {
//   try {
//     if (isMongoId(itemId.toString())) {

//       const item = await getById(itemId);

//       if (item) {
//         // Check status
//         if (item.status === 'NOT_BEGUN') {
//           await Item.findByIdAndDelete(itemId);
//           return;
//         } else {
//           throw new ForbiddenError('Can not delete a processed item');
//         }
//       } else {
//         return;
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
 * Get a category by id.
 * 
 * @param id 
 * @param projection
 * @returns 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<ICategory | null> {
  try {
    if (isMongoId(id.toString())) {
      const category = await Category.findById(id, projection);
      return category;
    } else {
      return null;
    }
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Get categories.
 * 
 * @param conditions
 * @param projection
 * @returns 
 */
async function getCategories(): Promise<ICategory[]> {
  try {
    return await Category.find();
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

// Export default
export default {
  createCategory,
  // deleteCategory,
  getById,
  getCategories
} as const;