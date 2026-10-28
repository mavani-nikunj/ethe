import { BadRequestException } from '@nestjs/common';
import { text } from './supervisor-access';

/** Bank details for remuneration, same checks as the practical acceptance. */
export function bankFieldsChecked(body: Record<string, unknown>) {
  const bank = {
    holderName: text(body.holderName, 160),
    bankName: text(body.bankName, 160),
    branch: text(body.branch, 250),
    ifsc: text(body.ifsc, 20).toUpperCase(),
    accountType: text(body.accountType, 20),
    account: text(body.account, 40).replace(/\s/g, ''),
  };
  if (!bank.holderName) throw new BadRequestException('Please Enter Name of Examiner (as provided in Bank)');
  if (!bank.bankName) throw new BadRequestException('Please Enter Bank Name');
  if (!bank.branch) throw new BadRequestException('Please Enter Branch Name with Bank Address');
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifsc)) throw new BadRequestException('IFSC code is not valid (e.g. SBIN0001234)');
  if (!['Saving', 'Current'].includes(bank.accountType)) throw new BadRequestException('Please Select Account Type');
  if (!/^\d{6,20}$/.test(bank.account)) throw new BadRequestException('Account number must be 6 to 20 digits');
  return bank;
}

