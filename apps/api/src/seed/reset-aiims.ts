import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import mongoose from 'mongoose';
import { join } from 'path';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../app.module';
import { SeedService } from './seed.service';
import { BlueprintsService } from '../blueprints/blueprints.service';
import { CommsService } from '../comms/comms.service';
import { Institute } from '../database/institute.schema';
import { User } from '../database/user.schema';
import {
  AcademicSession,
  Course,
  CourseType,
  Department,
  Faculty,
  GeoBucket,
  RoleLabel,
  Speciality,
} from '../database/masters.schema';
import { Blueprint } from '../database/blueprint.schema';
import { DEFAULT_AUTHORITY_SLOTS, InstituteStatus, UserRole, UserStatus } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';

const STAFF_PASSWORD = 'Staff@123';

async function dropDatabase() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ethesis_platform';
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  console.log(`Dropped database at ${uri}`);
  await mongoose.disconnect();
}

async function clearUploads() {
  const dirs = [
    join(process.cwd(), process.env.UPLOAD_DIR || 'uploads'),
    join(process.cwd(), 'apps', 'api', 'uploads'),
    join(process.cwd(), '..', '..', 'uploads'),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    await rm(dir, { recursive: true, force: true });
    console.log(`Cleared uploads: ${dir}`);
  }
}

function asUser(row: { _id: unknown; email: string; name: string; role: string }, instituteId: string): AuthUser {
  return {
    userId: String(row._id),
    email: row.email,
    name: row.name,
    role: row.role,
    instituteId,
  };
}

