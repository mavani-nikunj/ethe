/**
 * Letterhead block for mail templates, matching the current AIIMS e-STEMM mails (TA1_Offer_letter.html style):
 * orange institute title; Associate Dean name / email · logo · Examination Section address;
 * then File No (grey box) · CONFIDENTIAL · "New Delhi" + date.
 *
 * It is plain HTML inside each template body, so the mail master can edit or remove it per template.
 * The comment markers let "Insert letterhead" replace an existing block instead of adding a second one.
 * Placeholders: {{adName}}, {{adEmail}}, {{logoUrl}}, {{instituteName}}, {{fileNo}}, {{date}}.
 */
export const LETTERHEAD_START = '<!--letterhead:start-->';
export const LETTERHEAD_END = '<!--letterhead:end-->';
/** AIIMS logo shown in the letterhead (served from apps/web/public). */
export const LETTERHEAD_LOGO_SRC = '/aiims-logo.png';

const ORANGE = '#da600e';
const TEAL = '#0e8c83';
const FONT = 'Arial,Helvetica,sans-serif';

export const LETTERHEAD_HTML = `${LETTERHEAD_START}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${FONT};margin:0 0 14px 0">
<tr><td style="text-align:center;padding:4px 0 10px 0;font-family:${FONT};font-size:20px;font-weight:900;line-height:1.3;color:${ORANGE}">ALL INDIA INSTITUTE OF MEDICAL SCIENCES, NEW DELHI</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${FONT}">
<tr>
<td width="40%" style="vertical-align:middle;color:${TEAL};font-size:13px;font-weight:bold;line-height:1.6">{{adName}}<br>Email: <a href="mailto:{{adEmail}}" style="color:#1a0dab">{{adEmail}}</a></td>
<td width="20%" style="vertical-align:middle;text-align:center"><img src="{{logoUrl}}" alt="{{instituteName}}" height="75" style="height:75px;width:auto;border:0"></td>
<td width="40%" style="vertical-align:middle;text-align:right;color:${TEAL};font-size:13px;line-height:1.35"><b style="font-size:15px">Examination Section</b><br>First Floor, Convergence Block<br>Ansari Nagar, New Delhi - 110608<br>Tel: 011- 26594202</td>
</tr>
</table>
</td></tr>
<tr><td style="padding-top:14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${FONT}">
<tr>
<td width="37%" style="vertical-align:middle"><div style="border:1px solid #bdbdbd;background:#f3f3f3;color:#000;font-weight:bold;font-size:13px;padding:6px 8px">{{fileNo}}</div></td>
<td style="vertical-align:middle;padding-left:36px"><div style="display:inline-block;width:150px;text-align:center;background:${TEAL};color:#fff;font-weight:bold;font-size:13px;padding:6px 0">CONFIDENTIAL</div></td>
<td style="vertical-align:middle;text-align:right;color:#000;font-size:13px;line-height:1.3">New Delhi<br>{{date}}</td>
</tr>
</table>
</td></tr>
</table>${LETTERHEAD_END}`;

const LETTERHEAD_RE = /<!--letterhead:start-->[\s\S]*?<!--letterhead:end-->\s*/g;
const LETTERHEAD_BLOCK_RE = /<!--letterhead:start-->[\s\S]*?<!--letterhead:end-->/g;
/** Logo link from the old e-Thesis site (https://ethesis.aiimsexams.edu.in/AIIMSLogo.png), found in imported templates. */
const LEGACY_LOGO_RE = /(?:https?:)?\/\/[^\s"'<>()]*?\/AIIMSLogo\.png/gi;

/**
 * Point every letterhead logo at the AIIMS logo: the old site's AIIMSLogo.png link, and logo images
 * inside a letterhead block that were saved with an empty src.
 */
export function withLetterheadLogo(html: string, src: string = LETTERHEAD_LOGO_SRC) {
  return String(html || '')
    .replace(LEGACY_LOGO_RE, src)
    .replace(LETTERHEAD_BLOCK_RE, (block) => block.replace(/(<img\b[^>]*?\bsrc=)(["'])\s*\2/gi, `$1$2${src}$2`));
}

export function hasLetterhead(body: string) {
  return String(body || '').includes(LETTERHEAD_START);
}

export function stripLetterhead(body: string) {
  return String(body || '').replace(LETTERHEAD_RE, '');
}

/** Put the standard letterhead at the top of an HTML body, replacing any letterhead already there. */
export function withLetterhead(html: string) {
  return `${LETTERHEAD_HTML}\n${stripLetterhead(html)}`;
}

/** Plain-text template → HTML paragraphs; a {{taskLink}} becomes a clickable link. */
export function textToHtml(text: string) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((para) => {
      const safe = para.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<p>${safe.replace(/\{\{taskLink\}\}/g, '<a href="{{taskLink}}">{{taskLink}}</a>').replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}
