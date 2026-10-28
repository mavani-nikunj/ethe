import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FileStatus, UserRole, Verdict, isCourseRole } from '@ethesis/shared';
import { asObjectIds } from '../common/course-scope';
import { PanelMember, ThesisFile } from '../database/thesis-file.schema';
import { Blueprint } from '../database/blueprint.schema';
import { Department, Faculty } from '../database/masters.schema';
import { Institute } from '../database/institute.schema';
import { User } from '../database/user.schema';
import { AuthUser } from '../common/current-user';
import { FilesService } from '../files/files.service';
import { CommsService } from '../comms/comms.service';

type Item = { fileId: string; panelIndex: number };

/**
 * Accepted Thesis Evaluation Report (old eSTEMM ThesisEvaluation/ApprovedThesisLetterExaminer): every examiner whose
 * evaluation recommends ACCEPT, with profile + bank details for remuneration, printable reports / cheques and a
 * Mail Master send. Read-only on the workflow; edits go through the normal panel member PATCH.
 */
@Injectable()
export class AcceptedEvaluationsService {
  constructor(
    @InjectModel(ThesisFile.name) private files: Model<ThesisFile>,
    @InjectModel(Blueprint.name) private blueprints: Model<Blueprint>,
    @InjectModel(Faculty.name) private faculty: Model<Faculty>,
    @InjectModel(Department.name) private departments: Model<Department>,
    @InjectModel(Institute.name) private institutes: Model<Institute>,
    @InjectModel(User.name) private users: Model<User>,
    private filesService: FilesService,
    private comms: CommsService,
  ) {}

