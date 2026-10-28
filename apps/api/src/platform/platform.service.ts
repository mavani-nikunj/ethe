import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { Institute } from '../database/institute.schema';
import { User } from '../database/user.schema';
import { AuditLog } from '../database/audit-log.schema';
import { InstituteStatus, UserRole, UserStatus, isValidEmail, isValidMobile, cleanMobile } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';

function tempPassword() {
  return 'Temp@' + Math.random().toString(36).slice(2, 8) + '9';
}

@Injectable()
export class PlatformService {
  constructor(
    @InjectModel(Institute.name) private institutes: Model<Institute>,
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(AuditLog.name) private audit: Model<AuditLog>,
  ) {}

  async dashboard() {
    const [total, active, suspended, draft] = await Promise.all([
      this.institutes.countDocuments(),
      this.institutes.countDocuments({ status: InstituteStatus.ACTIVE }),
      this.institutes.countDocuments({ status: InstituteStatus.SUSPENDED }),
      this.institutes.countDocuments({ status: InstituteStatus.DRAFT }),
    ]);
    return { total, active, suspended, draft };
  }

  async list(q?: string, status?: string) {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (q) {
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { displayName: new RegExp(q, 'i') },
        { code: new RegExp(q, 'i') },
      ];
    }
    const rows = await this.institutes.find(filter).sort({ createdAt: -1 }).lean();
    const withAdmins = await Promise.all(
      rows.map(async (row) => {
        const admin = await this.users.findOne({
          instituteId: row._id,
          role: UserRole.INSTITUTE_ADMIN,
        });
        return {
          ...row,
          id: row._id.toString(),
          adminEmail: admin?.email,
          adminName: admin?.name,
        };
      }),
    );
    return withAdmins;
  }

  async get(id: string) {
    const inst = await this.institutes.findById(id).lean();
    if (!inst) throw new NotFoundException('Institute not found');
    const admin = await this.users.findOne({
      instituteId: inst._id,
      role: UserRole.INSTITUTE_ADMIN,
    });
    const logs = await this.audit.find({ instituteId: inst._id }).sort({ createdAt: -1 }).limit(30).lean();
    return {
      ...inst,
      id: inst._id.toString(),
      admin: admin
        ? {
            id: admin._id.toString(),
            email: admin.email,
            name: admin.name,
            status: admin.status,
            mobile: admin.mobile,
            designation: admin.designation,
          }
        : null,
      audit: logs,
    };
  }

  async create(actor: AuthUser, body: Record<string, any>) {
    const code = String(body.code || '').trim().toUpperCase();
    if (!code || !body.name) throw new BadRequestException('Name and code are required');
    const exists = await this.institutes.findOne({ code });
    if (exists) throw new ConflictException('Institute code already exists');
    const inst = await this.institutes.create({
      name: body.name,
      displayName: body.displayName || body.name,
      code,
      type: body.type || 'COLLEGE',
      country: body.country || 'IN',
      logoUrl: body.logoUrl,
      primaryColor: body.primaryColor || '#0061f2',
      supportEmail: body.supportEmail,
      timezone: body.timezone || 'Asia/Kolkata',
      dateFormat: body.dateFormat || 'DD/MM/YYYY',
      status: InstituteStatus.ACTIVE,
      plan: {
        seats: Number(body.seats || 50),
        validFrom: body.validFrom ? new Date(body.validFrom) : new Date(),
        validTo: body.validTo ? new Date(body.validTo) : undefined,
        featureFlags: body.featureFlags || [],
      },
      createdBy: new Types.ObjectId(actor.userId),
    });
    let invite: { email: string; tempPassword: string } | null = null;
    if (body.adminEmail) {
      invite = await this.inviteAdmin(actor, inst._id.toString(), {
        email: body.adminEmail,
        name: body.adminName || 'College Admin',
        mobile: body.adminMobile,
        designation: body.adminDesignation,
      });
    }
    return { institute: { ...inst.toObject(), id: inst._id.toString() }, invite };
  }

  async update(actor: AuthUser, id: string, body: Record<string, any>) {
    const inst = await this.institutes.findById(id);
    if (!inst) throw new NotFoundException('Institute not found');
    const allowed = [
      'name',
      'displayName',
      'type',
      'country',
      'logoUrl',
      'primaryColor',
      'supportEmail',
      'timezone',
      'dateFormat',
    ];
    for (const k of allowed) if (body[k] !== undefined) (inst as any)[k] = body[k];
    if (body.supportEmail !== undefined && String(body.supportEmail).trim() !== '') {
      const sup = String(body.supportEmail).trim().toLowerCase();
      if (!isValidEmail(sup)) throw new BadRequestException('Invalid support email address');
      inst.supportEmail = sup;
    }
    if (body.seats || body.validFrom || body.validTo) {
      inst.plan = {
        ...inst.plan,
        seats: body.seats ?? inst.plan?.seats,
        validFrom: body.validFrom ? new Date(body.validFrom) : inst.plan?.validFrom,
        validTo: body.validTo ? new Date(body.validTo) : inst.plan?.validTo,
      };
    }
    await inst.save();
    return inst;
  }

  async setStatus(actor: AuthUser, id: string, status: string) {
    if (!['ACTIVE', 'SUSPENDED', 'DRAFT'].includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    const inst = await this.institutes.findByIdAndUpdate(id, { status }, { new: true });
    if (!inst) throw new NotFoundException('Institute not found');
    return inst;
  }

  async inviteAdmin(
    actor: AuthUser,
    instituteId: string,
    body: { email: string; name: string; mobile?: string; designation?: string },
  ) {
    const email = body.email.toLowerCase().trim();
    if (!isValidEmail(email)) throw new BadRequestException('Invalid admin email address');
    let mobile: string | undefined = undefined;
    if (body.mobile && String(body.mobile).trim() !== '') {
      const mob = cleanMobile(body.mobile);
      if (!isValidMobile(mob)) {
        throw new BadRequestException('Admin mobile must be a valid 10-digit Indian number starting with 6-9');
      }
      mobile = mob;
    }
    const existing = await this.users.findOne({ email });
    if (existing && String(existing.instituteId) !== instituteId) {
      throw new ConflictException('Email already used in another institute');
    }
    const password = tempPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    if (existing) {
      existing.passwordHash = passwordHash;
      existing.name = body.name;
      existing.mobile = mobile;
      existing.designation = body.designation;
      existing.mustChangePassword = true;
      existing.status = UserStatus.INVITED;
      existing.role = UserRole.INSTITUTE_ADMIN;
      existing.tempPassword = password;
      await existing.save();
    } else {
      await this.users.create({
        email,
        passwordHash,
        name: body.name,
        mobile,
        designation: body.designation,
        role: UserRole.INSTITUTE_ADMIN,
        instituteId: new Types.ObjectId(instituteId),
        status: UserStatus.INVITED,
        mustChangePassword: true,
        tempPassword: password,
      });
    }
    return { email, tempPassword: password };
  }

  async setLogo(actor: AuthUser, id: string, logoUrl: string) {
    const inst = await this.institutes.findById(id);
    if (!inst) throw new NotFoundException('Institute not found');
    inst.logoUrl = logoUrl;
    await inst.save();
    return inst;
  }

  async auditLogs(q?: string) {
    const filter: Record<string, unknown> = {};
    if (q) filter.action = new RegExp(q, 'i');
    return this.audit.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }
}
