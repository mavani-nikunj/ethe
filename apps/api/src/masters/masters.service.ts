import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import {
  Department,
  CourseType,
  Course,
  Speciality,
  AcademicSession,
  GeoBucket,
  RoleLabel,
  Faculty,
  ExaminerPool,
  ExamType,
} from '../database/masters.schema';
import { User } from '../database/user.schema';
import { Blueprint } from '../database/blueprint.schema';
import { UserRole, UserStatus, DEFAULT_AUTHORITY_SLOTS, canonicalUserRole, isCourseRole, isValidEmail, isValidMobile, cleanMobile } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { CommsService } from '../comms/comms.service';
import { SystemMail } from '../comms/catalog/system-defaults';
import { normalizeAuthoritySlot } from '../common/authority-slot';
import { asObjectIds, inMappedCourse } from '../common/course-scope';
import { loginUrl } from '../common/web-origin';

const SESSION_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

@Injectable()
export class MastersService {
  constructor(
    @InjectModel(Department.name) private departments: Model<Department>,
    @InjectModel(CourseType.name) private courseTypes: Model<CourseType>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
    @InjectModel(GeoBucket.name) private buckets: Model<GeoBucket>,
    @InjectModel(RoleLabel.name) private roleLabels: Model<RoleLabel>,
    @InjectModel(Faculty.name) private faculty: Model<Faculty>,
    @InjectModel(ExaminerPool.name) private examiners: Model<ExaminerPool>,
    @InjectModel(ExamType.name) private examTypes: Model<ExamType>,
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(Blueprint.name) private blueprints: Model<Blueprint>,
    private comms: CommsService,
  ) {}

  iid(user: AuthUser) {
    if (!user.instituteId) throw new BadRequestException('No institute');
    return new Types.ObjectId(user.instituteId);
  }

  private parseSession(body: Record<string, unknown>) {
    const month = String(body.month || '').trim();
    const year = Number(body.year);
    if (!SESSION_MONTHS.includes(month)) throw new BadRequestException('Select a valid session month');
    if (!Number.isFinite(year) || year < 1990 || year > 2100) throw new BadRequestException('Select a valid session year');
    return { month, year };
  }

  async currentSession(user: AuthUser) {
    const iid = this.iid(user);
    const row = await this.sessions.findOne({ instituteId: iid, current: true }).sort({ updatedAt: -1 }).lean();
    if (!row) return null;
    return { _id: row._id, month: row.month, year: row.year, current: true };
  }

  async activateSession(user: AuthUser, body: Record<string, unknown>) {
    const iid = this.iid(user);
    const { month, year } = this.parseSession(body);
    let row = await this.sessions.findOne({ instituteId: iid, month, year });
    if (!row) {
      row = await this.sessions.create({ instituteId: iid, month, year, current: false });
    }
    await this.sessions.updateMany({ instituteId: iid, _id: { $ne: row._id } }, { $set: { current: false } });
    row.current = true;
    await row.save();
    return { _id: row._id, month: row.month, year: row.year, current: true };
  }

  async overview(user: AuthUser) {
    const iid = this.iid(user);
    const [departments, courseTypes, courses, sessions, staff, faculty, examiners] = await Promise.all([
      this.departments.countDocuments({ instituteId: iid }),
      this.courseTypes.countDocuments({ instituteId: iid }),
      this.courses.countDocuments({ instituteId: iid }),
      this.sessions.countDocuments({ instituteId: iid }),
      this.users.countDocuments({ instituteId: iid }),
      this.faculty.countDocuments({ instituteId: iid }),
      this.examiners.countDocuments({ instituteId: iid }),
    ]);
    return { departments, courseTypes, courses, sessions, staff, faculty, examiners };
  }

