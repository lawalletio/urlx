import { createClient, RedisClientType } from 'redis';
import { logger, requiredEnvVar } from '@lib/utils';
import { Debugger } from 'debug';

const log: Debugger = logger.extend('services:redis');
const warn: Debugger = log.extend('warn');
const error: Debugger = log.extend('error');

/**
 * Thin wrapper for redis client.
 *
 * Centralizes the connection handling but makes available the client
 * directly.
 */
class RedisService {
  client: RedisClientType;

  constructor() {
    log('Initializing redis service');
    this.client = createClient({ url: requiredEnvVar('REDIS_URI') });
    this.connect();
  }

  private async connect() {
    this.client.on('connect', () => log('Connecting to redis'));
    this.client.on('ready', () => log('Connected to redis'));
    this.client.on('end', () => {
      warn('Redis ended connection');
      this.connect();
    });
    this.client.on('error', (e) => {
      error('Redis error: %O', e);
      throw e;
    });
    await this.client.connect();
    log('Redis service initializated');
  }
}

const redis = new RedisService();

export default redis.client;
