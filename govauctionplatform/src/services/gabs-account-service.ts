import { GabsAccount, IGabsAccount } from '../models/gabs-account-model';

async function getBySellerId(sellerId: string): Promise<IGabsAccount[]> {
  return GabsAccount.find({ sellerId }).sort({ createdAt: -1 });
}

async function create(sellerId: string, ministry: string, department: string, parentAccount: string, accountNumber: string, accountName: string): Promise<IGabsAccount> {
  return GabsAccount.create({ sellerId, ministry, department, parentAccount, accountNumber, accountName });
}

async function update(id: string, data: { ministry?: string; department?: string; parentAccount?: string; accountNumber?: string; accountName?: string }): Promise<IGabsAccount | null> {
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