  async list(model: Model<any>, user: AuthUser, extra: Record<string, unknown> = {}) {
    const filter: Record<string, unknown> = { instituteId: this.iid(user), ...extra };
    if (model.modelName === 'RoleLabel') {
      await this.normalizeRoleLabels(this.iid(user));
      filter.$nor = [{ systemRole: 'DEPARTMENT' }, { code: 'DEPARTMENT' }];
    }
    if (user.role === UserRole.COURSE) {
      const mapped = asObjectIds(user.courseIds);
      if (model.modelName === 'Course') {
        filter._id = { $in: mapped };
      } else if (model.modelName === 'Speciality') {
        filter.courseId = { $in: mapped };
      } else if (model.modelName === 'Faculty') {
        const mappedCourses = mapped.length
          ? await this.courses.find({ _id: { $in: mapped }, instituteId: this.iid(user) }).select('departmentId').lean()
          : [];
        const deptIds = mappedCourses.map((c) => c.departmentId).filter(Boolean);
        filter.$or = [{ courseIds: { $in: mapped } }, ...(deptIds.length ? [{ departmentId: { $in: deptIds } }] : [])];
      }
    }
    if (model.modelName === 'ExamType') {
      const count = await model.countDocuments(filter);
      if (count === 0) {
        const defaults = ['Supplementary', 'Compartmental', 'Regular', 'Regular/Supplementary'];
        await model.insertMany(defaults.map((name) => ({ name, instituteId: this.iid(user) })));
      }
    }
    const rows = await model.find(filter).sort({ name: 1, year: -1, createdAt: -1 }).lean();
    return this.enrichList(model.modelName, user, rows);
  }

  private async enrichList(modelName: string, user: AuthUser, rows: any[]) {
    const iid = this.iid(user);
    if (modelName === 'CourseType') {
      const [courses, bps] = await Promise.all([
        this.courses.find({ instituteId: iid }).select('courseTypeId').lean(),
        this.blueprints.find({ _id: { $in: rows.map((r) => r.blueprintId).filter(Boolean) } }).select('name').lean(),
      ]);
      const counts = new Map<string, number>();
      for (const c of courses) {
        const k = String(c.courseTypeId || '');
        if (k) counts.set(k, (counts.get(k) || 0) + 1);
      }
      const bpMap = new Map(bps.map((b) => [String(b._id), b.name]));
      return rows.map((r) => ({
        ...r,
        courseCount: counts.get(String(r._id)) || 0,
        blueprintName: bpMap.get(String(r.blueprintId || '')) || '',
      }));
    }
    if (modelName === 'GeoBucket') {
      const types = await this.courseTypes.find({ instituteId: iid }).select('name code').lean();
      const map = new Map(types.map((t) => [String(t._id), t.name]));
      const byCode = new Map(types.map((t) => [String(t.code || '').toUpperCase(), t.name]));
      const byName = new Map(types.map((t) => [String(t.name || '').toUpperCase(), t.name]));
      return rows.map((r) => ({
        ...r,
        courseTypeName:
          map.get(String(r.courseTypeId || '')) ||
          byCode.get(String(r.group || '').toUpperCase()) ||
          byName.get(String(r.group || '').toUpperCase()) ||
          r.group ||
          '',
      }));
    }
    if (modelName === 'Course') {
      const [types, depts] = await Promise.all([
        this.courseTypes.find({ instituteId: iid }).select('name').lean(),
        this.departments.find({ instituteId: iid }).select('name').lean(),
      ]);
      const typeMap = new Map(types.map((t) => [String(t._id), t.name]));
      const deptMap = new Map(depts.map((d) => [String(d._id), d.name]));
      return rows.map((r) => ({
        ...r,
        courseTypeName: typeMap.get(String(r.courseTypeId || '')) || '',
        departmentName: deptMap.get(String(r.departmentId || '')) || '',
      }));
    }
    if (modelName === 'Speciality') {
      const courses = await this.courses.find({ instituteId: iid }).select('name courseTypeId').lean();
      const types = await this.courseTypes.find({ instituteId: iid }).select('name').lean();
      const typeMap = new Map(types.map((t) => [String(t._id), t.name]));
      const courseMap = new Map(
        courses.map((c) => [
          String(c._id),
          { name: c.name, courseTypeId: c.courseTypeId, courseTypeName: typeMap.get(String(c.courseTypeId || '')) || '' },
        ]),
      );
      return rows.map((r) => {
        const c = courseMap.get(String(r.courseId || ''));
        return { ...r, courseName: c?.name || '', courseTypeId: c?.courseTypeId, courseTypeName: c?.courseTypeName || '' };
      });
    }
    return rows;
  }

