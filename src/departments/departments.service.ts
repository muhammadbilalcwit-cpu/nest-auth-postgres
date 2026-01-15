import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Departments } from '../entities/entities/Departments';
import { Companies } from '../entities/entities/Companies';

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Departments)
    private repo: Repository<Departments>,
    @InjectRepository(Companies)
    private companiesRepo: Repository<Companies>,
  ) {}

  async create(data: Partial<Departments> & { companyId?: number }) {
    // create a single entity instance then assign
    const dept = this.repo.create();
    Object.assign(dept, data as Partial<Departments>);

    if (data.companyId) {
      const comp = await this.companiesRepo.findOne({
        where: { id: data.companyId },
      });
      if (!comp) throw new NotFoundException('Company not found');
      // set relation correctly
      dept.company = comp;
    }

    return this.repo.save(dept);
  }

  findAll() {
    return this.repo.find({ relations: ['company'] });
  }

  findOne(id: number) {
    return this.repo.findOne({ where: { id }, relations: ['company'] });
  }

  update(id: number, data: Partial<Departments>) {
    return this.repo.update(id, data);
  }

  delete(id: number) {
    return this.repo.delete(id);
  }
}
