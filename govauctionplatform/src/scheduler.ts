import * as axios from "axios";
import cron from "node-cron";
import { EItemStatus, EAuctionStatus, EPaymentStatus, ETransactionType } from "./globals";
import { Item } from "../src/models/item-model";
import { Auction } from "../src/models/auction-model";
import { Transaction } from "../src/models/transaction-model";
import { Token } from "../src/models/token-model";

export const runSchedulers = (): void => {
  // Job 1: itemStatusTrackerTrigger
  cron.schedule("*/1 * * * *", async () => {
    try {
      await Promise.all([
        Item.updateMany({ endTime: { $lte: new Date() } }, { $set: { status: EItemStatus.ENDED } }),
        Item.updateMany(
          { startTime: { $lte: new Date() }, status: EItemStatus.NOT_BEGUN },
          { $set: { status: EItemStatus.ACTIVE } }
        )
      ]);
      return;
    } catch (error) {
      console.error("Error running Job 1: itemStatusTrackerTrigger", error);
    }
  });

  // Job 2: auctionStatusTrackerTrigger
  cron.schedule("*/1 * * * *", async () => {
    try {
      await Promise.all([
        Auction.updateMany({ endTime: { $lte: new Date() } }, { $set: { status: EAuctionStatus.ENDED } }),
        Auction.updateMany(
          { startTime: { $lte: new Date() }, status: EAuctionStatus.NOT_BEGUN },
          { $set: { status: EAuctionStatus.ACTIVE } }
        )
      ]);
      return;
    } catch (error) {
      console.error("Error running Job 2: auctionStatusTrackerTrigger", error);
    }
  });

  // Job 3: transactionStatusTrackerTrigger
  cron.schedule("*/1 * * * *", async () => {
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      await Transaction.updateMany(
        {
          createdDate: { $lte: fifteenMinutesAgo },
          status: EPaymentStatus.PENDING,
          $or: [
            { transactionType: ETransactionType.RESERVATION },
            { transactionType: ETransactionType.PURCHASE }
          ],
        },
        { $set: { status: EPaymentStatus.FAILED } }
      );
    } catch (error) {
      console.error("Error running Job 3: transactionStatusTrackerTrigger", error);
    }
  });
  

  // Job 4: refreshTinggAuthToken
  cron.schedule("*/55 * * * *", async () => {
    try {
      const url = "https://api.tingg.africa/v3/cas/oauth/token/request";
      const apiKey = "WJLu6IaO6QMRbgm21UDvHA==";
    
      const params = {
        grant_type: "client_credentials",
        client_id: "PXYIASPNC2024",
        client_secret: "Q9l8VdoiAPnLKZ5Ayb8h6c5oDfsFmMfQ",
      };

      const response = await axios.default.post(url, params, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      const { access_token } = response.data;

      await Token.updateMany(
        { isActive: true },
        { $set: { isActive: false } }
      );

      // Insert
      await Token.create({
        isActive: true,
        value: access_token,
        apiKey,
        createdDate: new Date()
      });
      return;
    } catch (error) {
      console.error("Error running Job 4: refreshTinggAuthToken", error);
    }
  });
};
