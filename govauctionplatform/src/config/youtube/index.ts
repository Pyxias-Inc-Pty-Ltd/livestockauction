const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
import { join } from 'path';

const getAuth = async function () {
  const auth = await authenticate({
    scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    keyfilePath: join(__dirname, './client_secret_781742849070-a7i87jf08b207c6e59knbhu6162kp38k.apps.googleusercontent.com')
  });
  return google.youtube({ version: 'v3', auth });
}

export default {
  getAuth
}