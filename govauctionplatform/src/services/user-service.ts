import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { IAdmin, IUser, User, IAdminInput, Admin, IBidder, IBidderInput, Bidder, ISeller, ISellerInput, Seller, AuctionApprover, IAuctionApprover, IAuctionApproverInput } from "../models/user-model";
import { companyRegistrationVerificationIssuesTemplate, companyRegistrationVerificationSuccessTemplate, EAdminType, ESortOrderType, EUserSortType, EUserType, ID_VERIFICATION_API_KEY, invalidCompanyRegistrationTemplate, invalidNationalIDSMSTemplate, keeperIDVerificationTemplate, LIST_LIMIT_NUMBER, MAX_LIST_LIMIT_NUMBER, nameMismatchWithNationalIDSMSTemplate, nationalIDVerificationIssuesSMSTemplate, nationalIDVerificationSuccessSMSTemplate, SERVICE_URLS } from "../globals";
import { generateOTP, generateRandomPassword, getFarmerByKeeperId, getKeeperByRegNumber, hashOTP, normalizeAndCompareNames, verifyOTP } from "../shared/functions";
import { Schema } from "mongoose";
import * as axios from "axios";
import { assignRealmRole, createKeycloakUser, deleteKeycloakUser, resetKeycloakUserPassword, sendWelcomeEmail } from "../shared/keycloak";

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
 * Get a user by phone.
 *
 * @param phone
 * @returns
 */
async function getByPhone(phone: string): Promise<IUser | null> {
  try {
    return await User.findOne({ phone });
  } catch (error) {
    // Rethrow error
    throw error;
  }
}

/**
 * Get a user by their Keycloak subject ID (sub claim).
 * Used by the auth middleware after Keycloak JWT verification.
 *
 * @param keycloakId - The `sub` claim from the Keycloak access token
 * @returns
 */
async function getByKeycloakId(keycloakId: string): Promise<IUser | null> {
  try {
    return await User.findOne({ keycloakId });
  } catch (error) {
    throw error;
  }
}

/**
 * Add the initial admin.
 * Creates the user in Keycloak first (assigns ADMIN realm role),
 * then stores the profile in MongoDB keyed by keycloakId.
 *
 * @param input
 * @returns
 */
async function createInitAdmin(input: IAdminInput): Promise<IAdmin> {
  try {
    const existing = await Admin.findOne({ adminType: EAdminType.SUPER });
    if (existing) {
      throw new ConflictError('Root admin already exists');
    }

    // 1. Create in Keycloak
    const keycloakId = await createKeycloakUser({
      username: input.email,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      password: input.password,
      temporary: false,
    });

    // 2. Assign ADMIN realm role in Keycloak
    await assignRealmRole(keycloakId, 'ADMIN');

    // 3. Persist profile in MongoDB (no password stored locally)
    input.adminType = 'SUPER';
    const newAdmin = new Admin({ ...input, keycloakId, password: undefined });
    await newAdmin.save();

    return newAdmin;
  } catch (error) {
    throw error;
  }
}

/**
 * Add a bidder.
 * Creates the user in Keycloak first (assigns BIDDER realm role),
 * then stores the profile in MongoDB keyed by keycloakId.
 *
 * @param input
 * @returns
 */
async function createBidder(input: IBidderInput): Promise<IBidder> {
  try {
    // Username: prefer email, fall back to phone
    const username = input.email ?? input.phone;

    // 1. Create in Keycloak
    const keycloakId = await createKeycloakUser({
      username,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      password: input.password,
      temporary: false,
    });

    // 2. Assign BIDDER realm role in Keycloak
    await assignRealmRole(keycloakId, 'BIDDER');

    // 3. Persist profile in MongoDB (no password stored locally)
    const newBidder = new Bidder({ ...input, keycloakId, password: undefined });
    await newBidder.save();

    return newBidder;
  } catch (error) {
    throw error;
  }
}

/**
 * Verify identity number of the authenticated user against the government CIPA / Omang API.
 */
