import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Blueprint } from '../database/blueprint.schema';
import { Course, CourseType } from '../database/masters.schema';
import { AuthUser } from '../common/current-user';
import { canonicalUserRole, UserRole } from '@ethesis/shared';
import { pgTemplatePayload, phdTemplatePayload } from './templates';

@Injectable()
export class BlueprintsService implements OnModuleInit {
  constructor(
    @InjectModel(Blueprint.name) private blueprints: Model<Blueprint>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(CourseType.name) private courseTypes: Model<CourseType>,
  ) {}

  async onModuleInit() {
    await this.blueprints.updateMany(
      { 'stages.actorRole': 'DEPARTMENT' },
      { $set: { 'stages.$[s].actorRole': UserRole.COURSE } },
      { arrayFilters: [{ 's.actorRole': 'DEPARTMENT' }] },
    );
  }

  iid(user: AuthUser) {
    if (!user.instituteId) throw new BadRequestException('No institute');
    return new Types.ObjectId(user.instituteId);
  }

  private async migrateCourseBindings(iid: Types.ObjectId) {
    const stale = await this.courses.collection
      .find({ instituteId: iid, blueprintId: { $exists: true, $ne: null } })
      .toArray();
    for (const c of stale) {
      if (c.courseTypeId && c.blueprintId) {
        await this.courseTypes.updateOne(
          { _id: c.courseTypeId, instituteId: iid, blueprintId: { $exists: false } },
          { $set: { blueprintId: c.blueprintId } },
        );
      }
      await this.courses.updateOne({ _id: c._id }, { $unset: { blueprintId: 1 } });
    }
  }

  async list(user: AuthUser) {
    const iid = this.iid(user);
    await this.migrateCourseBindings(iid);
    const rows = await this.blueprints.find({ instituteId: iid }).sort({ name: 1 }).lean();
    const types = await this.courseTypes.find({ instituteId: iid }).select('name blueprintId').lean();
    return rows.map((row) => ({
      ...row,
      boundCourseTypes: types.filter((t) => String(t.blueprintId) === String(row._id)).map((t) => t.name),
    }));
  }

  async get(user: AuthUser, id: string) {
    const iid = this.iid(user);
    await this.migrateCourseBindings(iid);
    const row = await this.blueprints.findOne({ _id: id, instituteId: iid }).lean();
    if (!row) throw new NotFoundException('Blueprint not found');
    const bound = await this.courseTypes.find({ instituteId: iid, blueprintId: id }).select('name').lean();
    return { ...row, boundCourseTypes: bound.map((t) => t.name) };
  }

  async create(user: AuthUser, body: Record<string, unknown>) {
    const stages = this.validateStages((body.stages as any[]) || defaultStarterStages());
    const code = String(body.code || body.name || 'CUSTOM')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const exists = await this.blueprints.findOne({ instituteId: this.iid(user), code });
    if (exists) throw new BadRequestException(`Blueprint code ${code} already exists`);
    return this.blueprints.create({
      name: body.name || 'Custom programme',
      code,
      description: body.description || '',
      stages,
      guidePolicy: body.guidePolicy || { maxCoGuides: 0, minCoGuides: 0 },
      panelRule: body.panelRule || { buckets: [] },
      revisionOwnerRole: body.revisionOwnerRole || 'DEALING',
      flags: body.flags || {},
      instituteId: this.iid(user),
      isSystemSeed: false,
    });
  }

  async update(user: AuthUser, id: string, body: Record<string, unknown>) {
    if (body.stages) body.stages = this.validateStages(body.stages as any[]);
    if (body.code) {
      const code = String(body.code).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
      body.code = code;
      const clash = await this.blueprints.findOne({
        instituteId: this.iid(user),
        code,
        _id: { $ne: id },
      });
      if (clash) throw new BadRequestException(`Blueprint code ${code} already exists`);
    }
    const row = await this.blueprints.findOneAndUpdate(
      { _id: id, instituteId: this.iid(user) },
      { $set: body },
      { new: true },
    );
    if (!row) throw new NotFoundException('Blueprint not found');
    return row;
  }

  async remove(user: AuthUser, id: string) {
    const used = await this.courseTypes.countDocuments({ instituteId: this.iid(user), blueprintId: id });
    if (used) throw new BadRequestException('Unbind this blueprint from all course types before deleting it');
    const row = await this.blueprints.findOneAndDelete({ _id: id, instituteId: this.iid(user) });
    if (!row) throw new NotFoundException('Blueprint not found');
    return { ok: true };
  }