  private async normalizeMasterBody(
    model: Model<any>,
    user: AuthUser,
    body: Record<string, unknown>,
    opts: { requireCourseType?: boolean } = {},
  ) {
    const iid = this.iid(user);
    if (model.modelName === 'CourseType') {
      delete body.blueprintId;
    }
    if (model.modelName === 'Course') {
      delete body.blueprintId;
      if (opts.requireCourseType || body.courseTypeId) {
        if (!body.courseTypeId) throw new BadRequestException('Course type is required');
        const type = await this.courseTypes.findOne({ _id: body.courseTypeId, instituteId: iid });
        if (!type) throw new NotFoundException('Course type not found');
        body.courseTypeId = type._id;
      }
      if (body.departmentId) {
        const dept = await this.departments.findOne({ _id: body.departmentId, instituteId: iid });
        if (!dept) throw new NotFoundException('Department not found');
        body.departmentId = dept._id;
      } else if (opts.requireCourseType) {
        throw new BadRequestException('Department is required');
      }
    }
    if (model.modelName === 'GeoBucket') {
      if (opts.requireCourseType || body.courseTypeId) {
        if (!body.courseTypeId) throw new BadRequestException('Course type is required');
        const type = await this.courseTypes.findOne({ _id: body.courseTypeId, instituteId: iid });
        if (!type) throw new NotFoundException('Course type not found');
        body.courseTypeId = type._id;
        body.group = type.name;
      }
    }
    if (model.modelName === 'Speciality') {
      if (opts.requireCourseType || body.courseId) {
        if (!body.courseId) throw new BadRequestException('Course is required');
        const course = await this.courses.findOne({ _id: body.courseId, instituteId: iid });
        if (!course) throw new NotFoundException('Course not found');
        body.courseId = course._id;
      }
    }
    if (model.modelName === 'Faculty' || model.modelName === 'ExaminerPool') {
      if (body.email !== undefined) {
        const email = String(body.email || '').trim().toLowerCase();
        if (opts.requireCourseType && !email) throw new BadRequestException('Email is required');
        if (email && !isValidEmail(email)) throw new BadRequestException('Invalid email address format');
        body.email = email;
      }
      if (body.mobile !== undefined && String(body.mobile).trim() !== '') {
        const mob = cleanMobile(body.mobile);
        if (!isValidMobile(mob)) {
          throw new BadRequestException('Mobile must be a valid 10-digit Indian number starting with 6-9');
        }
        body.mobile = mob;
      }
      if (model.modelName === 'Faculty') {
        const courseIds = Array.isArray(body.courseIds) ? body.courseIds : body.courseId ? [body.courseId] : [];
        if (courseIds.length) {
          const ids = courseIds.map((id) => String(id)).filter((id) => Types.ObjectId.isValid(id));
          const courses = await this.courses.find({ _id: { $in: ids }, instituteId: iid }).select('_id').lean();
          body.courseIds = courses.map((c) => c._id);
        }
        delete body.courseId;
      }
    }
    return body;
  }

