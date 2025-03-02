import { Client } from '@elastic/elasticsearch';
import { IItem, IItemMetadata, Item } from '../models/item-model';
import { IAuction, Auction } from '../models/auction-model';
import { ELASTICSEARCH_NODE, ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD, GeoLocation, ElasticsearchSortOption, SearchFilters } from '../globals';
import { Schema } from 'mongoose';

// ** FILTERS **
// Distance
// SectorType
// Has Registration Fee
// Participation Type
// Start Time - End Time
// Lot Status
// Is Being Livestreamed


// ** CONTEXT DEPENDENT FILTES **
// Age
// Sex/Gender

// ** SORT BY **
// Closest To Me
// Date Listed (New To Old)
// Date Listed (Old To New)
// Time Until Sale Date

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
   * Generates sort configuration based on standard sort options
   * @param sortOption - The sort option to apply
   * @param location - User's location for distance-based sorting
   * @return Sort configuration for Elasticsearch query
   * @private
   */
  private getSortConfig(sortOption: ElasticsearchSortOption, location?: GeoLocation): any[] {
    switch (sortOption) {
      case ElasticsearchSortOption.CLOSEST_TO_ME:
        if (!location) {
          throw new Error('Location is required for distance-based sorting');
        }
        return [{
          _geo_distance: {
            'auctionId.auctionCoordinates': {
              lat: location.lat,
              lon: location.lon
            },
            order: 'asc',
            unit: 'km',
            mode: 'min',
            distance_type: 'arc'
          }
        }];

      case ElasticsearchSortOption.DATE_LISTED_DESC:
        return [{
          createdDate: {
            order: 'desc'
          }
        }];

      case ElasticsearchSortOption.DATE_LISTED_ASC:
        return [{
          createdDate: {
            order: 'asc'
          }
        }];

      case ElasticsearchSortOption.TIME_UNTIL_SALE:
        return [{
          startTime: {
            order: 'asc'
          }
        }];

      default:
        return ['_score'];
    }
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

      const metadata = {} as IItemMetadata;

      if (item.metadata.categoryId) {
        metadata.categoryId = item.metadata.categoryId.toString();
      }

      if (item.metadata.isLivestock) {
        metadata.isLivestock = item.metadata.isLivestock;
      }

      if (item.metadata.isAStud) {
        metadata.isAStud = item.metadata.isAStud;
      }

      if (item.metadata.dob) {
        metadata.dob = item.metadata.dob;
      }

      if (item.metadata.studRegistrationNumber) {
        metadata.studRegistrationNumber = item.metadata.studRegistrationNumber;
      }

      if (item.metadata.numberOfCalvesBorn) {
        metadata.numberOfCalvesBorn = item.metadata.numberOfCalvesBorn;
      }

      if (item.metadata.gender) {
        metadata.gender = item.metadata.gender;
      }

      if (item.metadata.breed) {
        metadata.breed = item.metadata.breed;
      }

      if (item.metadata.animalEID) {
        metadata.animalEID = item.metadata.animalEID;
      }

      if (item.metadata.serialNumber) {
        metadata.serialNumber = item.metadata.serialNumber;
      }

      if (item.metadata.baitsDump) {
        metadata.baitsDump = item.metadata.baitsDump;
      }

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
        body: document,
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

  /**
   * Enhanced search method with standard sort options
   * @param filters - Search filters
   * @param sortOption - Standard sort option to apply
   * @param location - User's location for distance-based sorting
   * @return Search results
   * @public
   */
  public async search(
    filters: SearchFilters,
    sortOption: ElasticsearchSortOption,
    location?: GeoLocation
  ): Promise<any> {
    try {
      const {
        searchTerm,
        distance,
        sectorType,
        hasRegistrationFee,
        participationType,
        timeRange,
        lotStatus,
        isBeingLivestreamed,
        from = 0,
        size = 10
      } = filters;
  
      // Build query
      const must: any[] = [];
      const filter: any[] = [];
  
      // Text search with nested bool query
      if (searchTerm) {
        must.push({
          bool: {
            minimum_should_match: 1,
            should: [
              {
                bool: {
                  minimum_should_match: 1,
                  should: [
                    {
                      match: {
                        "title.en": {
                          query: searchTerm,
                          minimum_should_match: "70%",
                          fuzziness: "auto",
                          prefix_length: 3,
                          max_expansions: 5,
                          boost: 2
                        }
                      }
                    },
                    {
                      match_phrase: {
                        "title.en": {
                          query: searchTerm,
                          slop: 0
                        }
                      }
                    },
                    {
                      match: {
                        "description.en": {
                          query: searchTerm,
                          minimum_should_match: "100%",
                          fuzziness: "auto",
                          prefix_length: 3,
                          max_expansions: 5
                        }
                      }
                    }
                  ]
                }
              },
              {
                bool: {
                  minimum_should_match: 1,
                  should: [
                    {
                      match: {
                        "title.tn": {
                          query: searchTerm,
                          minimum_should_match: "70%",
                          fuzziness: "auto",
                          prefix_length: 3,
                          max_expansions: 5,
                          boost: 2
                        }
                      }
                    },
                    {
                      match_phrase: {
                        "title.tn": {
                          query: searchTerm,
                          slop: 0
                        }
                      }
                    },
                    {
                      match: {
                        "description.tn": {
                          query: searchTerm,
                          minimum_should_match: "100%",
                          fuzziness: "auto",
                          prefix_length: 3,
                          max_expansions: 5
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        });
      }
  
      // Distance/Geo filter
      if (distance) {
        filter.push({
          geo_distance: {
            distance: distance.distance,
            'auctionId.auctionCoordinates': [distance.lon, distance.lat]
          }
        });
      }
  
      // Add other filters
      if (sectorType?.length) {
        filter.push({ terms: { 'auctionId.sectorType': sectorType } });
      }
  
      if (hasRegistrationFee !== undefined) {
        filter.push({ term: { 'auctionId.hasRegistrationFee': hasRegistrationFee } });
      }
  
      if (participationType?.length) {
        filter.push({ terms: { 'auctionId.participationType': participationType } });
      }
  
      if (timeRange) {
        const timeRangeFilter: any = { range: { 'startTime': {} } };
        if (timeRange.startTime) timeRangeFilter.range['startTime'].gte = timeRange.startTime;
        if (timeRange.endTime) timeRangeFilter.range['startTime'].lte = timeRange.endTime;
        filter.push(timeRangeFilter);
      }
  
      if (lotStatus?.length) {
        filter.push({ terms: { status: lotStatus } });
      }
  
      if (isBeingLivestreamed !== undefined) {
        filter.push({ term: { 'auctionId.isBeingLivestreamed': isBeingLivestreamed } });
      }
  
      // Get sort configuration
      const sort = this.getSortConfig(sortOption, location);
      const payload = {
        index: this.itemIndex,
        body: {
          from,
          size,
          sort,
          track_scores: true,
          query: {
            bool: {
              must: must.length ? must : [{ match_all: {} }],
              filter
            }
          },
          highlight: {
            fields: {
              title: {
                number_of_fragments: 0
              },
              description: {
                number_of_fragments: 3,
                fragment_size: 150
              }
            }
          }
        }
      };
  
      const result = await this.client.search(payload);
  
      // Transform results with conditional distance
      return {
        total: typeof result.body.hits.total === 'number' 
          ? result.body.hits.total 
          : result.body.hits.total.value,
        hits: result.body.hits.hits.map((hit: any) => {
          const baseResult = {
            id: hit._id,
            score: hit._score,
            item: {
              ...hit._source,
              highlights: hit.highlight || {}
            }
          };
  
          // Only add distance for CLOSEST_TO_ME sort option
          if (sortOption === ElasticsearchSortOption.CLOSEST_TO_ME && hit.sort?.[0]) {
            return {
              ...baseResult,
              distance: hit.sort[0]
            };
          }
  
          return baseResult;
        })
      };
    } catch (error) {
      console.error('Error performing search:', error);
      throw error;
    }
  }
}

// Export a singleton instance
export const esService = new ElasticsearchService();