  async clone(user: AuthUser, id: string) {
    const src = await this.blueprints.findOne({ _id: id, instituteId: this.iid(user) }).lean();
    if (!src) throw new NotFoundException('Blueprint not found');
    const code = `${src.code || 'CUSTOM'}_COPY`.slice(0, 40);
    let unique = code;
    let n = 2;
    while (await this.blueprints.findOne({ instituteId: this.iid(user), code: unique })) {
      unique = `${code}${n}`;
      n += 1;
    }
    return this.blueprints.create({
      name: `Copy of ${src.name}`,
      code: unique,
      description: src.description,
      stages: src.stages,
      guidePolicy: src.guidePolicy,
      panelRule: src.panelRule,
      revisionOwnerRole: src.revisionOwnerRole,
      flags: src.flags,
      instituteId: this.iid(user),
      isSystemSeed: false,
    });
  }

  private validateStages(stages: any[]) {
    if (!Array.isArray(stages) || !stages.length) throw new BadRequestException('Add at least one stage');
    const codes = stages.map((s) => String(s.code || '').trim());
    if (codes.some((c) => !c)) throw new BadRequestException('Every stage needs a code');
    if (new Set(codes).size !== codes.length) throw new BadRequestException('Stage codes must be unique');
    return stages.map((s) => {
      for (const key of ['next', 'nextOnReject', 'nextOnHold'] as const) {
        if (s[key] && !codes.includes(String(s[key]))) {
          throw new BadRequestException(`Stage ${s.code} ${key} points to unknown stage ${s[key]}`);
        }
      }
      return {
        code: String(s.code).trim(),
        name: String(s.name || s.code).trim(),
        type: String(s.type || 'APPROVE'),
        actorRole: canonicalUserRole(s.actorRole || 'DEALING') || 'DEALING',
        authoritySlot: s.authoritySlot || undefined,
        next: s.next || undefined,
        nextOnHold: s.nextOnHold || undefined,
        nextOnReject: s.nextOnReject || undefined,
        waitAccepted: s.waitAccepted ? Number(s.waitAccepted) : undefined,
        nthBucketCode: s.nthBucketCode || undefined,
        evaluationRound: s.evaluationRound ? Number(s.evaluationRound) : undefined,
        letterKind: s.letterKind || undefined,
      };
    });
  }

  async seedDefaults(user: AuthUser) {
    const iid = this.iid(user);
    const updated: string[] = [];
    for (const payload of [pgTemplatePayload(), phdTemplatePayload()]) {
      const row = await this.blueprints.findOneAndUpdate(
        { instituteId: iid, code: payload.code },
        { $set: { ...payload, instituteId: iid, isSystemSeed: true } },
        { upsert: true, new: true },
      );
      if (row) updated.push(payload.code);
    }
    return { updated, total: await this.blueprints.countDocuments({ instituteId: iid }) };
  }

  async bindCourseType(user: AuthUser, courseTypeId: string, blueprintId: string) {
    const iid = this.iid(user);
    const bp = await this.blueprints.findOne({ _id: blueprintId, instituteId: iid });
    if (!bp) throw new NotFoundException('Blueprint not found');
    const type = await this.courseTypes.findOneAndUpdate(
      { _id: courseTypeId, instituteId: iid },
      { $set: { blueprintId: bp._id } },
      { new: true },
    );
    if (!type) throw new NotFoundException('Course type not found');
    return type;
  }

  async unbindCourseType(user: AuthUser, courseTypeId: string) {
    const type = await this.courseTypes.findOneAndUpdate(
      { _id: courseTypeId, instituteId: this.iid(user) },
      { $unset: { blueprintId: 1 } },
      { new: true },
    );
    if (!type) throw new NotFoundException('Course type not found');
    return type;
  }
}

function defaultStarterStages() {
  return [
    { code: 'initiate', name: 'Course initiation', type: 'INITIATE', actorRole: 'COURSE', next: 'ace_review' },
    {
      code: 'ace_review',
      name: 'ACE review',
      type: 'APPROVE',
      actorRole: 'AUTHORITY',
      authoritySlot: 'ACE',
      next: 'close',
    },
    { code: 'close', name: 'Close file', type: 'CLOSE', actorRole: 'DEALING' },
  ];
}
