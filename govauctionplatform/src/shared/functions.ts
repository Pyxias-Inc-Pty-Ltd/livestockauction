import isURL from 'validator/lib/isURL';
import * as Joi from 'joi';
import isEmail from 'validator/lib/isEmail';
import isMongoId from 'validator/lib/isMongoId'
import isISO8601 from 'validator/lib/isISO8601';
import { parsePhoneNumber } from 'libphonenumber-js';
import * as luxon from 'luxon';
import { COUNTRY_PHONE_CODES } from '../globals';
import { randomBytes } from 'crypto';

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
          return v;
        }
      }


    } catch (error) {
      return helper.message({ custom: error.message });
    }
  });
export const isoDateValidation
  = Joi.string().custom((v: string, helper) => {
    if (!isISO8601(v)) {
      return helper.message({custom: 'Invalid ISO8601 date'});
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
      return helper.message({custom: 'Value not number like'});
    } else {
      return v;
    }
  });
  export const isArrayLike
  = Joi.string().custom((v: any, helper) => {
    if (typeof v === 'string') {

      if (v.charAt(0) !== '[') {
        return helper.message({custom: 'Value not array like'});
      }
      if (v.charAt(v.length - 1) !== ']') {
        return helper.message({custom: 'Value not array like'});
      }
      return v;
    } else {
      return helper.message({custom: 'Value not a string array'});
    }
  });
export const isStringBooleanLike
  = Joi.string().custom((v: string, helper) => {
    if (v.toLowerCase() === "true") {
      return v;
    } else if (v.toLowerCase() === "false") {
      return v;
    } else {
      return helper.message({custom: 'Value not boolean like'});
    }
  });

/**
 * Sorts an array of numbers by asc order
 * @param list
 */
export function sortNumberListAsc (list: Array<number>): Array<number> {
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
function isLatitudeCoordinate (v: number): boolean {
  return (v > -90) && (v < 90);
}

/**
 * Check if the given value is a valid longitude coordinate
 * 
 * @param v 
 * @returns true or false
 */
function isLongitudeCoordinate (v: number): boolean {
  return (v > -180) && (v < 180);
}

/**
 * Creates a slug from a string value e.g. Hello world becomes hello_world
 * @param { string } v The value to create a slug from
 */
export function generateSlug (v: string): string {
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
 * Format phone number as per tingg requirements
 * @param phoneNumber 
 * @returns 
 */
export function formatPhoneTinggNumber(phoneNumber: string): string {
  // Remove non-numeric characters
  const cleanedNumber = phoneNumber.replace(/\D/g, "");
  return cleanedNumber;
}

/**
 * Generates a UniPay payment URL
 * 
 * @param applicationId 
 * @returns 
 */
export function generateUniPayAppPaymentURL(applicationId: string): string {
  const payload = {"a":"d","b":`${applicationId}:null`};
  const jsonString = JSON.stringify(payload);
  const base64Encoded = Buffer.from(jsonString).toString('base64');
  return `https://unipay.africa/misc/${base64Encoded}`;
}