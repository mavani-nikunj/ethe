import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User } from '../database/user.schema';
import { UserRole, UserStatus } from '@ethesis/shared';

@Injectable()
export class SeedService implements OnModuleInit {
  private log = new Logger('Seed');

  constructor(@InjectModel(User.name) private users: Model<User>) {}

  onModuleInit() {
    return this.ensureSuperAdmin().then(() => this.migrateCourseRole());
  }

  async migrateCourseRole() {
    const res = await this.users.updateMany({ role: 'DEPARTMENT' }, { $set: { role: UserRole.COURSE } });
    if (res.modifiedCount) this.log.log(`Migrated ${res.modifiedCount} DEPARTMENT logins to COURSE`);
  }

  async ensureSuperAdmin() {
    const email = (process.env.SUPERADMIN_EMAIL || 'superadmin@ethesis.local').toLowerCase();
    const password = process.env.SUPERADMIN_PASSWORD || 'Admin@123';
    const existing = await this.users.findOne({ email });
    if (existing) {
      this.log.log(`Super Admin ready: ${email}`);
      return;
    }
    await this.users.create({
      email,
      passwordHash: await bcrypt.hash(password, 10),
      name: 'Platform Super Admin',
      role: UserRole.SUPER_ADMIN,
      instituteId: null,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
    });
    this.log.log(`Seeded Super Admin ${email}`);
  }
}
