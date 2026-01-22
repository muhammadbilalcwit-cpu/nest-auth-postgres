import 'reflect-metadata';
import { config } from 'dotenv';
import { createConnection } from 'typeorm';
import { Roles } from '../entities/entities/Roles';
import { Companies } from '../entities/entities/Companies';
import { Departments } from '../entities/entities/Departments';
import { Users } from '../entities/entities/Users';
import * as bcrypt from 'bcrypt';

// Load environment variables
config();

async function run() {
  const conn = await createConnection({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'auth_crud',
    entities: [Roles, Companies, Departments, Users],
    synchronize: false,
  });

  const roleRepo = conn.getRepository(Roles);
  const companyRepo = conn.getRepository(Companies);
  const deptRepo = conn.getRepository(Departments);
  const userRepo = conn.getRepository(Users);

  const slugs = ['super_admin', 'company_admin', 'manager', 'user'];

  for (const slug of slugs) {
    const exist = await roleRepo.findOne({ where: { slug } });
    if (!exist) {
      await roleRepo.save({ slug, name: slug });
      console.log('Inserted role', slug);
    }
  }

  let company = await companyRepo.findOne({ where: { name: 'Seed Company' } });
  if (!company) {
    company = await companyRepo.save({
      name: 'Seed Company',
      address: 'Seed Address',
    });
    console.log('Inserted company');
  }

  let dept = await deptRepo.findOne({ where: { name: 'Seed Dept' } });
  if (!dept) {
    dept = await deptRepo.save({ name: 'Seed Dept', company });
    console.log('Inserted department');
  }

  let admin = await userRepo.findOne({
    where: { email: 'admin@seed.local' },
    relations: ['role'],
  });
  const superAdmin = await roleRepo.findOne({ where: { slug: 'super_admin' } });
  if (!admin) {
    if (!superAdmin) {
      throw new Error('Missing super_admin role in DB. Seed roles first.');
    }
    const pass = await bcrypt.hash('password', 10);
    const adminEntity = userRepo.create({
      email: 'admin@seed.local',
      password: pass,
      firstname: 'Seed',
      lastname: 'Admin',
    } as Partial<Users>);
    adminEntity.role = superAdmin; // assign relation
    // attach admin to department
    adminEntity.department = dept;
    admin = await userRepo.save(adminEntity);
    console.log('Inserted admin user');
  }

  await conn.close();
  console.log('Seeding finished');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
