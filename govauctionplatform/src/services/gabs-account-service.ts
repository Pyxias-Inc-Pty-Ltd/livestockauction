import { GabsAccount, IGabsAccount } from '../models/gabs-account-model';

async function getBySellerId(sellerId: string): Promise<IGabsAccount[]> {
  return GabsAccount.find({ sellerId }).sort({ createdAt: -1 });
}

async function create(sellerId: string, accountName: string, accountNumber: string): Promise<IGabsAccount> {
  return GabsAccount.create({ sellerId, accountName, accountNumber });
}

async function update(id: string, data: { accountName?: string; accountNumber?: string }): Promise<IGabsAccount | null> {
  return GabsAccount.findByIdAndUpdate(id, { $set: data }, { new: true });
}

async function remove(id: string): Promise<IGabsAccount | null> {
  return GabsAccount.findByIdAndDelete(id);
}

export default {
  getBySellerId,
  create,
  update,
  remove,
};
