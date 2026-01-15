import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../entities/entities/Roles';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Roles)
    private repo: Repository<Roles>,
  ) {}

  findAll() {
    return this.repo.find();
  }

  findAllSlugs(): Promise<string[]> {
    console.log(
      'Fetching all role slugs',
      this.repo.find().then((roles) => roles.map((r) => r.slug)),
    );
    return this.repo.find().then((roles) => roles.map((r) => r.slug));
  }

  // Case-insensitive slug lookup so DB values like 'SUPER_ADMIN' also match 'super_admin'
  async findBySlug(slug: string) {
    if (!slug) return null;
    const normalized = slug.toString().toLowerCase().trim();
    return this.repo
      .createQueryBuilder('r')
      .where('LOWER(r.slug) = :slug', { slug: normalized })
      .getOne();
  }
}
