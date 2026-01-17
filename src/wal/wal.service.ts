import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LogicalReplicationService,
  Wal2JsonPlugin,
} from 'pg-logical-replication';
import type Redis from 'ioredis';

interface Wal2JsonChange {
  kind: 'insert' | 'update' | 'delete';
  schema: string;
  table: string;
  columnnames?: string[];
  columntypes?: string[];
  columnvalues?: unknown[];
  oldkeys?: {
    keynames: string[];
    keytypes: string[];
    keyvalues: unknown[];
  };
}

interface Wal2JsonMessage {
  change: Wal2JsonChange[];
}

@Injectable()
export class WalService implements OnModuleInit, OnModuleDestroy {
  private client: LogicalReplicationService;
  private plugin: Wal2JsonPlugin;
  private isRunning = false;
  private readonly slotName = 'nestjs_redis_sync_slot';

  // Map table names to Redis key prefixes
  private readonly tableKeyMap: Record<string, string> = {
    companies: 'company',
    departments: 'department',
    roles: 'role',
    users: 'user',
  };

  constructor(
    private configService: ConfigService,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    console.log('WAL Service: Initializing...');
    await this.setupReplication();
    this.startListening();
  }

  async onModuleDestroy() {
    console.log('WAL Service: Shutting down...');
    this.isRunning = false;
    if (this.client) {
      this.client.stop();
    }
  }

  private async setupReplication() {
    // Create the logical replication client
    this.client = new LogicalReplicationService({
      host: this.configService.get<string>('DB_HOST', 'localhost'),
      port: this.configService.get<number>('DB_PORT', 5432),
      database: this.configService.get<string>('DB_NAME', 'postgres'),
      user: this.configService.get<string>('DB_USER', 'postgres'),
      password: this.configService.get<string>('DB_PASSWORD', 'root'),
    });

    // Use wal2json plugin for JSON output
    this.plugin = new Wal2JsonPlugin({
      includeTimestamp: true,
      includeSchemas: true,
      includeLsn: true,
    });

    // Handle errors
    this.client.on('error', (err) => {
      console.error('WAL Replication Error:', err);
      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        if (this.isRunning) {
          console.log('WAL Service: Attempting to reconnect...');
          this.startListening();
        }
      }, 5000);
    });

    console.log('WAL Service: Replication client configured');
  }

  private async startListening() {
    this.isRunning = true;

    try {
      console.log(
        `WAL Service: Starting to listen on slot "${this.slotName}"...`,
      );
      console.log(
        'WAL Service: Waiting for database changes (INSERT, UPDATE, DELETE)...',
      );

      // Subscribe to changes
      this.client.subscribe(this.plugin, this.slotName).catch((err) => {
        console.error('WAL Subscribe Error:', err.message);
        // If slot doesn't exist, we need to create it first via SQL
        if (err.message.includes('does not exist')) {
          console.log('');
          console.log('='.repeat(60));
          console.log(
            'IMPORTANT: You need to create the replication slot first!',
          );
          console.log('Run this SQL command in PostgreSQL:');
          console.log('');
          console.log(
            `  SELECT pg_create_logical_replication_slot('${this.slotName}', 'wal2json');`,
          );
          console.log('');
          console.log('Also ensure postgresql.conf has:');
          console.log('  wal_level = logical');
          console.log('  max_replication_slots = 4');
          console.log('  max_wal_senders = 4');
          console.log('='.repeat(60));
          console.log('');
        }
      });

      // Handle incoming data
      this.client.on('data', async (lsn: string, log: Wal2JsonMessage) => {
        console.log(`WAL Event received at LSN: ${lsn}`);
        await this.processChanges(log);
      });
    } catch (error) {
      console.error('WAL Service: Failed to start listening:', error);
    }
  }

  private async processChanges(log: Wal2JsonMessage) {
    if (!log.change || !Array.isArray(log.change)) {
      return;
    }

    for (const change of log.change) {
      const { kind, table } = change;
      const keyPrefix = this.tableKeyMap[table];

      if (!keyPrefix) {
        console.log(`WAL: Skipping table "${table}" (not configured for sync)`);
        continue;
      }

      console.log(`WAL: Processing ${kind.toUpperCase()} on "${table}"`);

      try {
        switch (kind) {
          case 'insert':
            await this.handleInsert(change, keyPrefix);
            break;
          case 'update':
            await this.handleUpdate(change, keyPrefix);
            break;
          case 'delete':
            await this.handleDelete(change, keyPrefix);
            break;
        }
      } catch (error) {
        console.error(`WAL: Error processing ${kind} on ${table}:`, error);
      }
    }
  }

  private async handleInsert(change: Wal2JsonChange, keyPrefix: string) {
    const data = this.columnsToObject(
      change.columnnames!,
      change.columnvalues!,
    );
    const id = data.id;
    const key = `${keyPrefix}:${id}`;

    await this.redis.setex(key, 3600, JSON.stringify(data));
    console.log(`WAL INSERT: Cached ${key} in Redis`);
  }

  private async handleUpdate(change: Wal2JsonChange, keyPrefix: string) {
    const data = this.columnsToObject(
      change.columnnames!,
      change.columnvalues!,
    );
    const id = data.id;
    const key = `${keyPrefix}:${id}`;

    await this.redis.setex(key, 3600, JSON.stringify(data));
    console.log(`WAL UPDATE: Updated ${key} in Redis`);
  }

  private async handleDelete(change: Wal2JsonChange, keyPrefix: string) {
    // For delete, we get the old key values
    const oldKeys = change.oldkeys;
    if (!oldKeys) {
      console.log('WAL DELETE: No old keys found');
      return;
    }

    const idIndex = oldKeys.keynames.indexOf('id');
    if (idIndex === -1) {
      console.log('WAL DELETE: No id found in old keys');
      return;
    }

    const id = oldKeys.keyvalues[idIndex];
    const key = `${keyPrefix}:${id}`;

    await this.redis.del(key);
    console.log(`WAL DELETE: Removed ${key} from Redis`);
  }

  private columnsToObject(
    columnnames: string[],
    columnvalues: unknown[],
  ): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columnnames.length; i++) {
      // Convert snake_case to camelCase for consistency
      const key = this.snakeToCamel(columnnames[i]);
      obj[key] = columnvalues[i];
    }
    return obj;
  }

  private snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }
}