  async create(model: Model<any>, user: AuthUser, body: Record<string, unknown>) {
    if (user.role === UserRole.COURSE) {
      const allowed = new Set(['Faculty', 'AcademicSession', 'Course', 'Speciality']);
      if (!allowed.has(model.modelName)) {
        throw new BadRequestException('Academic login can add sessions, courses, specialities and faculty only');
      }
      if (model.modelName === 'Faculty' || model.modelName === 'Course') {
        const deptId = body.departmentId || user.departmentIds?.[0];
        if (model.modelName === 'Faculty' && !deptId) throw new BadRequestException('Department is required for a guide');
        if (deptId) body.departmentId = new Types.ObjectId(String(deptId));
      }
      if (model.modelName === 'Speciality' && body.courseId && !inMappedCourse(user, body.courseId)) {
        throw new BadRequestException('You can only add a speciality for your mapped course');
      }
    } else if (user.role === UserRole.DEALING) {
      if (model.modelName !== 'ExamType') {
        throw new BadRequestException('Dealing assistant can only manage exam types');
      }
    } else if (body.departmentId) {
      body.departmentId = new Types.ObjectId(String(body.departmentId));
    }
    await this.normalizeMasterBody(model, user, body, { requireCourseType: true });
    if (model.modelName === 'RoleLabel') {
      const code = String(body.code || '').trim().toUpperCase();
      const systemRole = canonicalUserRole(String(body.systemRole || ''));
      if (code === 'DEPARTMENT' || systemRole === 'DEPARTMENT') {
        throw new BadRequestException('Department is not a login role. Use Academic for course logins.');
      }
      if (systemRole === UserRole.COURSE) {
        body.systemRole = UserRole.COURSE;
        body.code = body.code || 'COURSE';
        body.label = body.label || 'Academic';
      }
    }
    const iid = this.iid(user);
    if (model.modelName === 'AcademicSession') {
      const { month, year } = this.parseSession(body);
      body.month = month;
      body.year = year;
      delete body.current;
      const exists = await this.sessions.findOne({ instituteId: iid, month, year }).select('_id').lean();
      if (exists) throw new ConflictException('A session for this month and year already exists');
      const count = await this.sessions.countDocuments({ instituteId: iid });
      body.current = count === 0;
    }
    const created = await model.create({ ...body, instituteId: iid });
    if (user.role === UserRole.COURSE && model.modelName === 'Course') {
      const patch: Record<string, unknown> = { $addToSet: { courseIds: created._id } };
      if (created.departmentId) {
        (patch.$addToSet as Record<string, unknown>).departmentIds = created.departmentId;
      }
      await this.users.updateOne({ _id: user.userId }, patch);
    }
    return created;
  }

  async update(model: Model<any>, user: AuthUser, id: string, body: Record<string, unknown>) {
    if (user.role === UserRole.DEALING && model.modelName !== 'ExamType') {
      throw new BadRequestException('Dealing assistant can only manage exam types');
    }
    await this.normalizeMasterBody(model, user, body);
    if (model.modelName === 'AcademicSession') {
      if (body.month !== undefined || body.year !== undefined) {
        const existing = await this.sessions.findOne({ _id: id, instituteId: this.iid(user) }).lean();
        if (!existing) throw new NotFoundException('Record not found');
        const { month, year } = this.parseSession({
          month: body.month ?? existing.month,
          year: body.year ?? existing.year,
        });
        body.month = month;
        body.year = year;
        const clash = await this.sessions.findOne({
          instituteId: this.iid(user),
          month,
          year,
          _id: { $ne: existing._id },
        }).select('_id').lean();
        if (clash) throw new ConflictException('A session for this month and year already exists');
      }
      delete body.current;
    }
    const row = await model.findOneAndUpdate(
      { _id: id, instituteId: this.iid(user) },
      { $set: body },
      { new: true },
    );
    if (!row) throw new NotFoundException('Record not found');
    return row;
  }

  async remove(model: Model<any>, user: AuthUser, id: string) {
    if (user.role === UserRole.COURSE) {
      if (model.modelName !== 'Faculty') throw new BadRequestException('Academic login can only remove faculty / guides');
    }
    if (user.role === UserRole.DEALING) {
      if (model.modelName !== 'ExamType') throw new BadRequestException('Dealing assistant can only remove exam types');
    }
    const filter: Record<string, unknown> = { _id: id, instituteId: this.iid(user) };
    if (user.role === UserRole.COURSE && model.modelName === 'Faculty') {
      const mapped = asObjectIds(user.courseIds);
      const mappedCourses = mapped.length
        ? await this.courses.find({ _id: { $in: mapped }, instituteId: this.iid(user) }).select('departmentId').lean()
        : [];
      const deptIds = mappedCourses.map((c) => c.departmentId).filter(Boolean);
      filter.$or = [{ courseIds: { $in: mapped } }, ...(deptIds.length ? [{ departmentId: { $in: deptIds } }] : [])];
    }
    const row = await model.findOneAndDelete(filter);
    if (!row) throw new NotFoundException('Record not found');
    return { ok: true };
  }

