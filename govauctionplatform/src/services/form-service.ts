import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { Form, IForm } from "../models/form-model";
import { IAdmin, ISeller } from "../models/user-model";
import { LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER } from "../globals";
import { Schema } from "mongoose";

/**
 * Get a form by id.
 * 
 * @param id 
 * @return 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<IForm | null> {
  try {
    return await Form.findById(id, projection);
  } catch (error) {
    throw error;
  }
}

/**
 * Get a form by identification number.
 * 
 * @param identificationNumber 
 * @return 
 */
async function getByIdentificationNumber(identificationNumber: string): Promise<IForm | null> {
  try {
    return await Form.findOne({ identificationNumber });
  } catch (error) {
    throw error;
  }
}

/**
 * Create a new form.
 * 
 * @param currentUser - The seller creating the form
 * @param input - Form input data
 * @return Promise<IForm>
 */
async function createForm(currentUser: IAdmin, input: Partial<IForm>): Promise<IForm> {
  try {
    // Check if form with same identification number exists
    const existingForm = await getByIdentificationNumber(input.identificationNumber!);
    if (existingForm) {
      throw new ConflictError('Form with this identification number already exists');
    }

    const newForm = new Form({
      ...input,
      creatorId: currentUser.id
    });

    await newForm.save();
    return newForm;
  } catch (error) {
    throw error;
  }
}

/**
 * Update an existing form.
 * 
 * @param currentUser - The seller updating the form
 * @param formId - ID of the form to update
 * @param data - Data to update
 * @return Promise<IForm>
 */
async function updateForm(
  currentUser: IAdmin,
  formId: string | Schema.Types.ObjectId,
  data: Partial<IForm>
): Promise<IForm> {
  try {
    const form = await Form.findById(formId);

    if (!form) {
      throw new NotFoundError('Form not found');
    }

    if (data.identificationNumber) {
      throw new ForbiddenError('identificationNumber is immutable');
    }

    // Update allowed fields
    if (data.description) form.description = data.description;
    if (data.formAttributes) form.formAttributes = data.formAttributes;

    await form.save();
    return form;
  } catch (error) {
    throw error;
  }
}

/**
 * Delete a form.
 * 
 * @param currentUser - The seller deleting the form
 * @param formId - ID of the form to delete
 */
async function deleteForm(currentUser: IAdmin, formId: string | Schema.Types.ObjectId): Promise<void> {
  try {
    const form = await Form.findOne({
      _id: formId,
      sellerId: currentUser.id
    });

    if (!form) {
      throw new NotFoundError('Form not found');
    }

    await form.deleteOne();
  } catch (error) {
    throw error;
  }
}

/**
 * Get forms for a specific seller.
 * 
 * @param currentUser - The seller
 * @param projection - Optional fields to project
 * @return Promise<IForm[]>
 */
async function getFormsBySeller(currentUser: ISeller, projection?: any): Promise<IForm[]> {
  try {
    return await Form.find(
      { sellerId: currentUser.id },
      projection
    );
  } catch (error) {
    throw error;
  }
}

/**
 * Get all forms with pagination and filtering.
 * 
 * @param conditions - Filter and pagination conditions
 * @param projection - Optional fields to project
 * @return Promise<IForm[]>
 */
async function getForms(conditions: Map<string, any>, projection?: any): Promise<IForm[]> {
  try {
    let _limit: number = LIST_LIMIT_NUMBER;

    // Set custom limit
    if (conditions.get('limit') && conditions.get('limit') >= 1) {
      if (conditions.get('limit') > MAX_LIST_LIMIT_NUMBER) {
        throw new ForbiddenError(`limit must not exceed ${MAX_LIST_LIMIT_NUMBER}`);
      }
      _limit = conditions.get('limit');
    }

    // Query builder
    const q = Form.find({}, projection);

    // Filters
    if (conditions.get('sellerId')) {
      q.where({ sellerId: conditions.get('sellerId') });
    }

    // Date range
    if (conditions.get('startDate') && conditions.get('endDate')) {
      q.and([
        { 'createdDate': { $gte: new Date(conditions.get('startDate')) } },
        { 'createdDate': { $lte: new Date(conditions.get('endDate')) } }
      ]);
    } else if (conditions.get('startDate')) {
      q.where({ 'createdDate': { $gte: new Date(conditions.get('startDate')) } });
    } else if (conditions.get('endDate')) {
      q.where({ 'createdDate': { $lte: new Date(conditions.get('endDate')) } });
    }

    // Sort
    if (conditions.get('sortBy')) {
      q.sort({ [conditions.get('sortBy')]: conditions.get('sortOrder') });
    }

    // Pagination
    if (conditions.get('lastDocumentId')) {
      if (conditions.get('sortOrder') === 'asc') {
        q.where('_id').gt(conditions.get('lastDocumentId'));
      } else {
        q.where('_id').lt(conditions.get('lastDocumentId'));
      }
    }

    // Limit
    q.limit(_limit);

    return await q;
  } catch (error) {
    throw error;
  }
}

// Export default
export default {
  getById,
  getByIdentificationNumber,
  createForm,
  updateForm,
  deleteForm,
  getFormsBySeller,
  getForms
} as const;