async function verifyIdentityNumber(userId: string): Promise<void> {
  try {
    const user = await Bidder.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Check if identityNumberVerificationStatus is pending
    if (user.identityNumberVerificationStatus === "PENDING") {
      try {
        if (user.isOrganization) {

          // For individuals, first make a GET request to verify the UIN
          const getResponse = await axios.default.get(`${SERVICE_URLS.idVerificationURI}/cipa/company/${user.identityNumber}`, {
            headers: {
              "x-api-key": ID_VERIFICATION_API_KEY
            }
          });

          // Check if the GET request was successful and the response indicates success
          if (getResponse.status === 200 && getResponse.data.success === true) {
            user.identityNumberVerificationStatus = "VERIFIED";
            await user.save();
            // Queue message
            const textContent = companyRegistrationVerificationSuccessTemplate.replace('[UserName]', user.name as string);
            await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
              data: {
                subject: 'Company Registration Number Verification Successful',
                email: user.email,
                message: textContent
              }
            }, {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": ID_VERIFICATION_API_KEY
              }
            });
          } else if (getResponse.status === 200 && getResponse.data.success === false) {
            user.identityNumberVerificationStatus = "VERIFICATION_REJECTED";
            user.reasonForIdentityNumberVerificationRejection = "Invalid UIN provided";
            await user.save();
            // Queue message
            const textContent = invalidCompanyRegistrationTemplate.replace('[UserName]', user.name as string);
            await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
              data: {
                subject: 'Invalid Company Registration Number',
                email: user.email,
                message: textContent
              }
            }, {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": ID_VERIFICATION_API_KEY
              }
            });
          } else if (getResponse.status !== 200) {

            if (user.identityNumberVerificationRetryCount < 1) {
              // Queue message
              const textContent = companyRegistrationVerificationIssuesTemplate.replace('[UserName]', user.name as string);
              await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
                data: {
                  subject: 'Temporary Issues with Company Registration Number Verification',
                  email: user.email,
                  message: textContent
                }
              }, {
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ID_VERIFICATION_API_KEY
                }
              });
            }

            user.identityNumberVerificationRetryCount += 1;
            await user.save();

            // For organizations, directly send the POST request
            await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/verifyCompanyQueue/add-job`, {
              data: {
                userId: user.id
              }
            }, {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": ID_VERIFICATION_API_KEY
              }
            });
            console.log('Payload sent to verifyCompanyQueue');
          }
        } else {
          // For individuals, first make a GET request to verify the Omang
          const getResponse = await axios.default.get(`${SERVICE_URLS.idVerificationURI}/omang/payload/${user.identityNumber}`, {
            headers: {
              "x-api-key": ID_VERIFICATION_API_KEY
            }
          });

          // Check if the GET request was successful and the response indicates success
          if (getResponse.status === 200 && getResponse.data.success === true) {
            const { data } = getResponse.data;
            const isFirstNameMatch = normalizeAndCompareNames(data[0]['FIRST_NME'], user.firstName);
            const isLastNameMatch = normalizeAndCompareNames(data[0]['SURNME'], user.lastName);

            if (isFirstNameMatch && isLastNameMatch) {
              user.identityNumberVerificationStatus = "VERIFIED";
              await user.save();
              // Queue message
              const textContent = nationalIDVerificationSuccessSMSTemplate.replace('[UserName]', user.firstName as string);
              await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/smsQueue/add-job`, {
                data: {
                  subject: 'onlineauction.gov.bw',
                  phone: user.phone,
                  message: textContent
                }
              }, {
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ID_VERIFICATION_API_KEY
                }
              });
            } else {
              user.identityNumberVerificationStatus = "VERIFICATION_REJECTED";
              user.reasonForIdentityNumberVerificationRejection = "Name mismatch with Omang provided";
              await user.save();
              // Queue message
              const textContent = nameMismatchWithNationalIDSMSTemplate.replace('[UserName]', user.firstName as string);
              await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/smsQueue/add-job`, {
                data: {
                  subject: 'onlineauction.gov.bw',
                  phone: user.phone,
                  message: textContent
                }
              }, {
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ID_VERIFICATION_API_KEY
                }
              });
            }
          } else if (getResponse.status === 200 && getResponse.data.success === false) {
            user.identityNumberVerificationStatus = "VERIFICATION_REJECTED";
            user.reasonForIdentityNumberVerificationRejection = "Invalid Omang provided";
            await user.save();
            // Queue message
            const textContent = invalidNationalIDSMSTemplate.replace('[UserName]', user.firstName as string);
            await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/smsQueue/add-job`, {
              data: {
                subject: 'onlineauction.gov.bw',
                phone: user.phone,
                message: textContent
              }
            }, {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": ID_VERIFICATION_API_KEY
              }
            });
          } else if (getResponse.status !== 200) {

            if (user.identityNumberVerificationRetryCount < 1) {
              // Queue message
              const textContent = nationalIDVerificationIssuesSMSTemplate.replace('[UserName]', user.firstName as string);
              await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/smsQueue/add-job`, {
                data: {
                  subject: 'onlineauction.gov.bw',
                  phone: user.phone,
                  message: textContent
                }
              }, {
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": ID_VERIFICATION_API_KEY
                }
              });
            }

            user.identityNumberVerificationRetryCount += 1;
            await user.save();

            // If the GET request fails or the response is not successful, send the POST request
            await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/verifyOmangQueue/add-job`, {
              data: {
                userId: user.id
              }
            }, {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": ID_VERIFICATION_API_KEY
              }
            });
            console.log('Payload sent to verifyOmangQueue');
          }
        }
      } catch (error) {
        console.error('Error during verification process:', error);
        throw error;
      }
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Add a seller.
 * Creates the user in Keycloak (assigns SELLER realm role) with a
 * temporary password — Keycloak will prompt the user to change it on
 * first login.  The profile is stored in MongoDB keyed by keycloakId.
 *
 * @param currentUser - The admin creating the seller
 * @param input
 * @returns
 */