  models() {
    return {
      departments: this.departments,
      'course-types': this.courseTypes,
      courses: this.courses,
      specialities: this.specialities,
      sessions: this.sessions,
      'geo-buckets': this.buckets,
      'role-labels': this.roleLabels,
      faculty: this.faculty,
      examiners: this.examiners,
      'exam-types': this.examTypes,
    } as Record<string, Model<any>>;
  }

  async staff(user: AuthUser) {
    return this.users
      .find({ instituteId: this.iid(user), role: { $nin: [UserRole.SUPER_ADMIN] } })
      .select('-passwordHash')
      .sort({ name: 1 })
      .lean();
  }

  private async mappingForStaff(iid: Types.ObjectId, body: any, role: string) {
    if (role === UserRole.ACADEMIC || role === UserRole.TRAVEL) {
      return { courseIds: [] as Types.ObjectId[], departmentIds: [] as Types.ObjectId[] };
    }
    const courseIds = asObjectIds(body.courseIds);
    const departmentIds = asObjectIds(body.departmentIds);
    if (isCourseRole(role)) {
      if (!courseIds.length) throw new BadRequestException('Map the login to at least one course');
      const courses = await this.courses.find({ _id: { $in: courseIds }, instituteId: iid }).select('_id departmentId').lean();
      if (courses.length !== courseIds.length) throw new BadRequestException('One or more courses were not found');
      const fromCourses = [
        ...new Set(courses.map((c) => String(c.departmentId || '')).filter((id) => Types.ObjectId.isValid(id))),
      ].map((id) => new Types.ObjectId(id));
      return { courseIds: courses.map((c) => c._id), departmentIds: departmentIds.length ? departmentIds : fromCourses };
    }
    return { courseIds, departmentIds };
  }

  async createStaff(user: AuthUser, body: any) {
    const email = String(body.email || '').toLowerCase().trim();
    if (!email || !body.name || !body.role) throw new BadRequestException('Name, email and role required');
    if (!isValidEmail(email)) throw new BadRequestException('Invalid email address format');
    let mobile: string | undefined = undefined;
    if (body.mobile && String(body.mobile).trim() !== '') {
      const mob = cleanMobile(body.mobile);
      if (!isValidMobile(mob)) {
        throw new BadRequestException('Mobile must be a valid 10-digit Indian number starting with 6-9');
      }
      mobile = mob;
    }
    body.role = canonicalUserRole(body.role);
    if (body.role === UserRole.SUPER_ADMIN) throw new BadRequestException('Cannot create platform user');
    if (user.role === UserRole.ACADEMIC && body.role !== UserRole.COURSE) {
      throw new BadRequestException('Academic section can only create course logins');
    }
    const mapping = await this.mappingForStaff(this.iid(user), body, body.role);
    const exists = await this.users.findOne({ email });
    if (exists) throw new ConflictException('Email already in use');
    const password = body.password || 'Welcome@123';
    const created = await this.users.create({
      email,
      name: body.name,
      mobile,
      designation: body.designation,
      role: body.role,
      authoritySlot: body.role === UserRole.AUTHORITY ? normalizeAuthoritySlot(body.authoritySlot) : undefined,
      departmentIds: mapping.departmentIds,
      courseIds: mapping.courseIds,
      instituteId: this.iid(user),
      passwordHash: await bcrypt.hash(password, 10),
      status: UserStatus.INVITED,
      mustChangePassword: true,
      tempPassword: password,
    });
    if (body.role === UserRole.COURSE) {
      await this.sendDepartmentInvite(created.instituteId, created.email, created.name, password);
    }
    return { user: { ...created.toObject(), passwordHash: undefined }, tempPassword: password };
  }

