import { config } from 'dotenv';

// Load environment variables
config();

export default [
  {
    name: 'default',
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
    synchronize: false,
    entities: ['entities/*.js'],
  },
];