async function bootstrapAiims(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>) {
  const institutes = app.get<Model<Institute>>(getModelToken(Institute.name));
  const users = app.get<Model<User>>(getModelToken(User.name));
  const courseTypes = app.get<Model<CourseType>>(getModelToken(CourseType.name));
  const courses = app.get<Model<Course>>(getModelToken(Course.name));
  const departments = app.get<Model<Department>>(getModelToken(Department.name));
  const sessions = app.get<Model<AcademicSession>>(getModelToken(AcademicSession.name));
  const buckets = app.get<Model<GeoBucket>>(getModelToken(GeoBucket.name));
  const roleLabels = app.get<Model<RoleLabel>>(getModelToken(RoleLabel.name));
  const faculty = app.get<Model<Faculty>>(getModelToken(Faculty.name));
  const specialities = app.get<Model<Speciality>>(getModelToken(Speciality.name));
  const blueprints = app.get<Model<Blueprint>>(getModelToken(Blueprint.name));
  const blueprintSvc = app.get(BlueprintsService);
  const comms = app.get(CommsService);

  const inst = await institutes.create({
    name: 'All India Institute of Medical Sciences',
    displayName: 'AIIMS New Delhi',
    code: 'AIIMS',
    type: 'MEDICAL',
    country: 'IN',
    primaryColor: '#1e3a5f',
    supportEmail: 'exams@aiims.local',
    timezone: 'Asia/Kolkata',
    dateFormat: 'DD/MM/YYYY',
    status: InstituteStatus.ACTIVE,
    plan: { seats: 200, validFrom: new Date(), featureFlags: [] },
  });
  const iid = inst._id;
  const instituteId = String(iid);
  console.log(`Created institute ${inst.displayName} (${inst.code})`);

  const pgType = await courseTypes.create({ instituteId: iid, name: 'PG', code: 'PG' });
  const phdType = await courseTypes.create({ instituteId: iid, name: 'PhD', code: 'PHD' });

  const adminUser: AuthUser = {
    userId: 'bootstrap',
    email: 'admin@aiims.local',
    name: 'Institute Admin',
    role: UserRole.INSTITUTE_ADMIN,
    instituteId,
  };
  await blueprintSvc.seedDefaults(adminUser);
  const pgBp = await blueprints.findOne({ instituteId: iid, code: 'PG_MEDICAL' });
  const phdBp = await blueprints.findOne({ instituteId: iid, code: 'PHD_MEDICAL' });
  if (!pgBp || !phdBp) throw new Error('PG_MEDICAL / PHD_MEDICAL blueprints were not seeded');
  pgType.blueprintId = pgBp._id;
  phdType.blueprintId = phdBp._id;
  await pgType.save();
  await phdType.save();
  console.log('Bound PG → PG_MEDICAL, PhD → PHD_MEDICAL');

  await roleLabels.insertMany([
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

  await buckets.insertMany([
    { instituteId: iid, code: 'DELHI', label: 'Delhi', courseTypeId: pgType._id },
    { instituteId: iid, code: 'OUTSIDE', label: 'Outside Delhi', courseTypeId: pgType._id },
    { instituteId: iid, code: 'INDIAN', label: 'Indian', courseTypeId: phdType._id },
    { instituteId: iid, code: 'FOREIGN', label: 'Foreign', courseTypeId: phdType._id },
  ]);

  const anatomy = await departments.create({ instituteId: iid, name: 'Anatomy', code: 'ANAT', active: true });
  const now = new Date();
  const session = await sessions.create({
    instituteId: iid,
    month: now.toLocaleString('en-US', { month: 'long' }),
    year: now.getFullYear(),
    current: true,
  });
  const md = await courses.create({
    instituteId: iid,
    courseTypeId: pgType._id,
    departmentId: anatomy._id,
    name: 'MD',
    code: 'MD',
    active: true,
  });
  const phdCourse = await courses.create({
    instituteId: iid,
    courseTypeId: phdType._id,
    departmentId: anatomy._id,
    name: 'Ph.D.',
    code: 'PHD',
    active: true,
  });
  await specialities.insertMany([
    { instituteId: iid, courseId: md._id, name: 'Anatomy' },
    { instituteId: iid, courseId: phdCourse._id, name: 'Anatomy' },
  ]);

  await faculty.insertMany([
    {
      instituteId: iid,
      name: 'Dr. A. Sharma',
      email: 'cg.anatomy@aiims.local',
      designation: 'Professor',
      departmentId: anatomy._id,
      courseIds: [md._id, phdCourse._id],
      canGuide: true,
    },
    {
      instituteId: iid,
      name: 'Dr. B. Verma',
      email: 'coguide.anatomy@aiims.local',
      designation: 'Additional Professor',
      departmentId: anatomy._id,
      courseIds: [md._id, phdCourse._id],
      canGuide: true,
    },
  ]);

  const passwordHash = await bcrypt.hash(STAFF_PASSWORD, 10);
  const staff: {
    email: string;
    name: string;
    role: string;
    authoritySlot?: string;
    departmentIds?: Types.ObjectId[];
    courseIds?: Types.ObjectId[];
  }[] = [
    { email: 'admin@aiims.local', name: 'Institute Admin', role: UserRole.INSTITUTE_ADMIN },
    { email: 'dealing@aiims.local', name: 'Dealing Assistant', role: UserRole.DEALING },
    { email: 'ace@aiims.local', name: 'Assistant Controller of Exams', role: UserRole.AUTHORITY, authoritySlot: 'ACE' },
    { email: 'ao@aiims.local', name: 'Administrative Officer', role: UserRole.AUTHORITY, authoritySlot: 'AO' },
    { email: 'dean@aiims.local', name: 'Associate Dean', role: UserRole.AUTHORITY, authoritySlot: 'ASSOC_DEAN' },
    {
      email: 'anatomy@aiims.local',
      name: 'Anatomy Department',
      role: UserRole.COURSE,
      departmentIds: [anatomy._id],
      courseIds: [md._id, phdCourse._id],
    },
  ];
  const createdStaff: Array<{ _id: unknown; email: string; name: string; role: string }> = [];
  for (const row of staff) {
    createdStaff.push(
      await users.create({
        email: row.email,
        passwordHash,
        name: row.name,
        role: row.role,
        instituteId: iid,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
        authoritySlot: row.authoritySlot,
        departmentIds: row.departmentIds || [],
        courseIds: row.courseIds || [],
      }),
    );
  }

  const dealing = createdStaff.find((u) => u.role === UserRole.DEALING)!;
  await comms.seedDefaults(asUser(dealing, instituteId), 'EMAIL');
  await comms.seedDefaults(asUser(dealing, instituteId), 'LETTER');

  console.log('');
  console.log('AIIMS New Delhi is ready. Session:', `${session.month} ${session.year}`);
  console.log('Courses: MD (PG), Ph.D. (PhD) · Department: Anatomy');
  console.log('');
  console.log('Logins (institute staff password: Staff@123)');
  console.log('  Super Admin     superadmin@ethesis.local   Admin@123');
  for (const row of staff) {
    const extra = row.authoritySlot ? `  [${row.authoritySlot}]` : row.role === UserRole.COURSE ? '  [MD, Ph.D.]' : '';
    console.log(`  ${row.email.padEnd(26)} ${row.role}${extra}`);
  }
}

async function run() {
  await dropDatabase();
  await clearUploads();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  await app.get(SeedService).ensureSuperAdmin();
  await bootstrapAiims(app);
  await app.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