async function createSeller(currentUser: IAdmin, input: ISellerInput): Promise<ISeller> {
  try {
    // 1. Create in Keycloak without a password — seller sets their own via welcome email
    const keycloakId = await createKeycloakUser({
      username: input.email,
      email: input.email,
      phone: input.phone,
    });

    // 2. Assign SELLER realm role in Keycloak
    await assignRealmRole(keycloakId, 'SELLER');

    // 3. Email seller a one-time link to set their own password (most secure: admin never sees password)
    await sendWelcomeEmail(keycloakId);

    // 3. Persist profile in MongoDB (no password stored locally)
    const newSeller = new Seller({
      ...input,
      keycloakId,
      password: undefined,
      tz: currentUser.tz,
      locale: currentUser.locale,
    });
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
 * Get admins.
 * 
 * @param conditions
 * @param projection
 * @returns 
 */
async function getAdmins(projection?: any): Promise<IAdmin[]> {
  try {
    return User.find({ userType: EUserType.ADMIN }, projection);
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

/**
 * Fetches a report containing various user statistics.
 *
 * @returns {Promise<any>} A promise resolving to an object containing user report data:
 *   - `totalUsers`: The total number of registered users.
 *   - `usersByType`: An array of objects containing user counts by type (e.g., admin, user). Each object has properties:
 *     - `_id`: The user type.
 *     - `count`: The number of users for that type.
 *   - `usersCreatedLast30Days`: The number of users created in the last 30 days.
 * @throws {Error} Any errors encountered during data retrieval or aggregation.
 */
async function getUserReport() {
  try {
    const totalUsers = await User.countDocuments();
    const usersByType = await User.aggregate([
      {
        $group: {
          _id: '$userType',
          count: { $sum: 1 }
        }
      }
    ]);

    const usersCreatedLast30Days = await User.countDocuments({
      createdDate: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    });

    return {
      totalUsers,
      usersByType,
      usersCreatedLast30Days
    };
  } catch (error) {
    // Handle the error
    throw error;
  }
}

/**
 * Begin BAITS keeper verification.
 * 
 * @param currentUser
 * @param keeperId
 * @returns 
 */
async function beginBAITSKeeperIDVerification(currentUser: IBidder, keeperId: string): Promise<void> {
  try {
    const keeper = await getKeeperByRegNumber(keeperId);
    const farmer = await getFarmerByKeeperId(keeper.KeeperID);
    const otp = generateOTP();

    console.log('otp: ', otp);
    
    let htmlContent = keeperIDVerificationTemplate
      .replace('[UserName]', currentUser.isOrganization ? currentUser.name as string : currentUser.firstName as string)
      .replace('[otp]', otp);

    currentUser.keeperIdHash = await hashOTP(otp);
    currentUser.keeperId = keeperId;

    await currentUser.save();

    if (farmer.EmailID) {
      await axios.default.post(`${SERVICE_URLS.onlineAuctionQueueURI}/emailQueue/add-job`, {
        data: {
          subject: 'BAITS Keeper ID verification',
          email: farmer.EmailID,
          message: htmlContent
        }
      }, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ID_VERIFICATION_API_KEY
        }
      });
    }

  } catch (error) {
    throw error;
  }
}

/**
 * Ends the BAITS keeper verification cycle.
 * 
 * @param currentUser
 * @param otp
 * @returns 
 */
async function finishBAITSKeeperIDVerification(currentUser: IBidder, otp: string): Promise<boolean> {
  try {
    const result = await verifyOTP(otp, currentUser.keeperIdHash);

    if (result) {
      currentUser.isKeeperIdVerified = true;
      await currentUser.save();
    }
    
    return result;
  } catch (error) {
    throw error;
  }
}

/**
 * Add an auction approver.
 * Creates the user in Keycloak (assigns AUCTION_APPROVER realm role) with
 * a temporary password, then stores the profile in MongoDB.
 *
 * @param currentUser - The seller creating the auction approver
 * @param input - Auction approver input data
 * @returns Promise<IAuctionApprover>
 */
async function createAuctionApprover(currentUser: ISeller, input: IAuctionApproverInput): Promise<IAuctionApprover> {
  try {
    // 1. Create in Keycloak without a password — approver sets their own via welcome email
    const keycloakId = await createKeycloakUser({
      username: input.email,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
    });

    // 2. Assign AUCTION_APPROVER realm role in Keycloak
    await assignRealmRole(keycloakId, 'AUCTION_APPROVER');

    // 3. Email approver a one-time link to set their own password
    await sendWelcomeEmail(keycloakId);

    // 3. Persist profile in MongoDB (no password stored locally)
    const newApprover = new AuctionApprover({
      ...input,
      keycloakId,
      password: undefined,
      tz: currentUser.tz,
      locale: currentUser.locale,
      createdBySeller: currentUser.id,
    });
    await newApprover.save();

    return newApprover;
  } catch (error) {
    throw error;
  }
}

/**
 * Get auction approvers for a specific seller.
 * 
 * @param sellerId - ID of the seller
 * @param projection - Optional fields to project
 * @returns Promise<IAuctionApprover[]>
 */
async function getAuctionApproversForSeller(sellerId: string | Schema.Types.ObjectId, projection?: any): Promise<IAuctionApprover[]> {
  try {
    return await AuctionApprover.find(
      { createdBySeller: sellerId, isActive: true }, 
      projection
    );
  } catch (error) {
    throw error;
  }
}

/**
 * Update auction approver active status.
 * 
 * @param currentUser - The seller making the update
 * @param approverId - ID of the approver to update
 * @param isActive - New active status
 * @returns Promise<IAuctionApprover>
 */
async function updateAuctionApproverStatus(
  currentUser: ISeller,
  approverId: string | Schema.Types.ObjectId,
  isActive: boolean
): Promise<IAuctionApprover | null> {
  try {
    const approver = await AuctionApprover.findOne({
      _id: approverId,
      createdBySeller: currentUser.id
    });

    if (!approver) {
      throw new ConflictError('Auction approver not found or not authorized');
    }

    approver.isActive = isActive;
    await approver.save();

    return approver;
  } catch (error) {
    throw error;
  }
}

/**
 * Get an auction approver by ID.
 * 
 * @param id - Approver ID
 * @param projection - Optional fields to project
 * @returns Promise<IAuctionApprover | null>
 */
async function getAuctionApproverById(id: string | Schema.Types.ObjectId, projection?: any): Promise<IAuctionApprover | null> {
  try {
    return await AuctionApprover.findById(id, projection);
  } catch (error) {
    throw error;
  }
}

/**
 * Update a user's password in Keycloak via the Admin API.
 * Used by the PUT /app/users/updatePassword endpoint.
 *
 * @param keycloakId - Keycloak subject ID of the user
 * @param newPassword - The new plain-text password
 * @param temporary   - If true the user must change on next login
 */
async function updatePasswordInKeycloak(
  keycloakId: string,
  newPassword: string,
  temporary = false,
): Promise<void> {
  try {
    await resetKeycloakUserPassword(keycloakId, newPassword, temporary);
  } catch (error) {
    throw error;
  }
}

/**
 * Delete a user from both Keycloak and MongoDB.
 *
 * @param userId - MongoDB document ID
 */
async function deleteUser(userId: string): Promise<void> {
  try {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    if (user.keycloakId) {
      await deleteKeycloakUser(user.keycloakId);
    }

    await User.deleteOne({ _id: userId });
  } catch (error) {
    throw error;
  }
}

// Export default
export default {
  getUserReport,
  getAdmins,
  setFirebaseTokenId,
  beginBAITSKeeperIDVerification,
  finishBAITSKeeperIDVerification,
  createInitAdmin,
  createBidder,
  createSeller,
  verifyIdentityNumber,
  createAuctionApprover,
  getByEmail,
  getByPhone,
  getByKeycloakId,
  getUsers,
  getById,
  getAuctionApproversForSeller,
  getAuctionApproverById,
  updateAuctionApproverStatus,
  updatePasswordInKeycloak,
  deleteUser,
} as const;