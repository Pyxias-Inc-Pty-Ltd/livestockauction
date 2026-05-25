import { Token, IToken } from "../models/token-model";

async function getActiveToken(): Promise<IToken | null> {
  try {
    const token = await Token.findOne({ isActive: true });
    return token;
  } catch (error) {
    // Rethrow
    throw error;
  }
}

// Export default
export default {
  getActiveToken
} as const;