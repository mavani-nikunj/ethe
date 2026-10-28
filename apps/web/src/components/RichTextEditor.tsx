import { useEffect, useRef, useState, type ReactNode } from 'react';
import { withLetterheadLogo } from '@ethesis/shared';

function looksLikeHtml(s: string) {
  return /<\/?(?:p|div|br|span|b|i|u|strong|em|ul|ol|li|h[1-6]|table|a|font|blockquote|hr|img)[\s>/]/i.test(s || '');
}

export function toEditorHtml(body: string) {
  const t = body || '';
  if (!t) return '';
  if (looksLikeHtml(t)) return t;
  return t
    .split(/\n/)
    .map((line) => {
      const safe = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div>${safe || '<br>'}</div>`;
    })
    .join('');
}

const PH_SRC = 'data-ph-src';

/** Show placeholder image sources (src="{{logoUrl}}") as real images while editing. */
function withPreviewImages(html: string, imageVars?: Record<string, string>) {
  // The old site's AIIMSLogo.png link shows as the AIIMS logo; data-ph-src keeps the saved link unchanged.
  const out = html.replace(/src=(["'])([^"']*\/AIIMSLogo\.png)\1/gi, (m, q, src) =>
    `src=${q}${withLetterheadLogo(src)}${q} ${PH_SRC}=${q}${src}${q}`,
  );
  if (!imageVars) return out;
  return out.replace(/\bsrc=(["'])\{\{(\w+)\}\}\1/g, (m, q, key) =>
    imageVars[key] ? `src=${q}${imageVars[key]}${q} ${PH_SRC}=${q}{{${key}}}${q}` : m,
  );
}

/** Undo withPreviewImages so the saved body keeps the placeholder. */
function withoutPreviewImages(html: string) {
  if (!html.includes(PH_SRC)) return html;
  const box = document.createElement('div');
  box.innerHTML = html;
  box.querySelectorAll<HTMLImageElement>(`img[${PH_SRC}]`).forEach((img) => {
    img.setAttribute('src', img.getAttribute(PH_SRC) || '');
    img.removeAttribute(PH_SRC);
  });
  return box.innerHTML;
}

export function htmlHasText(html: string) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length > 0;
}

function ToolBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`rte-btn${active ? ' on' : ''}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholders,
  imageVars,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholders?: string[];
  /** Placeholder → URL for images shown in the editor only, e.g. { logoUrl: '/api/uploads/logo.png' }. */
  imageVars?: Record<string, string>;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState(false);
  const [sourceText, setSourceText] = useState('');

  useEffect(() => {
    if (areaRef.current) areaRef.current.innerHTML = withPreviewImages(toEditorHtml(value), imageVars);
  }, []);

  function emitFromArea() {
    onChange(withoutPreviewImages(areaRef.current?.innerHTML || ''));
  }

  function run(command: string, arg?: string) {
    areaRef.current?.focus();
    document.execCommand(command, false, arg);
    emitFromArea();
  }

  function toggleSource() {
    if (source) {
      if (areaRef.current) areaRef.current.innerHTML = withPreviewImages(sourceText, imageVars);
      onChange(sourceText);
      setSource(false);
    } else {
      const html = withoutPreviewImages(areaRef.current?.innerHTML || value || '');
      setSourceText(html);
      setSource(true);
    }
  }

  function insertPlaceholder(token: string) {
    if (source) {
      const next = sourceText + token;
      setSourceText(next);
      onChange(next);
      return;
    }
    areaRef.current?.focus();
    document.execCommand('insertText', false, token);
    emitFromArea();
  }

  function addLink() {
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    run('createLink', url);
  }

  function addImage() {
    const url = window.prompt('Image URL', 'https://');
    if (!url) return;
    run('insertImage', url);
  }

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <div className="rte-row">
          <ToolBtn title="Source" active={source} onClick={toggleSource}>
            Source
          </ToolBtn>
          <span className="rte-sep" />
          <ToolBtn title="Undo" onClick={() => run('undo')}>
            ↺
          </ToolBtn>
          <ToolBtn title="Redo" onClick={() => run('redo')}>
            ↻
          </ToolBtn>
          <span className="rte-sep" />
          <ToolBtn title="Bold" onClick={() => run('bold')}>
            <b>B</b>
          </ToolBtn>
          <ToolBtn title="Italic" onClick={() => run('italic')}>
            <i>I</i>
          </ToolBtn>
          <ToolBtn title="Underline" onClick={() => run('underline')}>
            <u>U</u>
          </ToolBtn>
          <ToolBtn title="Strikethrough" onClick={() => run('strikeThrough')}>
            <s>S</s>
          </ToolBtn>
          <ToolBtn title="Remove format" onClick={() => run('removeFormat')}>
            Tx
          </ToolBtn>
          <span className="rte-sep" />
          <ToolBtn title="Numbered list" onClick={() => run('insertOrderedList')}>
            1.
          </ToolBtn>
          <ToolBtn title="Bulleted list" onClick={() => run('insertUnorderedList')}>
            •
          </ToolBtn>
          <ToolBtn title="Outdent" onClick={() => run('outdent')}>
            «
          </ToolBtn>
          <ToolBtn title="Indent" onClick={() => run('indent')}>
            »
          </ToolBtn>
          <span className="rte-sep" />
          <ToolBtn title="Align left" onClick={() => run('justifyLeft')}>
            ≡
          </ToolBtn>
          <ToolBtn title="Align center" onClick={() => run('justifyCenter')}>
            ≣
          </ToolBtn>
          <ToolBtn title="Align right" onClick={() => run('justifyRight')}>
            ≡
          </ToolBtn>
          <ToolBtn title="Justify" onClick={() => run('justifyFull')}>
            ☰
          </ToolBtn>
          <span className="rte-sep" />
          <ToolBtn title="Link" onClick={addLink}>
            🔗
          </ToolBtn>
          <ToolBtn title="Unlink" onClick={() => run('unlink')}>
            ∅
          </ToolBtn>
          <ToolBtn title="Image" onClick={addImage}>
            ▣
          </ToolBtn>
          <ToolBtn title="Horizontal line" onClick={() => run('insertHorizontalRule')}>
            ―
          </ToolBtn>
        </div>
        <div className="rte-row">
          <select
            className="rte-select"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) run('formatBlock', e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">Format</option>
            <option value="p">Paragraph</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="pre">Formatted</option>
          </select>
          <select
            className="rte-select"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) run('fontName', e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">Font</option>
            <option value="Arial">Arial</option>
            <option value="Georgia">Georgia</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier New">Courier New</option>
            <option value="IBM Plex Sans">IBM Plex Sans</option>
          </select>
          <select
            className="rte-select"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) run('fontSize', e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">Size</option>
            <option value="2">Small</option>
            <option value="3">Normal</option>
            <option value="4">Large</option>
            <option value="5">Huge</option>
          </select>
          <ToolBtn title="Text colour" onClick={() => colorRef.current?.click()}>
            A
          </ToolBtn>
          <input
            ref={colorRef}
            type="color"
            className="rte-color"
            defaultValue="#1f2d41"
            onChange={(e) => run('foreColor', e.target.value)}
          />
          <ToolBtn title="Highlight" onClick={() => bgRef.current?.click()}>
            ▮
          </ToolBtn>
          <input
            ref={bgRef}
            type="color"
            className="rte-color"
            defaultValue="#fff4d6"
            onChange={(e) => run('hiliteColor', e.target.value)}
          />
        </div>
      </div>
      {source ? (
        <textarea
          className="rte-source"
          value={sourceText}
          onChange={(e) => {
            setSourceText(e.target.value);
            onChange(e.target.value);
          }}
        />
      ) : (
        <div
          ref={areaRef}
          className="rte-area"
          contentEditable
          suppressContentEditableWarning
          onInput={emitFromArea}
          onBlur={emitFromArea}
        />
      )}
      {placeholders?.length ? (
        <div className="rte-vars">
          {placeholders.map((p) => (
            <button key={p} type="button" className="rte-var" onClick={() => insertPlaceholder(p)}>
              {p}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