  async departmentUsers(user: AuthUser) {
    return this.users
      .find({ instituteId: this.iid(user), role: { $in: [UserRole.COURSE, 'DEPARTMENT'] } })
      .select('-passwordHash')
      .sort({ name: 1 })
      .lean();
  }

  async inviteDepartmentUser(user: AuthUser, id: string) {
    const row = await this.users.findOne({ _id: id, instituteId: this.iid(user), role: { $in: [UserRole.COURSE, 'DEPARTMENT'] } });
    if (!row) throw new NotFoundException('Academic login not found');
    const password = 'Welcome@123';
    row.passwordHash = await bcrypt.hash(password, 10);
    row.mustChangePassword = true;
    row.status = UserStatus.INVITED;
    row.tempPassword = password;
    await row.save();
    await this.sendDepartmentInvite(row.instituteId, row.email, row.name, password);
    return { ok: true, email: row.email, tempPassword: password };
  }

  async resetStaffPassword(user: AuthUser, id: string) {
    const row = await this.users.findOne({ _id: id, instituteId: this.iid(user) });
    if (!row) throw new NotFoundException('User not found');
    if (row.role === UserRole.SUPER_ADMIN) throw new BadRequestException('Cannot reset platform user');
    if (user.role === UserRole.ACADEMIC && row.role !== UserRole.COURSE) {
      throw new BadRequestException('Academic section can only reset course logins');
    }
    const password = 'Welcome@123';
    row.passwordHash = await bcrypt.hash(password, 10);
    row.mustChangePassword = true;
    row.status = UserStatus.INVITED;
    row.tempPassword = password;
    await row.save();
    return { ok: true, email: row.email, tempPassword: password };
  }

  private async sendDepartmentInvite(instituteId: unknown, email: string, name: string, password: string) {
    await this.comms.sendSystemMail(
      String(instituteId),
      SystemMail.COURSE_LOGIN,
      email,
      { name: name || 'User', email, password, loginUrl: loginUrl() },
      name,
    );
  }

