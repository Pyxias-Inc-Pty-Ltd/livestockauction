import { ConflictError, ForbiddenError } from "../shared/errors";
import { IAdmin, IUser, User, IAdminInput, Admin, IBidder, IBidderInput, Bidder, ISeller, ISellerInput, Seller } from "../models/user-model";
import { EAdminType, ESortOrderType, EUserSortType, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER, SALT_ROUNDS } from "../globals";
import { genSalt, hash } from 'bcrypt';
import { generateRandomPassword } from "../shared/functions";
import { Schema } from "mongoose";

/**
 * Get a user by id.
 * 
 * @param id 
 * @returns 
 */
async function getById(id: string | Schema.Types.ObjectId, projection?: any): Promise<IUser | null> {
  try {
    return await User.findById(id, projection);
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Get a user by email.
 * 
 * @param email 
 * @returns 
 */
async function getByEmail(email: string): Promise<IUser | null> {
  try {
    return await User.findOne({ email });
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Add the initial admin.
 * 
 * @param input
 * @returns 
 */
async function createInitAdmin(input: IAdminInput): Promise<IAdmin> {
  try {
    const user = await Admin.findOne({ adminType: EAdminType.SUPER });

    // Check if exists
    if (user) {
      throw new ConflictError('Root admin already exists');
    }

    const salt = await genSalt(SALT_ROUNDS);
    const hashedSecretInput = await hash(input.password, salt);

    // Set password
    input.password = hashedSecretInput;
    input.adminType = "SUPER";

    const newAdmin = new Admin(input);
    await newAdmin.save();

    return newAdmin;
  } catch (error) {
    throw error;
  }
}

/**
 * Add a bidder.
 * 
 * @param input
 * @returns 
 */
async function createBidder(input: IBidderInput): Promise<IBidder> {
  try {
    const salt = await genSalt(SALT_ROUNDS);
    const hashedSecretInput = await hash(input.password, salt);

    // Set password
    input.password = hashedSecretInput;

    const newBidder = new Bidder(input);
    await newBidder.save();

    return newBidder;
  } catch (error) {
    throw error;
  }
}

/**
 * Add a seller.
 * 
 * @param input
 * @returns 
 */
async function createSeller(currentUser: IAdmin, input: ISellerInput): Promise<ISeller> {
  try {
    const salt = await genSalt(SALT_ROUNDS);
    const hashedSecretInput = await hash(generateRandomPassword(), salt);

    // Set password
    input.password = hashedSecretInput;

    const newSeller = new Seller(input);

    newSeller.tz = currentUser.tz;
    newSeller.locale = currentUser.locale;
    newSeller.tz = currentUser.tz;

    await newSeller.save();

    return newSeller;
  } catch (error) {
    throw error;
  }
}

/**
 * Get users.
 * 
 * @param conditions
 * @param projection
 * @returns 
 */
async function getUsers(conditions: Map<string, any>, projection?: any): Promise<IUser[]> {
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
    const q = User.find({}, projection);

    // Filters
    if (conditions.get('userType')) {
      q.where({userType: conditions.get('userType')});
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
      if (conditions.get('sortBy') === EUserSortType.DATE) {
        q.sort({'_id': conditions.get('sortOrder')});
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

/**
 * Set Firebase Token ID for a user.
 * 
 * @param currentUser - The currently logged in user.
 * @param tokenId - The Firebase Token ID to set.
 * @returns
 */
async function setFirebaseTokenId(currentUser: IUser, tokenId: string): Promise<void> {
  try {
    currentUser.firebaseTokenId = tokenId;
    await currentUser.save();
  } catch (error) {
    throw error;
  }
}

// Export default
export default {
  setFirebaseTokenId,
  createInitAdmin,
  createBidder,
  createSeller,
  getByEmail,
  getUsers,
  getById
} as const;