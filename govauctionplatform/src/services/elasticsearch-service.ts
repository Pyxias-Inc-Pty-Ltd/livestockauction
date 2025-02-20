import { Client } from '@elastic/elasticsearch';
import { IItem, Item } from '../models/item-model';
import { IAuction, Auction } from '../models/auction-model';
import { ELASTICSEARCH_NODE, ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD } from '../globals';
import { Schema } from 'mongoose';

/**
 * Service for handling Elasticsearch operations for auction items
 * Manages indexing, updating, and removing items and their associated auction data
 * Maintains synchronization between MongoDB and Elasticsearch
 */
class ElasticsearchService {
  private client: Client;
  private itemIndex: string = 'items';

  /**
   * Initializes the Elasticsearch service with configured client
   * Sets up MongoDB hooks for automatic synchronization
   */
  constructor() {
    this.client = new Client({
      node: ELASTICSEARCH_NODE,
      auth: {
        username: ELASTICSEARCH_USERNAME,
        password: ELASTICSEARCH_PASSWORD
      }
    });
  }

  /**
   * Prepares an item document for Elasticsearch indexing
   * Fetches and transforms associated auction data
   * Formats all fields according to Elasticsearch mapping
   * 
   * @param item - The Mongoose item document to prepare
   * @return Promise resolving to the prepared Elasticsearch document
   * @throws Error if associated auction is not found
   * @private
   */
  private async prepareItemDocument(item: IItem): Promise<any> {
    try {
      // Populate the auction data
      const auction = await Auction.findById(item.auctionId);
      if (!auction) {
        throw new Error('Auction not found');
      }

      // Transform auction data to match Elasticsearch mapping
      const auctionData = {
        _id: auction._id.toString(),
        title: auction.title,
        titleSlug: auction.titleSlug,
        auctionNumber: auction.auctionNumber,
        auctionLocation: auction.auctionLocation,
        sectorType: auction.sectorType,
        auctionCoordinates: auction.auctionCoordinates?.coordinates ? {
          lat: auction.auctionCoordinates.coordinates[1],
          lon: auction.auctionCoordinates.coordinates[0]
        } : undefined,
        numberOfLots: auction.numberOfLots,
        hasRegistrationFee: auction.hasRegistrationFee,
        requiredAttributes: auction.requiredAttributes,
        registrationFee: auction.registrationFee,
        participantsWithBiddingNumbers: auction.participantsWithBiddingNumbers,
        globallyEligibleBidders: auction.globallyEligibleBidders,
        creatorId: auction.creatorId.toString(),
        categoryId: auction.categoryId.toString(),
        participationType: auction.participationType,
        terms: auction.terms,
        startTime: auction.startTime,
        endTime: auction.endTime,
        status: auction.status,
        publishedStatus: auction.publishedStatus,
        reasonForRejection: auction.reasonForRejection,
        publishedBy: auction.publishedBy?.toString(),
        isBeingLivestreamed: auction.isBeingLivestreamed,
        streamUrl: auction.streamUrl,
        createdDate: auction.createdDate,
        updatedDate: auction.updatedDate
      };

      // Prepare metadata object
      const metadata = {
        categoryId: item.categoryId.toString(),
        isLivestock: item.isLivestock,
        isAStud: item.isAStud,
        dob: item.dob,
        studRegistrationNumber: item.studRegistrationNumber,
        numberOfCalvesBorn: item.numberOfCalvesBorn,
        gender: item.gender,
        breed: item.breed,
        animalEID: item.animalEID,
        serialNumber: item.metadata?.serialNumber,
        baitsDump: item.baitsDump
      };

      // Construct the full document
      return {
        creatorId: item.creatorId.toString(),
        auctionId: auctionData,
        sellerId: item.sellerId.toString(),
        gallery: item.gallery,
        title: item.title,
        description: item.description,
        terms: item.terms,
        isBidIncrementedManually: item.isBidIncrementedManually,
        manualBidAmount: item.manualBidAmount,
        startingBid: item.startingBid,
        bidIncrement: item.bidIncrement,
        reservePrice: item.reservePrice,
        eligibleBidders: item.eligibleBidders,
        winningBidder: item.winningBidder?.toString(),
        currentBid: item.currentBid,
        titleSlug: item.titleSlug,
        buyoutPrice: item.buyoutPrice,
        startTime: item.startTime,
        endTime: item.endTime,
        version: item.version,
        status: item.status,
        isPurchased: item.isPurchased,
        metadata: metadata,
        createdDate: item.createdDate,
        updatedDate: item.updatedDate
      };
    } catch (error) {
      console.error('Error preparing item document:', error);
      throw error;
    }
  }

  /**
   * Indexes a single item document in Elasticsearch
   * Includes associated auction data and all metadata
   * 
   * @param item - The Mongoose item document to index
   * @throws Error if indexing fails
   * @public
   */
  public async indexItem(item: IItem): Promise<void> {
    try {
      const document = await this.prepareItemDocument(item);
      await this.client.index({
        index: this.itemIndex,
        id: item._id.toString(),
        document: document,
        refresh: true
      });
    } catch (error) {
      console.error('Error indexing item:', error);
      throw error;
    }
  }

  /**
   * Removes an item document from the Elasticsearch index
   * 
   * @param itemId - MongoDB ObjectId of the item to remove
   * @throws Error if deletion fails
   * @public
   */
  public async removeItem(itemId: Schema.Types.ObjectId): Promise<void> {
    try {
      await this.client.delete({
        index: this.itemIndex,
        id: itemId.toString(),
        refresh: true
      });
    } catch (error) {
      console.error('Error removing item:', error);
      throw error;
    }
  }

  /**
   * Updates all items associated with an auction in Elasticsearch
   * Called automatically when an auction is updated
   * Re-indexes all items to ensure auction data is current
   * 
   * @param auction - The updated auction document
   * @throws Error if update fails
   * @public
   */
  public async updateItemsWithAuction(auction: IAuction): Promise<void> {
    try {
      // Find all items that reference this auction
      const items = await Item.find({ auctionId: auction._id });
      
      // Update each item in Elasticsearch
      const updatePromises = items.map(item => this.indexItem(item));
      await Promise.all(updatePromises);
    } catch (error) {
      console.error('Error updating items with auction:', error);
      throw error;
    }
  }
}

// Export a singleton instance
export const esService = new ElasticsearchService();