  async updateStaff(user: AuthUser, id: string, body: any) {
    const existing = await this.users.findOne({ _id: id, instituteId: this.iid(user) });
    if (!existing) throw new NotFoundException('User not found');
    if (existing.role === UserRole.SUPER_ADMIN) throw new BadRequestException('Cannot update platform user');
    if (user.role === UserRole.ACADEMIC && existing.role !== UserRole.COURSE) {
      throw new BadRequestException('Academic section can only update course logins');
    }
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'email', 'mobile', 'designation', 'role', 'authoritySlot', 'status']) {
      if (body[k] !== undefined) patch[k] = k === 'email' ? String(body[k]).toLowerCase().trim() : body[k];
    }
    if (patch.email !== undefined) {
      if (!patch.email || !isValidEmail(patch.email as string)) {
        throw new BadRequestException('Invalid email address format');
      }
    }
    if (patch.mobile !== undefined && String(patch.mobile).trim() !== '') {
      const mob = cleanMobile(patch.mobile);
      if (!isValidMobile(mob)) {
        throw new BadRequestException('Mobile must be a valid 10-digit Indian number starting with 6-9');
      }
      patch.mobile = mob;
    } else if (patch.mobile !== undefined) {
      patch.mobile = '';
    }
    if (patch.authoritySlot !== undefined) {
      patch.authoritySlot = normalizeAuthoritySlot(String(patch.authoritySlot || ''));
    }
    const nextRole = canonicalUserRole((patch.role as string) || existing.role);
    if (patch.role !== undefined) patch.role = nextRole;
    if (nextRole !== UserRole.AUTHORITY) patch.authoritySlot = '';
    if (user.role === UserRole.ACADEMIC && patch.role && patch.role !== UserRole.COURSE) {
      throw new BadRequestException('Academic section can only keep course logins');
    }
    if (patch.email) {
      const clash = await this.users.findOne({
        email: patch.email,
        _id: { $ne: existing._id },
      });
      if (clash) throw new ConflictException('Email already in use');
    }
    if (nextRole === UserRole.COURSE || nextRole === UserRole.ACADEMIC || nextRole === UserRole.TRAVEL) {
      const mapping = await this.mappingForStaff(this.iid(user), {
        courseIds: body.courseIds ?? existing.courseIds,
        departmentIds: body.departmentIds,
      }, nextRole);
      patch.courseIds = mapping.courseIds;
      patch.departmentIds = mapping.departmentIds;
    } else {
      if (body.departmentIds) patch.departmentIds = asObjectIds(body.departmentIds);
      if (body.courseIds) patch.courseIds = asObjectIds(body.courseIds);
    }
    const row = await this.users
      .findOneAndUpdate({ _id: id, instituteId: this.iid(user) }, { $set: patch }, { new: true })
      .select('-passwordHash');
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  async removeStaff(user: AuthUser, id: string) {
    const row = await this.users.findOne({ _id: id, instituteId: this.iid(user) });
    if (!row) throw new NotFoundException('User not found');
    if (row.role === UserRole.SUPER_ADMIN) throw new BadRequestException('Cannot delete platform user');
    if (String(row._id) === user.userId) throw new BadRequestException('You cannot delete your own login');
    if (user.role === UserRole.ACADEMIC && row.role !== UserRole.COURSE) {
      throw new BadRequestException('Academic section can only delete course logins');
    }
    await this.users.deleteOne({ _id: row._id });
    return { ok: true };
  }

  private async normalizeRoleLabels(iid: Types.ObjectId) {
    await this.roleLabels.deleteMany({
      instituteId: iid,
      $or: [{ systemRole: 'DEPARTMENT' }, { code: 'DEPARTMENT' }],
    });
  }

  async ensureDefaults(user: AuthUser) {
    const iid = this.iid(user);
    const count = await this.roleLabels.countDocuments({ instituteId: iid, systemRole: { $nin: ['DEPARTMENT'] } });
    if (count === 0) {
      await this.roleLabels.insertMany([
        { instituteId: iid, systemRole: UserRole.ACADEMIC, code: 'ACADEMIC', label: 'Academic Section' },
        { instituteId: iid, systemRole: UserRole.COURSE, code: 'COURSE', label: 'Academic' },
        { instituteId: iid, systemRole: UserRole.DEALING, code: 'DEALING', label: 'Dealing Desk' },
        { instituteId: iid, systemRole: UserRole.INSTITUTE_ADMIN, code: 'ADMIN', label: 'College Admin' },
        ...DEFAULT_AUTHORITY_SLOTS.map((s) => ({
          instituteId: iid,
          systemRole: UserRole.AUTHORITY,
          code: s.code,
          label: s.label,
        })),
      ]);
    }
    const buckets = await this.buckets.countDocuments({ instituteId: iid });
    if (buckets === 0) {
      const types = await this.courseTypes.find({ instituteId: iid }).select('name code').lean();
      const match = (hint: string) =>
        types.find((t) => String(t.code || '').toUpperCase() === hint || String(t.name || '').toUpperCase().includes(hint));
      const pg = match('PG');
      const phd = match('PHD');
      await this.buckets.insertMany([
        { instituteId: iid, code: 'DELHI', label: 'Delhi', courseTypeId: pg?._id, group: pg?.name || 'PG' },
        { instituteId: iid, code: 'OUTSIDE', label: 'Outside Delhi', courseTypeId: pg?._id, group: pg?.name || 'PG' },
        { instituteId: iid, code: 'INDIAN', label: 'Indian', courseTypeId: phd?._id, group: phd?.name || 'PHD' },
        { instituteId: iid, code: 'FOREIGN', label: 'Foreign', courseTypeId: phd?._id, group: phd?.name || 'PHD' },
      ]);
    }
    await this.normalizeRoleLabels(iid);
    return { ok: true };
  }
}
