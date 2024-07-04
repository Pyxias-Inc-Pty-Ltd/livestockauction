import { Request, Response, Router } from 'express';
import StatusCodes from 'http-status-codes';
import passport from 'passport';
import { compare } from 'bcrypt';
import userService from '../services/user-service';
import { NotFoundError } from '../shared/errors';
const LocalStrategy = require('passport-local').Strategy;
import { sign } from 'jsonwebtoken';
import { STATE_JWT_SECRET } from '../globals';

// Constants
const router = Router();
const { OK } = StatusCodes;

// Paths
export const p = {
  login: '/login',
  logout: '/logout',
  get: '/access'
} as const;

passport.use(new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password'
}, async function (username: string, password: string, cb: any) {
  try {

    // Find account by email
    const user = await userService.getByEmail(username);

    // Check if exists
    if (user) {
      // Verify password
      const isValid = await compare(password, user.password);

      if (isValid) {
        return cb(null, user.toJSON());
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
 * Sign out
 */
router.post(p.logout, (req, res) => {
  req.session.destroy((err) => {
    if (err) { 
      return res.status(500).send({ message: err.message });
    } else {
      res.status(OK).send({message: "Logout successful"});
    }
  });
});

// Export default
export default router;