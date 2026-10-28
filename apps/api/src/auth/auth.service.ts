import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from '../database/user.schema';
import { Institute } from '../database/institute.schema';
import { Course } from '../database/masters.schema';
import { UserRole, UserStatus, InstituteStatus, canonicalUserRole } from '@ethesis/shared';
import { runWithAuditActor } from '../common/audit-context';
import { resolveMappedCourseIds } from '../common/course-scope';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(Institute.name) private institutes: Model<Institute>,
    @InjectModel(Course.name) private courses: Model<Course>,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findOne({ email: email.toLowerCase().trim() });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.status === UserStatus.DISABLED) throw new UnauthorizedException('Account disabled');

    let institute: Institute | null = null;
    if (user.role !== UserRole.SUPER_ADMIN) {
      if (!user.instituteId) throw new UnauthorizedException('No institute mapped');
      institute = await this.institutes.findById(user.instituteId);
      if (!institute) throw new UnauthorizedException('Institute not found');
      if (institute.status === InstituteStatus.SUSPENDED) {
        throw new UnauthorizedException('Institute is suspended');
      }
    }

    user.lastLoginAt = new Date();
    await runWithAuditActor(
      {
        userId: user._id.toString(),
        email: user.email,
        name: user.name,
        instituteId: user.instituteId ? user.instituteId.toString() : null,
      },
      () => user.save(),
    );

    const token = await this.jwt.signAsync({ sub: user._id.toString() });
    return {
      accessToken: token,
      mustChangePassword: user.mustChangePassword,
      user: await this.publicUser(user, institute),
    };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    const institute = user.instituteId ? await this.institutes.findById(user.instituteId) : null;
    return this.publicUser(user, institute);
  }

  async setPassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    if (newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.mustChangePassword = false;
    user.status = UserStatus.ACTIVE;
    user.set('tempPassword', undefined);
    await user.save();
    await this.users.updateOne({ _id: user._id }, { $unset: { tempPassword: 1 } });
    return { ok: true };
  }

  async publicUser(user: User & { _id: { toString(): string } }, institute: Institute | null) {
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: canonicalUserRole(user.role),
      instituteId: user.instituteId ? String(user.instituteId) : null,
      authoritySlot: user.authoritySlot,
      designation: user.designation,
      mobile: user.mobile,
      departmentIds: (user.departmentIds || []).map((id) => String(id)),
      courseIds: await resolveMappedCourseIds(this.courses, user),
      mustChangePassword: user.mustChangePassword,
      institute: institute
        ? {
            id: (institute as any)._id?.toString?.() || String((institute as any).id || ''),
            name: institute.displayName || institute.name,
            code: institute.code,
            logoUrl: institute.logoUrl,
            primaryColor: institute.primaryColor,
            status: institute.status,
          }
        : null,
    };
  }
}
