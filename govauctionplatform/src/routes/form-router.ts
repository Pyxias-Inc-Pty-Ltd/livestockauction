import { requirePermission } from '../shared/middleware';
import { Request, Response, Router } from 'express';
import * as Joi from 'joi';
import StatusCodes from 'http-status-codes';
import { mongoIdValidation } from '../shared/functions';
import formService from '../services/form-service';
import { IAdmin, ISeller } from '../models/user-model';
import { EFormFieldType, EConditionOperator } from '../models/form-model';
import { EPermission, ESortOrderType } from '../globals';

// Constants
const router = Router();
const { OK, CREATED } = StatusCodes;

// Paths
export const p = {
  getForms: '/getForms',
  getFormById: '/getFormById',
  createForm: '/createForm',
  updateForm: '/updateForm',
  deleteForm: '/deleteForm',
  getFormsBySeller: '/getFormsBySeller'
} as const;

// Validation Schemas
const formFieldSchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(EFormFieldType))
    .required()
    .messages({
      'any.required': '"type" is a required field'
    }),
  label: Joi.string().required().messages({
    'any.required': '"label" is a required field'
  }),
  name: Joi.string().required().messages({
    'any.required': '"name" is a required field'
  }),
  renderInUI: Joi.boolean().required().messages({
    'any.required': '"renderInUI" is a required field'
  }),
  required: Joi.boolean(),
  placeholder: Joi.string(),
  defaultValue: Joi.any(),
  disabled: Joi.boolean(),
  order: Joi.number(),
  minLength: Joi.number(),
  maxLength: Joi.number(),
  min: Joi.number(),
  max: Joi.number(),
  options: Joi.array().items(
    Joi.object({
      label: Joi.string().required(),
      value: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      disabled: Joi.boolean()
    })
  ),
  validation: Joi.array(),
  showCondition: Joi.object({
    logicalOperator: Joi.string().valid('AND', 'OR').required(),
    conditions: Joi.array().items(
      Joi.object({
        field: Joi.string().required(),
        operator: Joi.string()
          .valid(...Object.values(EConditionOperator))
          .required(),
        value: Joi.any()
      })
    ).required()
  })
});

const formSectionSchema = Joi.object({
  title: Joi.string().required().messages({
    'any.required': '"title" is a required field'
  }),
  description: Joi.string(),
  fields: Joi.array().items(formFieldSchema).required().messages({
    'any.required': '"fields" is a required field'
  }),
  order: Joi.number(),
  showCondition: Joi.object({
    logicalOperator: Joi.string().valid('AND', 'OR').required(),
    conditions: Joi.array().items(
      Joi.object({
        field: Joi.string().required(),
        operator: Joi.string()
          .valid(...Object.values(EConditionOperator))
          .required(),
        value: Joi.any()
      })
    ).required()
  })
});

/**
 * Get form by id.
 */
router.get(p.getFormById, requirePermission(EPermission.FORM_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      id: mongoIdValidation.required().messages({
        'any.required': '"id" is a required field'
      })
    }).required();

    Joi.assert(req.query, schema);

    const { id } = req.query;
    const form = await formService.getById(id as string);
    return res.status(OK).json({ form });
  } catch (error) {
    throw error;
  }
});

/**
 * Create new form
 */
router.post(p.createForm, requirePermission(EPermission.FORM_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      identificationNumber: Joi.string().required().messages({
        'any.required': '"identificationNumber" is a required field'
      }),
      sellerId: mongoIdValidation.required().messages({
        'any.required': '"sellerId" is a required field'
      }),
      categoryId: mongoIdValidation.required().messages({
        'any.required': '"categoryId" is a required field'
      }),
      description: Joi.string().required().messages({
        'any.required': '"description" is a required field'
      }),
      formAttributes: Joi.object({
        title: Joi.string().required().messages({
          'any.required': '"title" is a required field'
        }),
        description: Joi.string(),
        sections: Joi.array().items(formSectionSchema).required().messages({
          'any.required': '"sections" is a required field'
        })
      }).required()
    }).required();

    Joi.assert(req.body, schema);

    const form = await formService.createForm(req.user as IAdmin, req.body);
    return res.status(CREATED).json({ form });
  } catch (error) {
    throw error;
  }
});

/**
 * Update form
 */
router.put(p.updateForm, requirePermission(EPermission.FORM_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      formId: mongoIdValidation.required().messages({
        'any.required': '"formId" is a required field'
      }),
      categoryId: mongoIdValidation,
      description: Joi.string(),
      formAttributes: Joi.object({
        title: Joi.string(),
        description: Joi.string(),
        sections: Joi.array().items(formSectionSchema)
      })
    }).required();

    Joi.assert(req.body, schema);

    const { formId, ...updateData } = req.body;
    const form = await formService.updateForm(
      req.user as IAdmin,
      formId,
      updateData
    );
    return res.status(OK).json({ form });
  } catch (error) {
    throw error;
  }
});

/**
 * Delete form
 */
router.delete(p.deleteForm, requirePermission(EPermission.FORM_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      formId: mongoIdValidation.required().messages({
        'any.required': '"formId" is a required field'
      })
    }).required();

    Joi.assert(req.body, schema);

    const { formId } = req.body;
    await formService.deleteForm(req.user as IAdmin, formId);
    return res.status(OK).json({ message: 'Form deleted successfully' });
  } catch (error) {
    throw error;
  }
});

/**
 * Get forms by seller
 */
router.get(p.getFormsBySeller, requirePermission(EPermission.FORM_READ), async (req: Request, res: Response) => {
  try {
    const forms = await formService.getFormsBySeller(req.user as ISeller);
    return res.status(OK).json({ forms });
  } catch (error) {
    throw error;
  }
});

/**
 * Get all forms (admin only)
 */
router.get(p.getForms, requirePermission(EPermission.FORM_MANAGE), async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      sortOrder: Joi.string().valid(ESortOrderType.ASC, ESortOrderType.DESC).messages({
        'any.only': 'sortOrder must be either "ASC" or "DESC"'
      }),
      limit: Joi.number().integer().min(1),
      lastDocumentId: mongoIdValidation,
      sellerId: mongoIdValidation,
      startDate: Joi.date(),
      endDate: Joi.date().min(Joi.ref('startDate'))
    }).required();

    Joi.assert(req.query, schema);

    const conditions = new Map<string, any>();

    // Add query parameters to conditions
    Object.entries(req.query).forEach(([key, value]) => {
      conditions.set(key, value);
    });

    const forms = await formService.getForms(conditions);
    return res.status(OK).json({ forms });
  } catch (error) {
    throw error;
  }
});

export default router;