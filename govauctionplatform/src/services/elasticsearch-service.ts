import { Client } from '@elastic/elasticsearch';
import { IItem, IItemMetadata, Item } from '../models/item-model';
import { IAuction, Auction } from '../models/auction-model';
import { ELASTICSEARCH_NODE, ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD, GeoLocation, ElasticsearchSortOption, SearchFilters, languageType } from '../globals';
import { Schema } from 'mongoose';

class ElasticsearchService {
  private client: Client;
  private itemIndex: string = 'items';

  constructor() {
    this.client = new Client({
      node: ELASTICSEARCH_NODE,
      auth: {
        username: ELASTICSEARCH_USERNAME,
        password: ELASTICSEARCH_PASSWORD
      }
    });
  }

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

  private async prepareItemDocument(item: IItem): Promise<any> {
    try {
      const auction = await Auction.findById(item.auctionId);
      if (!auction) {
        throw new Error('Auction not found');
      }

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

  public async updateItemsWithAuction(auction: IAuction): Promise<void> {
    try {
      const items = await Item.find({ auctionId: auction._id });
      const updatePromises = items.map(item => this.indexItem(item));
      await Promise.all(updatePromises);
    } catch (error) {
      console.error('Error updating items with auction:', error);
      throw error;
    }
  }

  private buildQuery(filters: SearchFilters, language: languageType): any {
    const {
      searchTerm,
      distance,
      sectorType,
      hasRegistrationFee,
      participationType,
      timeRange,
      lotStatus,
      isBeingLivestreamed
    } = filters;

    const must: any[] = [];
    const filter: any[] = [];

    if (searchTerm) {
      must.push({
        bool: {
          minimum_should_match: 1,
          should: [
            {
              match: {
                [`title.${language}`]: {
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
                [`title.${language}`]: {
                  query: searchTerm,
                  slop: 0
                }
              }
            },
            {
              match: {
                [`description.${language}`]: {
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
      });
    }

    if (distance) {
      filter.push({
        geo_distance: {
          distance: distance.distance,
          'auctionId.auctionCoordinates': [distance.lon, distance.lat]
        }
      });
    }

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

    return {
      bool: {
        must: must.length ? must : [{ match_all: {} }],
        filter
      }
    };
  }

  private transformResults(result: any, sortOption: ElasticsearchSortOption): any {
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

        if (sortOption === ElasticsearchSortOption.CLOSEST_TO_ME && hit.sort?.[0]) {
          return { ...baseResult, distance: hit.sort[0] };
        }
        return baseResult;
      })
    };
  }

  public async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: this.itemIndex });
    if (exists.body) return;

    await this.client.indices.create({
      index: this.itemIndex,
      body: {
        mappings: {
          properties: {
            'auctionId.auctionCoordinates': { type: 'geo_point' },
          },
        },
      },
    });
  }

  public async reindexAll(): Promise<{ indexed: number; failed: number }> {
    await this.ensureIndex();

    const items = await Item.find({});
    let indexed = 0;
    let failed = 0;

    for (const item of items) {
      try {
        await this.indexItem(item);
        indexed++;
      } catch (err) {
        failed++;
        console.error(`[elasticsearch] Failed to index item ${item._id}:`, err);
      }
    }

    console.info(`[elasticsearch] reindexAll complete — indexed: ${indexed}, failed: ${failed}`);
    return { indexed, failed };
  }

  public async search(
    filters: SearchFilters,
    sortOption: ElasticsearchSortOption,
    location?: GeoLocation,
    language: languageType = 'en'
  ): Promise<any> {
    try {
      // First get max_score
      const maxScoreResponse = await this.client.search({
        index: this.itemIndex,
        body: {
          _source: false,
          size: 1,
          track_scores: true,
          query: this.buildQuery(filters, language)
        }
      });

      const maxScore = maxScoreResponse.body.hits.max_score;
      const minScoreThreshold = maxScore * 0.5; // 50% cutoff

      // Then execute filtered search
      const result = await this.client.search({
        index: this.itemIndex,
        body: {
          from: filters.from || 0,
          size: filters.size || 10,
          min_score: minScoreThreshold,
          sort: this.getSortConfig(sortOption, location),
          track_scores: true,
          query: this.buildQuery(filters, language),
          highlight: {
            fields: {
              [`title.${language}`]: { number_of_fragments: 0 },
              [`description.${language}`]: {
                number_of_fragments: 3,
                fragment_size: 150
              }
            }
          }
        }
      });

      return this.transformResults(result, sortOption);
    } catch (error) {
      console.error('Error performing filtered search:', error);
      throw error;
    }
  }
}

export const esService = new ElasticsearchService();