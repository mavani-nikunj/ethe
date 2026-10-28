import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { User } from '../database/user.schema';
import { Institute } from '../database/institute.schema';
import { Course } from '../database/masters.schema';
import { AuthUser } from '../common/current-user';
import { resolveMappedCourseIds } from '../common/course-scope';
import { UserRole, UserStatus, canonicalUserRole } from '@ethesis/shared';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(Institute.name) private institutes: Model<Institute>,
    @InjectModel(Course.name) private courses: Model<Course>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET') || 'ethesis-dev-secret-change-me',
    });
  }

  async validate(payload: { sub: string }): Promise<AuthUser | null> {
    const user = await this.users.findById(payload.sub);
    if (!user || user.status === UserStatus.DISABLED) return null;
    if (user.role !== UserRole.SUPER_ADMIN && user.instituteId) {
      const inst = await this.institutes.findById(user.instituteId);
      if (!inst || inst.status === 'SUSPENDED') return null;
    }
    if (user.role === 'DEPARTMENT') {
      user.role = UserRole.COURSE;
      await user.save();
    }
    return {
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      role: canonicalUserRole(user.role),
      instituteId: user.instituteId ? user.instituteId.toString() : null,
      authoritySlot: user.authoritySlot,
      departmentIds: (user.departmentIds || []).map((id) => String(id)),
      courseIds: await resolveMappedCourseIds(this.courses, user),
    };
  }
}
