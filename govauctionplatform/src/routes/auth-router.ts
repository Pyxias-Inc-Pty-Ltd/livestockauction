import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import passport from 'passport';
import { compare, hash } from 'bcrypt';
import userService from '../services/user-service';
import { BadRequestError, NotFoundError } from '../shared/errors';
const LocalStrategy = require('passport-local').Strategy;
import { sign, verify } from 'jsonwebtoken';
import { SERVICE_URLS, STATE_JWT_SECRET } from '../globals';
import Joi from 'joi';
import { emailValidation } from '../shared/functions';
import { isMongoId } from 'validator';

// Constants
const router = Router();
const { OK, INTERNAL_SERVER_ERROR, BAD_REQUEST } = StatusCodes;

// Paths
export const p = {
  login: '/login',
  get: '/access',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password'
} as const;

passport.use(new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password'
}, async function (username: string, password: string, cb: any) {
  try {

    // Find account by email or phone
    const [emailUser, phoneUser] = await Promise.all([userService.getByEmail(username), userService.getByPhone(username)]);

    // Check if exists
    if (emailUser) {
      // Verify password
      const isValid = await compare(password, emailUser.password ? emailUser.password : "");

      if (isValid) {
        return cb(null, emailUser.toJSON());
      } else {
        return cb(null, false);
      }
    } else if (phoneUser) {
      // Verify password
      const isValid = await compare(password, phoneUser.password? phoneUser.password: "");

      if (isValid) {
        return cb(null, phoneUser.toJSON());
      } else {
        return cb(null, false);
      }
    } else {
      return cb(null, false);
    }
  } catch (error) {
    return cb(error);
  }
}));

passport.serializeUser(function(user: any, cb: any) {
  process.nextTick(function() {
    cb(null, user);
  });
});

passport.deserializeUser(function(user: any, cb: any) {
  process.nextTick(function() {
    return cb(null, user);
  });
});

/**
 * Sign in with password
 */
router.post(p.login,
  passport.authenticate('local', { failWithError: true, session: false }),
    async (req: Request, res: Response) => {
      try {
        if (req.user) {
          const jwt = sign({subject: (req.user as any).id}, STATE_JWT_SECRET);
          res.status(OK)
          .send({token: jwt});
        } else {
          throw new NotFoundError('User not found');
        }
      } catch (error) {
        return res.status(500).send({ message: error.message });
      }
    }, (error: any, req: Request, res: Response) => {
      return res.status(401).send({ message: error.message });
    });
    
/**
 * Forgot Password
 */
router.post(p.forgotPassword, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      email: emailValidation.required().messages({
        'any.required': '"email" is a required field'
      })
    }).required();

    // Validate schema against input
    Joi.assert(req.body, schema);

    const { email } = req.body;
    const user = await userService.getByEmail(email);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const token = sign({ id: user.id }, STATE_JWT_SECRET, { expiresIn: '1h' });
    const resetLink = `${SERVICE_URLS.clientURI}${p.resetPassword}?token=${token}`;

    // await transporter.sendMail({
    //   to: email,
    //   subject: 'Password Reset',
    //   text: `Click here to reset your password: ${resetLink}`
    // });

    console.log("forgotPassword: ", resetLink);

    res.status(OK).send({ message: 'Password reset link has been sent to your email' });
  } catch (error) {
    res.status(INTERNAL_SERVER_ERROR).send({ message: error.message });
  }
});

/**
 * Reset Password
 */
router.post(p.resetPassword, async (req: Request, res: Response) => {
  try {
    const schema = Joi.object().keys({
      token: Joi.string().required().messages({
        'any.required': '"token" is a required field'
      }),
      newPassword: Joi.string().required().messages({
        'any.required': '"newPassword" is a required field'
      })
    }).required();

    // Validate schema against input
    Joi.assert(req.body, schema);

    const { token, newPassword } = req.body;
    const decoded: any = verify(token, STATE_JWT_SECRET);

    // Check if is mongoId
    if (!isMongoId(decoded.id)) {
      throw new BadRequestError('Invalid token');
    }

    const user = await userService.getById(decoded.id);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const hashedPassword = await hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    res.status(OK).send({ message: 'Password has been reset successfully' });
  } catch (error) {
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
      res.status(BAD_REQUEST).send({ message: 'Invalid or expired token' });
    } else {
      res.status(INTERNAL_SERVER_ERROR).send({ message: error.message });
    }
  }
});


// Export default
export default router;