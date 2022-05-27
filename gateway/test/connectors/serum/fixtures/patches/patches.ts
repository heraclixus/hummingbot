import { MarketOptions, OpenOrders } from '@project-serum/serum/lib/market';
import {
  Account,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { Solana } from '../../../../../src/chains/solana/solana';
import { Serum } from '../../../../../src/connectors/serum/serum';
import { getNotNullOrThrowError } from '../../../../../src/connectors/serum/serum.helpers';
import {
  CreateOrdersRequest,
  IMap,
  OrderBook,
  SerumMarket,
  SerumOpenOrders,
  SerumOrder,
  SerumOrderParams,
} from '../../../../../src/connectors/serum/serum.types';
import { patch } from '../../../../services/patch';
import { default as config } from '../config';
import { convertToSerumOpenOrders, getNewSerumOrders } from '../helpers';
import { default as data } from './data';

const disablePatches = false;

const allowedMarkets = Object.values(config.solana.markets).map(
  (market) => market.name
);

const patches = (solana: Solana, serum: Serum) => {
  const patches = new Map();

  patches.set('solana/loadTokens', () => {
    if (disablePatches) return;

    patch(solana, 'loadTokens', () => {
      return {};
    });
  });

  patches.set('solana/getKeyPair', () => {
    if (disablePatches) return;

    patch(solana, 'getKeypair', (address: string) => {
      if (address === config.solana.wallet.owner.publicKey)
        return Keypair.fromSecretKey(
          bs58.decode(config.solana.wallet.owner.privateKey)
        );

      throw new Error(`Cannot mock unrecognized address "${address}".`);
    });
  });

  patches.set('serum/serumGetMarketsInformation', () => {
    if (disablePatches) return;

    patch(serum, 'serumGetMarketsInformation', () => {
      return data.get('serum/serumGetMarketsInformation');
    });
  });

  patches.set('serum/market/load', () => {
    if (disablePatches) return;

    patch(
      SerumMarket,
      'load',
      (
        _connection: Connection,
        address: PublicKey,
        _options: MarketOptions = {},
        _programId: PublicKey,
        _layoutOverride?: any
      ) => {
        return data.get(`serum/market/${address}`);
      }
    );
  });

  patches.set('serum/market/loadAsks', async (marketName: string) => {
    if (disablePatches) return;

    const market = await serum.getMarket(marketName);

    patch(market.market, 'loadAsks', (_connection: Connection) => {
      return data.get(`serum/market/${market.address}/asks`);
    });
  });

  patches.set('serum/market/loadBids', async (marketName: string) => {
    if (disablePatches) return;

    const market = await serum.getMarket(marketName);

    patch(market.market, 'loadBids', (_connection: Connection) => {
      return data.get(`serum/market/${market.address}/bids`);
    });
  });

  patches.set('serum/market/asksBidsForAllMarkets', async () => {
    if (disablePatches) return;

    for (const marketName of allowedMarkets) {
      await patches.get('serum/market/loadAsks')(marketName);
      await patches.get('serum/market/loadBids')(marketName);
    }
  });

  patches.set(
    'serum/market/loadOrdersForOwner',
    async (candidateOrders?: CreateOrdersRequest[]) => {
      if (disablePatches) return;

      for (const marketName of allowedMarkets) {
        const serumMarket = (await serum.getMarket(marketName)).market;

        patch(
          serumMarket,
          'loadOrdersForOwner',
          (
            _connection: Connection,
            _ownerAddress: PublicKey,
            _cacheDurationMs = 0
          ) => {
            if (!candidateOrders) return [];

            return getNewSerumOrders(
              candidateOrders.filter((item) => item.marketName === marketName)
            );
          }
        );
      }
    }
  );

  patches.set(
    'serum/market/findOpenOrdersAccountsForOwner',
    async (
      startIndex: number,
      orderBooksMap: IMap<string, OrderBook>,
      candidateOrders?: CreateOrdersRequest[]
    ) => {
      if (disablePatches) return;

      const candidateOrdersMap: IMap<string, CreateOrdersRequest[]> = IMap<
        string,
        CreateOrdersRequest[]
      >().asMutable();

      candidateOrders?.map((item) => {
        if (!candidateOrdersMap.has(item.marketName))
          candidateOrdersMap.set(item.marketName, []);

        candidateOrdersMap.get(item.marketName)?.push(item);
      });

      for (const marketName of allowedMarkets) {
        const orderBook = orderBooksMap.get(marketName);
        const serumMarket =
          getNotNullOrThrowError<OrderBook>(orderBook).market.market;
        let serumOpenOrders: SerumOpenOrders[] = [];

        const candidateOrders = candidateOrdersMap.get(marketName) || [];
        serumOpenOrders = convertToSerumOpenOrders(
          startIndex,
          getNotNullOrThrowError<OrderBook>(orderBook),
          candidateOrders
        );

        patch(
          serumMarket,
          'findOpenOrdersAccountsForOwner',
          (
            _connection: Connection,
            _ownerAddress: PublicKey,
            _cacheDurationMs = 0
          ) => {
            return serumOpenOrders;
          }
        );
      }
    }
  );

  patches.set('serum/getTicker', (marketName: string) => {
    if (disablePatches) return;

    patch(serum, 'getTicker', async () => {
      const market = await serum.getMarket(marketName);

      const raw = data.get(`serum/getTicker/${market.address.toString()}`);

      return {
        price: parseFloat(raw.price),
        timestamp: new Date(raw.last_updated).getTime(),
      };
    });
  });

  patches.set('serum/serumMarketLoadFills', () => {
    if (disablePatches) return;

    return patch(
      serum,
      'serumMarketLoadFills',
      (_market: SerumMarket, _connection: Connection, _limit?: number) => {
        return [];
      }
    );
  });

  patches.set('serum/serumMarketPlaceOrders', () => {
    if (disablePatches) return;

    return patch(
      serum,
      'serumMarketPlaceOrders',
      (
        _market: SerumMarket,
        _connection: Connection,
        orders: SerumOrderParams<Account>[]
      ) => {
        const shuffle = (target: string) =>
          [...target].sort(() => Math.random() - 0.5).join('');

        const example =
          'AyZgLRoT78G3KUxPiMTWF84MTQam1eL3bwuWBguufqSBU1JKVcrmGJe6XztLKJ4DfzQ8k1NQsLQnxFT4mB5F9yE0';

        return shuffle(example).repeat(orders.length);
      }
    );
  });

  patches.set('serum/serumMarketCancelOrdersAndSettleFunds', () => {
    if (disablePatches) return;

    return patch(
      serum,
      'serumMarketCancelOrdersAndSettleFunds',
      (
        _market: SerumMarket,
        _connection: Connection,
        _owner: Account,
        orders: SerumOrder[]
      ) => {
        const shuffle = (target: string) =>
          [...target].sort(() => Math.random() - 0.5).join('');

        const example =
          'AyZgLRoT78G3KUxPiMTWF84MTQam1eL3bwuWBguufqSBU1JKVcrmGJe6XztLKJ4DfzQ8k1NQsLQnxFT4mB5F9yE0';

        return {
          cancelation: shuffle(example).repeat(orders.length),
          fundsSettlement: shuffle(example).repeat(orders.length),
        };
      }
    );
  });

  patches.set('serum/serumSettleFunds', () => {
    if (disablePatches) return;

    return patch(serum, 'serumSettleFunds', () => {
      const shuffle = (target: string) =>
        [...target].sort(() => Math.random() - 0.5).join('');

      const example =
        'AyZgLRoT78G3KUxPiMTWF84MTQam1eL3bwuWBguufqSBU1JKVcrmGJe6XztLKJ4DfzQ8k1NQsLQnxFT4mB5F9yE0';

      return shuffle(example);
    });
  });

  patches.set(
    'serum/serumSettleSeveralFunds',
    (
      _market: SerumMarket,
      _connection: Connection,
      settlements: {
        owner: Account;
        openOrders: SerumOpenOrders;
        baseWallet: PublicKey;
        quoteWallet: PublicKey;
        referrerQuoteWallet: PublicKey | null;
      }[],
      _transaction: Transaction = new Transaction()
    ) => {
      if (disablePatches) return;

      return patch(serum, 'serumSettleSeveralFunds', () => {
        const shuffle = (target: string) =>
          [...target].sort(() => Math.random() - 0.5).join('');

        const example =
          'AyZgLRoT78G3KUxPiMTWF84MTQam1eL3bwuWBguufqSBU1JKVcrmGJe6XztLKJ4DfzQ8k1NQsLQnxFT4mB5F9yE0';

        return shuffle(example).repeat(settlements.length);
      });
    }
  );

  patches.set(
    'serum/market/OpenOrders/findForMarketAndOwner',
    (_marketName: string, _ownerAddress: string) => {
      if (disablePatches) return;

      return patch(OpenOrders, 'findForMarketAndOwner', () => {
        throw new Error('Not implemented');
      });
    }
  );

  patches.set(
    'serum/settleFundsForMarket',
    (_marketName: string, _ownerAddress: string) => {
      if (disablePatches) return;

      return patch(serum, 'settleFundsForMarket', () => {
        const shuffle = (target: string) =>
          [...target].sort(() => Math.random() - 0.5).join('');

        const example =
          'AyZgLRoT78G3KUxPiMTWF84MTQam1eL3bwuWBguufqSBU1JKVcrmGJe6XztLKJ4DfzQ8k1NQsLQnxFT4mB5F9yE0';

        return shuffle(example).repeat(1);
      });
    }
  );

  return patches;
};

export default patches;
