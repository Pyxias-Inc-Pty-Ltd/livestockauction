import isURL from 'validator/lib/isURL';
import * as Joi from 'joi';
import isEmail from 'validator/lib/isEmail';
import isMongoId from 'validator/lib/isMongoId'
import isISO8601 from 'validator/lib/isISO8601';
import { parsePhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';
import { compare, genSalt, hash } from 'bcrypt';
import * as luxon from 'luxon';
import { BAITS_API_TOKEN, COUNTRY_PHONE_CODES, SALT_ROUNDS, SERVICE_URLS } from '../globals';
import { randomBytes, createHash } from 'crypto';
import { InternalServerError, NotFoundError } from './errors';
import * as axios from 'axios';

export const isoAlpha2CountryValidation
  = Joi.string().regex(/^[A-Z]{2}$/);
export const isoAlpha3CurrencyValidation
  = Joi.string().regex(/^[A-Z]{3}$/);
export const iataCodeValidation
  = Joi.string().regex(/^[A-Z]{3}$/);
export const parcelDimensionValidation
  = Joi.number().greater(-1);
export const latitudeCoordinatesValidation
  = Joi.number().greater(-90).less(90);
export const longitudeCoordinatesValidation
  = Joi.number().greater(-180).less(180);
export const polyLineValidation
  = Joi.array().custom((v: Array<Array<number>>, helper) => {
    if (v.length > 1) {
      let doesPolylineHaveError = false;
      for (let index = 0; index < v.length; index++) {
        const element = v[index];

        if (typeof element[0] !== 'number') {
          doesPolylineHaveError = true;
          break;
        }

        if (typeof element[1] !== 'number') {
          doesPolylineHaveError = true;
          break;
        }

        if (!isLatitudeCoordinate(element[1])) {
          doesPolylineHaveError = true;
          break;
        }

        if (!isLongitudeCoordinate(element[0])) {
          doesPolylineHaveError = true;
          break;
        }
      }

      if (doesPolylineHaveError) {
        return helper.message({ custom: 'Invalid polyline' });
      } else {
        return v;
      }

    } else {
      return helper.message({ custom: 'Invalid polyline' });
    }
  });
export const urlValidation
  = Joi.string().custom((v: string, helper) => {
    if (!isURL(v, { protocols: ["https"] })) {
      return helper.message({ custom: 'Invalid URL' });
    } else {
      return v;
    }
  });
export const emailValidation
  = Joi.string().custom((v: string, helper) => {
    if (!isEmail(v)) {
      return helper.message({ custom: 'Invalid email' });
    } else {
      return v;
    }
  });
export const userNameValidation
  = Joi.string().custom((v: string, helper) => {
    // Check length
    if (v.length < 5 || v.length > 15) {
      return helper.message({ custom: 'Invalid userName' });
    }
    // Check characters
    const validCharactersRegex = /^[a-zA-Z0-9_]+$/;
    if (!validCharactersRegex.test(v)) {
      return helper.message({ custom: 'Invalid userName' });
    }
    return v;
  });
export const phoneValidation
  = Joi.string().custom((v: string, helper) => {
    try {
      const phoneNumberTokens = v.split(' ');
      const countryCodeWithPlusSign = phoneNumberTokens[0];
      const countryCodeWithoutPlusSign = countryCodeWithPlusSign.replace('+', '');
      let needle: { country: string, code: string, iso: string } | null = null;

      for (const iterator of COUNTRY_PHONE_CODES) {
        if (iterator.code === countryCodeWithoutPlusSign) {
          needle = iterator;
          break;
        }
      }

      if (!needle) {
        throw new Error('Invalid phone');
      } else {
        const phoneNumber = parsePhoneNumber(v, needle.iso as any);
        // Check if phone number is valid
        if (!phoneNumber.isValid()) {
          throw new Error('Invalid phone');
        } else {
          return phoneNumber.formatInternational();
        }
      }


    } catch (error) {
      return helper.message({ custom: error.message });
    }
  });
export const isoDateValidation
  = Joi.string().custom((v: string, helper) => {
    if (!isISO8601(v)) {
      return helper.message({ custom: 'Invalid ISO8601 date' });
    } else {
      return v;
    }
  });
export const mongoIdValidation
  = Joi.string().custom((v: string, helper) => {
    if (!isMongoId(v)) {
      return helper.message({ custom: 'Invalid MongoId' });
    } else {
      return v;
    }
  });
export const isStringNumberLike
  = Joi.string().custom((v: any, helper) => {
    if (isNaN(v)) {
      return helper.message({ custom: 'Value not number like' });
    } else {
      return v;
    }
  });
export const isArrayLike
  = Joi.string().custom((v: any, helper) => {
    if (typeof v === 'string') {

      if (v.charAt(0) !== '[') {
        return helper.message({ custom: 'Value not array like' });
      }
      if (v.charAt(v.length - 1) !== ']') {
        return helper.message({ custom: 'Value not array like' });
      }
      return v;
    } else {
      return helper.message({ custom: 'Value not a string array' });
    }
  });
export const isStringBooleanLike
  = Joi.string().custom((v: string, helper) => {
    if (v.toLowerCase() === "true") {
      return v;
    } else if (v.toLowerCase() === "false") {
      return v;
    } else {
      return helper.message({ custom: 'Value not boolean like' });
    }
  });

/**
 * Sorts an array of numbers by asc order
 * @param list
 */
export function sortNumberListAsc(list: Array<number>): Array<number> {
  return list.sort((a, b) => {
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    // a must be equal to b
    return 0;
  });
}

/**
 * Convert Date object into YYYYMMDDTHHmmSSZ date format.
 * @param { Date } date a Date object
 * @return { String } time in YYYYMMDDTHHmmSSZ date format
 */
export function formatTimeGoogleCalendar(date: Date): string {
  return date.toISOString().replace(/-|:|\.\d+/g, '');
}

/**
 * Check if the given value is a valid latitude coordinate
 * 
 * @param v 
 * @returns true or false
 */
function isLatitudeCoordinate(v: number): boolean {
  return (v > -90) && (v < 90);
}

/**
 * Check if the given value is a valid longitude coordinate
 * 
 * @param v 
 * @returns true or false
 */
function isLongitudeCoordinate(v: number): boolean {
  return (v > -180) && (v < 180);
}

/**
 * Clean Joi error message by removing ANSI color codes and other noise
 */
export const cleanJoiErrorMessage = (errorMessage: string): string => {
  // Remove ANSI color codes
  let cleanMessage = errorMessage.replace(/\u001b\[\d+m/g, '');
  
  // Remove the entire request body dump that Joi sometimes includes
  // This regex removes everything before the actual error message in brackets
  cleanMessage = cleanMessage.replace(/^[^{]*\{[^}]*\}[^{]*\[.*?\]\s*/, '');
  
  // Extract just the error message part (usually in brackets at the end)
  const bracketMatch = cleanMessage.match(/\[(.*?)\]$/);
  if (bracketMatch) {
    cleanMessage = bracketMatch[1].trim();
  }
  
  // Common error message formatting
  if (cleanMessage.includes('Invalid MongoId')) {
    return 'Invalid MongoId';
  }
  
  // Remove any remaining request body content
  cleanMessage = cleanMessage.split('\n')[0].trim();
  
  return cleanMessage;
};

/**
 * Wrapper function for Joi validation with clean error messages
 */
export const validateWithJoi = (schema: Joi.ObjectSchema, data: any): void => {
  try {
    Joi.assert(data, schema);
  } catch (error) {
    if (error instanceof Joi.ValidationError) {
      const originalMessage = error.details[0]?.message || 'Validation error';
      const cleanMessage = cleanJoiErrorMessage(originalMessage);
      
      // Create a new error with the clean message
      const validationError = new Error(cleanMessage);
      validationError.name = 'ValidationError';
      throw validationError;
    }
    throw error;
  }
};

/**
 * Creates a slug from a string value e.g. Hello world becomes hello_world
 * @param { string } v The value to create a slug from
 */
export function generateSlug(v: string): string {
  // Check if string
  if (Object.prototype.toString.call(v) !== "[object String]") {
    throw new Error("Argument supplied must be a string");
  }
  const slugRegex = new RegExp(/([a-z0-9-\s])+/, 'g');
  let _result = v.toLowerCase();
  const regexp = _result.match(slugRegex);

  if (regexp === null || regexp.length === 0) {
    throw new Error("String must contain alpha-numeric characters");
  }
  return regexp.join('').replace(new RegExp(/\s/, 'g'), "_");
}

/**
 * Checks if the provided date (now) is before the start date.
 * 
 * @param now The date to compare against the start date. Must be a js date.
 * @param startDate The start date. Must be a js date.
 * @returns True if 'now' is before 'startDate', false otherwise.
 */
export function isBeforeStartDate(now: Date, startDate: Date): boolean {
  const nowLuxon = luxon.DateTime.fromJSDate(now);
  const startDateLuxon = luxon.DateTime.fromJSDate(startDate);
  return nowLuxon < startDateLuxon;
}

/**
 * Checks if the provided date (now) is before the end date.
 * 
 * @param now The date to compare against the end date. Must be a js date.
 * @param endDate The end date. Must be a js date.
 * @returns True if 'now' is before 'endDate', false otherwise.
 */
export function isBeforeEndDate(now: Date, endDate: Date): boolean {
  const nowLuxon = luxon.DateTime.fromJSDate(now);
  const endDateLuxon = luxon.DateTime.fromJSDate(endDate);
  return nowLuxon < endDateLuxon;
}

/**
 * Checks if the provided 'startDate' is before the provided 'endDate'.
 * 
 * @param startDate The start date. Must be a js date.
 * @param endDate The end date. Must be a js date.
 * @returns True if 'startDate' is before 'endDate', false otherwise.
 */
export function isStartDateBeforeEndDate(startDate: Date, endDate: Date): boolean {
  const startDateLuxon = luxon.DateTime.fromJSDate(startDate);
  const endDateLuxon = luxon.DateTime.fromJSDate(endDate);
  return startDateLuxon < endDateLuxon;
}

/**
 * Generates a random string of a specified length suitable for use as a password.
 * 
 * @param {number} [length=20] The desired length of the random string. Defaults to 20.
 * @returns {string} A random string containing characters from the allowed set.
 * @throws {Error} If an error occurs during random byte generation.
 */
export function generateRandomPassword(length = 20): string {
  const allowedChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

  try {
    // Generate random bytes with crypto
    const rb = randomBytes(Math.ceil(length / 2));
    // Convert bytes to a string of allowed characters
    const randomString = rb.toString('hex')
      .replace(/[^a-zA-Z0-9!@#$%^&*]/g, ''); // Remove non-allowed characters

    // If string length is less than desired, generate more bytes and repeat
    if (randomString.length < length) {
      return generateRandomPassword(); // Recursively call until desired length is achieved
    }

    // Truncate string to desired length
    return randomString.slice(0, length);
  } catch (err) {
    console.error('Error generating random password:', err);
    throw err; // Re-throw the error for handling
  }
}

/**
 * Converts the provided payment information to the Paygate format
 * and generates a checksum for verification.
 *
 * @param PAYGATE_ID - The unique identifier for the Paygate merchant.
 * @param REFERENCE - A unique transaction reference.
 * @param AMOUNT - The amount to be processed in the transaction.
 * @param CURRENCY - The currency code (e.g., "ZAR" for South African Rand).
 * @param RETURN_URL - The URL to return to after processing.
 * @param TRANSACTION_DATE - The transaction date formatted as "YYYY-MM-DD HH:MM:SS".
 * @param LOCALE - The locale for the transaction (e.g., "en-za" for South Africa).
 * @param COUNTRY - The ISO country code (e.g., "ZAF" for South Africa).
 * @param EMAIL - The email address of the customer.
 * @param NOTIFY_URL - The URL to receive notifications about the transaction.
 * @param encryptionKey - The secret key used to generate the checksum.
 *
 * @returns A URL-encoded string in the Paygate format.
 */
export function convertToPaygateFormat(
    PAYGATE_ID: string,
    REFERENCE: string,
    AMOUNT: number,
    CURRENCY: string,
    RETURN_URL: string,
    TRANSACTION_DATE: Date,
    LOCALE: string,
    COUNTRY: string,
    EMAIL: string,
    NOTIFY_URL: string,
    encryptionKey: string
): string {
    if (!PAYGATE_ID) {
        throw new Error('PAYGATE_ID is required');
    }
    if (!encryptionKey) {
        throw new Error('encryptionKey is required');
    }
    // Convert to cents (integer) — Math.round avoids floating-point issues
    // e.g., 100.55 * 100 = 10055.000000000002 → Math.round → 10055
    const amount = Math.round(AMOUNT * 100);
    const transactionDate = luxon.DateTime.fromJSDate(TRANSACTION_DATE).toFormat('yyyy-LL-dd HH:mm:ss');

    // Create the checksum string by concatenating the input values
    const checksumString = `${PAYGATE_ID}${REFERENCE}${amount}${CURRENCY}${RETURN_URL}${transactionDate}${LOCALE}${COUNTRY}${EMAIL}${NOTIFY_URL}${encryptionKey}`;

    // Calculate the MD5 checksum for the concatenated string
    const CHECKSUM = createHash('md5').update(checksumString).digest('hex');

    // Construct the final query string using URLSearchParams
    const formattedString = new URLSearchParams({
        PAYGATE_ID,
        REFERENCE,
        AMOUNT: `${amount}`,
        CURRENCY,
        RETURN_URL,
        TRANSACTION_DATE: transactionDate,
        LOCALE,
        COUNTRY,
        EMAIL,
        NOTIFY_URL,
        CHECKSUM,
    }).toString();

    return formattedString;
}

/**
 * Validates the CHECKSUM on a PayGate NOTIFY_URL POST.
 * PayGate computes the checksum by concatenating all notification field values
 * (excluding CHECKSUM itself, in the order they appear) then appending the encryption key, and MD5-hashing.
 */
export function validatePaygateNotifyChecksum(body: Record<string, string>, encryptionKey: string): boolean {
  const NOTIFY_FIELD_ORDER = [
    'PAYGATE_ID', 'PAY_REQUEST_ID', 'REFERENCE', 'TRANSACTION_STATUS',
    'RESULT_CODE', 'AUTH_CODE', 'CURRENCY', 'AMOUNT', 'RESULT_DESC',
    'TRANSACTION_ID', 'RISK_INDICATOR', 'PAY_METHOD', 'PAY_METHOD_DETAIL',
    'VAULT_ID', 'USER1', 'USER2', 'USER3',
  ];
  const checksumString = NOTIFY_FIELD_ORDER
    .filter(field => body[field] !== undefined && body[field] !== null && body[field] !== '')
    .map(field => body[field])
    .join('') + encryptionKey;
  const expected = createHash('md5').update(checksumString).digest('hex');
  return expected === body['CHECKSUM'];
}

/**
 * Formats a PayGate query string into a URL suitable for processing.
 *
 * @param {string} baseString - The query string containing PayGate parameters.
 *                              Example: "PAYGATE_ID=1050469100015&PAY_REQUEST_ID=D7F69068-6E36-E02F-CBD0-FD558C436AF4&REFERENCE=675df518df5dde426982a090&CHECKSUM=8753b7de0e6781762275b1fd6cd8ac0f"
 * @return {string} A formatted URL including only the PAY_REQUEST_ID and CHECKSUM.
 *                   Example: "https://secure.paygate.co.za/payweb3/process.trans?PAY_REQUEST_ID=D7F69068-6E36-E02F-CBD0-FD558C436AF4&CHECKSUM=8753b7de0e6781762275b1fd6cd8ac0f"
 * @throws {Error} If either PAY_REQUEST_ID or CHECKSUM is missing in the input string.
 */
export function generatePayGatePaymentURL(baseString: string) {
  const baseUrl = `${SERVICE_URLS.paygateBaseURI}/process.trans`;
  const params = new URLSearchParams(baseString);
  const payRequestId = params.get("PAY_REQUEST_ID");
  const checksum = params.get("CHECKSUM");

  if (payRequestId && checksum) {
    return `${baseUrl}?PAY_REQUEST_ID=${encodeURIComponent(payRequestId)}&CHECKSUM=${encodeURIComponent(checksum)}`;
  } else {
    throw new Error("Missing required parameters: PAY_REQUEST_ID or CHECKSUM");
  }
}

/**
 * Calls the PayGate initiate.trans endpoint and parses the response.
 * Checks for PayGate-level errors before extracting the payment link.
 *
 * @param formattedString - The URL-encoded request body produced by convertToPaygateFormat
 * @returns {{ paymentLink: string, payRequestId: string }}
 * @throws {Error} If the HTTP request fails or PayGate returns an error
 */
export async function callPayGateInitiate(formattedString: string): Promise<{ paymentLink: string, payRequestId: string }> {
  const queryResponse = await fetch(`${SERVICE_URLS.paygateBaseURI}/initiate.trans`, {
    method: "POST",
    body: formattedString,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  if (!queryResponse.ok) {
    throw new Error(`PayGate initiate.trans returned HTTP ${queryResponse.status}`);
  }

  const textResponse = await queryResponse.text();
  const params = new URLSearchParams(textResponse);

  // PayGate returns an ERROR field on failure (e.g. invalid amount, bad credentials)
  const payGateError = params.get("ERROR");
  if (payGateError) {
    throw new Error(`PayGate error: ${payGateError}`);
  }

  const payRequestId = params.get("PAY_REQUEST_ID");
  const checksum = params.get("CHECKSUM");

  if (!payRequestId || !checksum) {
    throw new Error(`PayGate response missing PAY_REQUEST_ID or CHECKSUM. Raw response: ${textResponse}`);
  }

  const paymentLink = `${SERVICE_URLS.paygateBaseURI}/process.trans?PAY_REQUEST_ID=${encodeURIComponent(payRequestId)}&CHECKSUM=${encodeURIComponent(checksum)}`;

  return { paymentLink, payRequestId };
}

/**
 * Prefixes a single-digit number with a zero.
 *
 * @param {number} input The number to be prefixed.
 * @returns {string} The number as a two-digit string, with a leading zero if necessary.
 */
export function prefixWithZero(input: number): string {
  if (input < 10) {
    return '0' + input;
  }
  return input.toString();
}

/**
 * Fetches animal data from the BAITS API by Electronic Identification (EID) tag number.
 *
 * This function uses Axios to make an asynchronous GET request to the BAITS API.
 *
 * @param {string} tagNumber - The Electronic Identification (EID) tag number of the animal.
 * @return {Promise<object>} A promise that resolves with the animal data object on success,
 * or rejects with an error object. The structure of the animal data object depends on the BAITS API response.
 * @throws {NotFoundError}  If the BAITS API returns a 404 status code (resource not found).
 * @throws {Error}  If the BAITS API returns any other unexpected status code or there's an error during the request.
 */
export async function getAnimalByEID(tagNumber: string): Promise<any> {
  try {
    const response = await axios.default.get(
      `${SERVICE_URLS.baits3URICore}/GetAnimalByEID`,
      {
        params: { TagNumber: tagNumber },
        headers: {
          'x-api-key': BAITS_API_TOKEN
        }
      }
    );

    if (response.status === 200) {
      return response.data; // Return the animal data from BAITS API
    } else if (response.status === 404) {
      throw new NotFoundError('Resource not found on BAITS API');
    } else {
      throw new Error('Invalid response from BAITS API');
    }
  } catch (error) {
    throw error; // Rethrow the error for the caller to handle
  }
}

// // TODO: Remove this function once we have a new API endpoint for fetching animal data from HMS
// export async function getAnimalByEIDFromHMS(tagNumber: string): Promise<any> {
//   try {
//     const response = await axios.default.get(
//       `${SERVICE_URLS.animalhealthURI}/open/getAnimalByEID`,
//       {
//         params: { eid: tagNumber }
//       }
//     );

//     if (response.status === 200) {
//       return response.data; // Return the animal data from HMS API
//     } else if (response.status === 404) {
//       throw new NotFoundError('Resource not found on HMS API');
//     } else {
//       throw new Error('Invalid response from HMS API');
//     }
//   } catch (error) {
//     throw error; // Rethrow the error for the caller to handle
//   }
// }

/**
 * Fetches animal data from the BAITS API by Modisar Animal ID.
 *
 * This function uses Axios to make an asynchronous GET request to the BAITS API.
 *
 * @param {string} modisarId - The Modisar Animal ID.
 * @return {Promise<object>} A promise that resolves with the animal data object on success,
 * or rejects with an error object. The structure of the animal data object depends on the BAITS API response.
 * @throws {NotFoundError}  If the BAITS API returns a 404 status code (resource not found).
 * @throws {Error}  If the BAITS API returns any other unexpected status code or there's an error during the request.
 */
export async function getAnimalByModisarId(modisarId: string): Promise<any> {
  try {
    const response = await axios.default.get(
      `${SERVICE_URLS.baits3URICore}/Animals/${modisarId}/details`,
      {
        headers: {
          'x-api-key': BAITS_API_TOKEN
        }
      }
    );

    if (response.status === 200) {
      return response.data; // Return the animal data from BAITS API
    } else if (response.status === 404) {
      throw new NotFoundError('Resource not found on BAITS API');
    } else {
      throw new Error('Invalid response from BAITS API');
    }
  } catch (error) {
    throw error; // Rethrow the error for the caller to handle
  }
}

/**
 * Transfers ownership of animals between keepers.
 *
 * This function asynchronously transfers ownership of animals between keepers
 * by sending a POST request to the BAITS3 URICore API endpoint.
 *
 * @param {object} input - The transfer details.
 * @param {string} input.OfficerID - The ID of the officer performing the transfer.
 * @param {string} input.CurrentHolding - The current holding location of the animals.
 * @param {string} input.CurrentKeeperID - The ID of the current keeper.
 * @param {string} input.NewBrandID - The ID of the new brand for the animals.
 * @param {string} input.NewBrandShapeID - The ID of the new brand shape for the animals.
 * @param {string} input.NewKeeperID - The ID of the new keeper.
 * @param {string} input.Remarks - Any remarks or notes about the transfer.
 * @param {string[]} input.AnimalTagRegIDs - An array containing the IDs of the animal tags being transferred.
 * @param {string} input.SupportingDocument - The ID of a supporting document for the transfer (optional).
 * @return {Promise<any>} A promise that resolves with the response data from the BAITS API on success,
 * or rejects with an error. The response data format depends on the BAITS API.
 * @throws {NotFoundError} If the BAITS API returns a 404 Not Found status code.
 * @throws {Error} If the BAITS API returns any other error status code or an invalid response.
 */
export async function transferAnimalBetweenKeepers(input: {
  OfficerID: string,
  CurrentHolding: string,
  CurrentKeeperID: string,
  NewBrandID: string,
  NewBrandShapeID: string,
  NewKeeperID: string,
  Remarks: string,
  AnimalTagRegIDs: Array<string>,
  SupportingDocument: string
}): Promise<any> {
  try {
    const response = await axios.default.post(
      `${SERVICE_URLS.baits3URICore}/AnimalsOwnershipTransfer?OfficerID=${input.OfficerID}`,
      {
        data: {
          CurrentHolding: input.CurrentHolding,
          CurrentKeeperID: input.CurrentKeeperID,
          NewBrandID: input.NewBrandID,
          NewBrandShapeID: input.NewBrandShapeID,
          NewKeeperID: input.NewKeeperID,
          Remarks: input.Remarks,
          AnimalTagRegIDs: input.AnimalTagRegIDs,
          SupportingDocument: input.SupportingDocument
        },
        headers: {
          'x-api-key': BAITS_API_TOKEN
        }
      }
    );

    if (response.status === 200) {
      return response.data; // Return the response data from BAITS API
    } else if (response.status === 404) {
      throw new NotFoundError('Resource not found on BAITS API');
    } else {
      throw new Error('Invalid response from BAITS API');
    }
  } catch (error) {
    throw error; // Rethrow the error for the caller to handle
  }
}

/**
 * Fetches animal breed data from the BAITS API by breed ID.
 *
 * This function uses Axios to make an asynchronous GET request to the BAITS API.
 *
 * @param {number} breedId - The unique identifier of the animal breed.
 * @return {Promise<object>} A promise that resolves with the animal breed data object on success,
 * or rejects with an error object. The structure of the breed data object depends on the BAITS API response.
 * @throws {NotFoundError}  If the BAITS API returns a 404 status code (resource not found).
 * @throws {Error}  If the BAITS API returns any other unexpected status code or there's an error during the request.
 */
export async function getAnimalBreedById(breedId: number): Promise<any> {
  try {
    const response = await axios.default.get(
      `${SERVICE_URLS.baits3URICore}/AnimalBreeds/${breedId}`,
      {
        headers: {
          'x-api-key': BAITS_API_TOKEN
        }
      }
    );

    if (response.status === 200) {
      return response.data; // Return the breed data from BAITS API
    } else if (response.status === 404) {
      throw new NotFoundError('Resource not found on BAITS API');
    } else {
      throw new Error('Invalid response from BAITS API');
    }
  } catch (error) {
    throw error; // Rethrow the error for the caller to handle
  }
}

/**
 * Fetches keeper information from the BAITS API by their registration number.
 *
 * This function uses Axios to make an asynchronous GET request to the BAITS API.
 *
 * @param {string} keeperRegNumber - The unique registration number of the keeper.
 * @return {Promise<object>} A promise that resolves with the keeper data object on success,
 * or rejects with an error object. The structure of the keeper data object depends on the BAITS API response.
 * @throws {NotFoundError}  If the BAITS API returns a 404 status code (resource not found).
 * @throws {Error}  If the BAITS API returns any other unexpected status code or there's an error during the request.
 */
export async function getKeeperByRegNumber(keeperRegNumber: string): Promise<any> {
  try {
    const response = await axios.default.get(
      `${SERVICE_URLS.baits3URICore}/Keepers/KeeperID-byKeeperRegNumber`,
      {
        params: { KeeperRegNumber: keeperRegNumber },
        headers: {
          'x-api-key': BAITS_API_TOKEN
        }
      }
    );

    console.log("Logged Response: ", response.status);

    if (response.status === 200) {
      return response.data; // Return the breed data from BAITS API
    } else if (response.status === 404) {
      throw new NotFoundError('Resource not found on BAITS API');
    } else {
      throw new InternalServerError('Invalid response from BAITS API');
    }
  } catch (error) {
    throw error; // Rethrow the error for the caller to handle
  }
}

/**
 * Fetches farmer information from the BAITS API by keeper ID.
 *
 * This function uses Axios to make an asynchronous GET request to the BAITS API.
 *
 * @param {number} keeperId - The unique identifier of the keeper.
 * @return {Promise<object>} A promise that resolves with the farmer data object on success,
 * or rejects with an error object. The structure of the farmer data object depends on the BAITS API response.
 * @throws {NotFoundError}  If the BAITS API returns a 404 status code (resource not found).
 * @throws {Error}  If the BAITS API returns any other unexpected status code or there's an error during the request.
 */
export async function getFarmerByKeeperId(keeperId: number): Promise<any> {
  try {
    const response = await axios.default.get(
      `${SERVICE_URLS.baits3URICore}/Keepers/${keeperId}`,
      {
        headers: {
          'x-api-key': BAITS_API_TOKEN
        }
      }
    );

    if (response.status === 200) {
      return response.data; // Return the breed data from BAITS API
    } else if (response.status === 404) {
      throw new NotFoundError('Resource not found on BAITS API');
    } else {
      throw new InternalServerError('Invalid response from BAITS API');
    }
  } catch (error) {
    throw error; // Rethrow the error for the caller to handle
  }
}

/**
 * Formats a BAITS Animal EID by inserting a space after the 4th character.
 * 
 * The input string should be exactly 16 characters long. If the length is
 * not 16 characters, an error is thrown.
 * 
 * @param {string} eid - The BAITS Animal EID string to format.
 * @return {string} - The formatted EID with a space between the 4th and 5th character.
 * @throws {Error} - If the input EID is not 16 characters long.
 * 
 */
export function formatBAITSAnimalEID(eid: string): string {
  if (eid.length !== 16) {
    throw new Error('Invalid EID format. EID must be 16 characters long.');
  }

  // Insert a space after the 4th character
  return `${eid.slice(0, 4)} ${eid.slice(4)}`;
}

/**
 * Generates a 6-digit OTP (One-Time Password) code using crypto.randomBytes.
 *
 * @return {string} A 6-digit OTP code.
 */
export function generateOTP(): string {
  // Generate random bytes
  const randomBuffer = randomBytes(4); // 4 bytes is enough to generate a large random number

  // Convert to a numeric value (using base 10)
  const otp = parseInt(randomBuffer.toString('hex'), 16) % 1000000; // Ensures it's a 6-digit number

  // Ensure OTP is padded to 6 digits
  return otp.toString().padStart(6, '0');
}

/**
 * Hashes a given OTP using bcrypt.
 *
 * The function generates a salt using the specified number of salt rounds and then hashes the OTP.
 * 
 * @param {string} otp - The One-Time Password (OTP) to be hashed.
 * @return {Promise<string>} - The hashed OTP.
 */
export async function hashOTP(otp: string): Promise<string> {
  const salt = await genSalt(SALT_ROUNDS);
  return await hash(otp, salt);
}

/**
 * Verifies an OTP by comparing the input OTP to the stored hashed OTP.
 * 
 * This function uses bcrypt's `compare` method to securely compare the input OTP with the stored hash.
 *
 * @param {string} inputOTP - The OTP provided by the user to verify.
 * @param {string} storedHash - The hashed OTP stored in the database.
 * @return {Promise<boolean>} - Returns `true` if the OTP matches the hash, otherwise `false`.
 */
export async function verifyOTP(inputOTP: string, storedHash: string): Promise<boolean> {
  return await compare(inputOTP, storedHash);
}

/**
 * Generates a unique auction number based on the current date and auction count.
 * 
 * @param {number} currentCount - The current count of auctions.
 * @returns {string} - The generated auction number.
 */
export function generateAuctionNumber(currentCount: number): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const count = (currentCount + 1).toString().padStart(3, '0');

  return `${year}${month}${day}${count}`;
}

/**
 * Formats a phone number to remove spaces and country code prefix.
 * @param {string} phoneNumber - The phone number in international format.
 * @return {string} - The formatted phone number or null if invalid.
 */
export function formatPhoneNumber(phoneNumber: string): string {
  const parsedNumber = parsePhoneNumberFromString(phoneNumber);
  
  if (!parsedNumber || !parsedNumber.isValid()) {
    throw new InternalServerError('Invalid phone');
  }
  
  return `${parsedNumber.countryCallingCode}${parsedNumber.nationalNumber}`;
}

/**
 * Normalizes and compares two names to determine if they match, 
 * regardless of differences in case, whitespace, or hyphens.
 * 
 * The function trims the input names, converts them to lowercase, 
 * and splits them into parts using spaces or hyphens. 
 * It then checks if all parts of one name exist in the other and vice versa.
 * 
 * @param {string} name1 - The first name to compare.
 * @param {string} name2 - The second name to compare.
 * @return {boolean} - Returns `true` if the names match after normalization, otherwise `false`.
 * 
 * @example
 * normalizeAndCompareNames("John-Doe", "john doe"); // true
 * normalizeAndCompareNames("Alice Smith", "Alice-Smith"); // true
 * normalizeAndCompareNames("Jane Doe", "Jane D"); // false
 */
export function normalizeAndCompareNames(name1: string, name2: string): boolean {
  // Normalize names: trim, convert to lowercase, and split into parts
  const normalize = (name: string) => name.trim().toLowerCase().split(/[\s-]+/);
  const parts1 = normalize(name1);
  const parts2 = normalize(name2);

  // Check if all parts of name1 exist in name2 and vice versa
  return (
    parts1.every(part => parts2.includes(part)) &&
    parts2.every(part => parts1.includes(part))
  );
}