  private assertCanSend(user: AuthUser) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new ForbiddenException('Only Dealing can send mail to examiners');
    }
  }

  /** Dealing / Authority logins with courses ticked in Staff mapping see only those courses (none ticked = every course). */
  private scope(user: AuthUser) {
    const filter = this.filesService.fileScope(user);
    const mapped = asObjectIds(user.courseIds);
    if (!isCourseRole(user.role) && mapped.length) filter.courseId = { $in: mapped };
    return filter;
  }

  private isAccepted(p: PanelMember) {
    return !p.isPractical && !p.isChiefGuide && p.evaluation?.verdict === Verdict.ACCEPT;
  }

  /**
   * Old app suffixed the thesis no. with A / B by examiner type. Here each examiner who has submitted an evaluation
   * gets the next letter in panel order, so the letter stays the same as more reports come in.
   */
  private suffixes(panel: PanelMember[]) {
    const out = new Map<number, string>();
    let n = 0;
    panel.forEach((p, idx) => {
      if (p.isPractical || p.isChiefGuide || !p.evaluation?.verdict) return;
      out.set(idx, String.fromCharCode(65 + n));
      n++;
    });
    return out;
  }

  /** withReportNames fills missing names with '—'; the old grid left them blank. */
  private name(v?: string) {
    return v && v !== '—' ? v : '';
  }

  private thesisNoValue(no: string) {
    const n = parseInt(String(no || '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  }

  /** Old grid's Department column is the Chief Guide's department; falls back to the thesis department. */
  private async chiefDepartments(rows: any[]) {
    const guideIds = asObjectIds(rows.map((r) => r.chiefGuideId).filter(Boolean));
    const guides = guideIds.length
      ? await this.faculty.find({ _id: { $in: guideIds } }).select('departmentId').lean()
      : [];
    const deptIds = asObjectIds(guides.map((g) => g.departmentId).filter(Boolean));
    const depts = deptIds.length ? await this.departments.find({ _id: { $in: deptIds } }).select('name').lean() : [];
    const deptName = new Map(depts.map((d) => [String(d._id), d.name]));
    const byGuide = new Map(guides.map((g) => [String(g._id), deptName.get(String(g.departmentId || '')) || '']));
    return (row: any) => byGuide.get(String(row.chiefGuideId || '')) || this.name(row.departmentName);
  }

  async list(
    user: AuthUser,
    q: { month?: string; year?: string; session?: string; courseId?: string; specialityId?: string; dealingId?: string },
  ) {
    const filter: Record<string, unknown> = {
      ...this.scope(user),
      status: { $ne: FileStatus.DRAFT },
      panel: { $elemMatch: { 'evaluation.verdict': Verdict.ACCEPT } },
    };
    const and: Record<string, unknown>[] = [];
    if (q.courseId && Types.ObjectId.isValid(q.courseId)) and.push({ courseId: new Types.ObjectId(q.courseId) });
    if (q.specialityId && Types.ObjectId.isValid(q.specialityId)) {
      and.push({ specialityId: new Types.ObjectId(q.specialityId) });
    }
    // Dealing filter: only courses mapped to that Dealing login (old UserCourses join).
    if (q.dealingId && Types.ObjectId.isValid(q.dealingId) && user.role !== UserRole.DEALING) {
      const dealing = await this.users
        .findOne({ _id: new Types.ObjectId(q.dealingId), instituteId: new Types.ObjectId(user.instituteId as string) })
        .select('courseIds')
        .lean();
      const ids = asObjectIds((dealing as any)?.courseIds);
      if (ids.length) and.push({ courseId: { $in: ids } });
    }
    if (and.length) filter.$and = and;

    const rows = await this.files
      .find(await this.filesService.withSessionFilter(user, filter, q.month, q.year, q.session))
      .lean();
    const named = await this.filesService.withReportNames(rows);
    const chiefDept = await this.chiefDepartments(named);
    const bpIds = asObjectIds(named.map((r) => r.blueprintId));
    const bps = bpIds.length ? await this.blueprints.find({ _id: { $in: bpIds } }).select('panelRule flags').lean() : [];
    const bpById = new Map(bps.map((b) => [String(b._id), b]));

    const items: any[] = [];
    for (const file of named) {
      const bp = bpById.get(String(file.blueprintId));
      const buckets = new Map((bp?.panelRule?.buckets || []).map((b) => [b.code, b.label]));
      const amount = bp?.flags?.remunerationAmount;
      const suffix = this.suffixes(file.panel || []);
      (file.panel || []).forEach((p: PanelMember, idx: number) => {
        if (!this.isAccepted(p)) return;
        const bank = p.bank || {};
        items.push({
          id: `${file._id}:${idx}`,
          fileId: String(file._id),
          panelIndex: idx,
          thesisNumber: file.thesisNumber ? `${file.thesisNumber}${suffix.get(idx) || ''}` : '',
          sortNo: this.thesisNoValue(file.thesisNumber || ''),
          courseName: this.name(file.courseName),
          specialityName: this.name(file.specialityName),
          candidateName: file.candidate?.name || '',
          enrollmentNo: file.candidate?.enrollmentNo || '',
          examinerName: p.name || '',
          designation: p.designation || '',
          department: chiefDept(file),
          institute: p.affiliation || '',
          address: p.address || '',
          mobile: p.mobile || '',
          email: p.email || '',
          examinerType: buckets.get(p.bucketCode) || p.bucketCode || '',
          holderName: bank.holderName || '',
          bankName: bank.bankName || '',
          branchAddress: bank.branchAddress || '',
          accountNo: bank.account || '',
          ifsc: bank.ifsc || '',
          accountType: bank.accountType || '',
          pan: bank.pan || '',
          chequePath: bank.cancelledChequePath || '',
          remuneration: amount != null ? String(amount) : '',
          // Edit modal only: the examiner's own department (the grid column shows the Chief Guide's).
          examinerDepartment: p.department || '',
          alternateMobile: p.alternateMobile || '',
          alternateEmail: p.alternateEmail || '',
        });
      });
    }
    // Old order: numeric thesis no., then course, speciality, enrollment no., examiner letter.
    items.sort(
      (a, b) =>
        a.sortNo - b.sortNo ||
        a.courseName.localeCompare(b.courseName) ||
        a.specialityName.localeCompare(b.specialityName) ||
        a.enrollmentNo.localeCompare(b.enrollmentNo) ||
        a.thesisNumber.localeCompare(b.thesisNumber),
    );
    return { items };
  }

  private cleanItems(rawItems: Item[]) {
    const seen = new Set<string>();
    const list = (Array.isArray(rawItems) ? rawItems : []).filter((it) => {
      const key = `${it?.fileId}:${it?.panelIndex}`;
      if (!it?.fileId || !Types.ObjectId.isValid(String(it.fileId)) || !Number.isInteger(Number(it.panelIndex))) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!list.length) throw new BadRequestException('Please select at least 1 examiner');
    return list;
  }

  /** Everything the three print views need (evaluation report, report with examiner details, cancelled cheque). */
  async print(user: AuthUser, rawItems: Item[]) {
    const list = this.cleanItems(rawItems);
    if (list.length > 300) throw new BadRequestException('Print at most 300 examiners at a time');
    const fileIds = [...new Set(list.map((it) => String(it.fileId)))].map((id) => new Types.ObjectId(id));
    const rows = await this.files.find({ ...this.scope(user), _id: { $in: fileIds } }).lean();
    const named = await this.filesService.withReportNames(rows);
    const byId = new Map(named.map((f) => [String(f._id), f]));
    const chiefDept = await this.chiefDepartments(named);
    const inst = await this.institutes.findById(user.instituteId).select('name displayName logoUrl').lean();
    const docs: any[] = [];
    for (const it of list) {
      const file = byId.get(String(it.fileId));
      const p: PanelMember | undefined = file?.panel?.[Number(it.panelIndex)];
      if (!file || !p || !this.isAccepted(p)) continue;
      const suffix = this.suffixes(file.panel || []).get(Number(it.panelIndex)) || '';
      docs.push({
        id: `${file._id}:${it.panelIndex}`,
        meta: {
          candidateName: file.candidate?.name || '',
          title: file.title || '',
          fileNo: file.fileNo || '',
          thesisNumber: file.thesisNumber ? `${file.thesisNumber}${suffix}` : '',
          courseName: this.name(file.courseName),
          courseTypeName: this.name(file.courseTypeName),
          specialityName: this.name(file.specialityName),
        },
        examiner: {
          examinerId: p.email || '',
          name: p.name || '',
          designation: p.designation || '',
          department: chiefDept(file),
          institute: p.affiliation || '',
          address: p.address || '',
        },
        evaluation: p.evaluation || null,
        chequePath: p.bank?.cancelledChequePath || '',
      });
    }
    return { instituteName: inst?.displayName || inst?.name || '', logoUrl: inst?.logoUrl || '', docs };
  }

  /** Old "Send SMS and Email": mails the chosen Mail Master template to each ticked examiner (the old SMS was disabled). */
  async sendMail(user: AuthUser, templateId: string, rawItems: Item[]) {
    this.assertCanSend(user);
    if (!templateId || !Types.ObjectId.isValid(String(templateId))) throw new BadRequestException('Please select Mail Title');
    const list = this.cleanItems(rawItems);
    if (list.length > 100) throw new BadRequestException('Send at most 100 mails at a time');
    const sent: { id: string; name: string; email: string }[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const it of list) {
      const id = `${it.fileId}:${it.panelIndex}`;
      try {
        const file = await this.files.findOne({ ...this.scope(user), _id: new Types.ObjectId(String(it.fileId)) }).lean();
        if (!file) throw new BadRequestException('File not found');
        const index = Number(it.panelIndex);
        const member = file.panel?.[index];
        if (!member || !this.isAccepted(member)) throw new BadRequestException('Examiner has not accepted the thesis');
        const bp = await this.blueprints.findById(file.blueprintId).select('flags').lean();
        const suffix = this.suffixes(file.panel || []).get(index) || '';
        await this.comms.sendTemplateToExaminer(user, String(templateId), file as any, member, {
          designation: member.designation || '',
          examinerInstitute: member.affiliation || '',
          examinerAddress: member.address || '',
          feeAmount: bp?.flags?.remunerationAmount != null ? String(bp.flags.remunerationAmount) : '',
          thesisNumber: file.thesisNumber ? `${file.thesisNumber}${suffix}` : '',
        });
        sent.push({ id, name: member.name, email: member.email });
      } catch (err: any) {
        failed.push({ id, message: err?.message || 'Could not send mail' });
      }
    }
    return {
      sent,
      failed,
      message: `Mail sent to ${sent.length} examiner(s)${failed.length ? `, ${failed.length} failed` : ''}.`,
    };
  }
}
