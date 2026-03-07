import { useMemo } from 'react';

/**
 * Lightweight markdown renderer for chat messages.
 * Supports: bold, italic, code, code blocks, headings, lists, tables, links, blockquotes, hr.
 * No external dependency — renders to Tailwind-styled HTML.
 */

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(text) {
  // Bold + italic
  let result = text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>');
  // Inline code
  result = result.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-indigo-600 underline hover:text-indigo-800">$1</a>');
  return result;
}

/**
 * Build a nested tree from flat list items with indent levels.
 * Each node: { content: string, children: node[] }
 */
function buildNestedList(rawItems) {
  const root = [];
  const stack = [{ children: root, indent: -1 }];

  for (const { indent, text } of rawItems) {
    const node = { content: renderInline(text), children: [] };

    // Pop stack until we find a parent with smaller indent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    stack[stack.length - 1].children.push(node);
    stack.push({ children: node.children, indent });
  }

  return root;
}

function parseMarkdown(md) {
  const lines = md.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', lang, content: escapeHtml(codeLines.join('\n')) });
      continue;
    }

    // Table detection
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      // Parse header
      const parseRow = (row) => row.split('|').map(c => c.trim()).filter(c => c !== '');
      const header = parseRow(tableLines[0]);
      // Skip separator (line 1)
      const rows = tableLines.slice(2).map(parseRow);
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, content: renderInline(headingMatch[2]) });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('> ')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', content: renderInline(quoteLines.join(' ')) });
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const rawItems = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        const indent = lines[i].match(/^(\s*)/)[1].length;
        const text = lines[i].replace(/^\s*[-*+]\s/, '');
        rawItems.push({ indent, text });
        i++;
      }
      blocks.push({ type: 'ul', items: buildNestedList(rawItems) });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const rawItems = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const indent = lines[i].match(/^(\s*)/)[1].length;
        const text = lines[i].replace(/^\s*\d+\.\s/, '');
        rawItems.push({ indent, text });
        i++;
      }
      blocks.push({ type: 'ol', items: buildNestedList(rawItems) });
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty lines
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^#{1,4}\s/.test(lines[i]) && !/^\s*[-*+]\s/.test(lines[i]) && !/^\s*\d+\.\s/.test(lines[i]) && !lines[i].trimStart().startsWith('```') && !lines[i].trimStart().startsWith('> ') && !/^(-{3,}|_{3,}|\*{3,})\s*$/.test(lines[i].trim())) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'p', content: renderInline(paraLines.join(' ')) });
    }
  }

  return blocks;
}

function NestedList({ items, ordered, isRoot }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`${isRoot ? 'mb-2' : 'mt-0.5'} space-y-0.5 ${ordered ? 'list-decimal' : 'list-disc'} list-outside pl-5 text-slate-700`}>
      {items.map((item, i) => (
        <li key={i} className="text-sm">
          <span dangerouslySetInnerHTML={{ __html: item.content }} />
          {item.children?.length > 0 && (
            <NestedList items={item.children} ordered={ordered} />
          )}
        </li>
      ))}
    </Tag>
  );
}

function BlockRenderer({ block }) {
  switch (block.type) {
    case 'p':
      return <p className="mb-2 last:mb-0" dangerouslySetInnerHTML={{ __html: block.content }} />;

    case 'heading': {
      const sizes = { 1: 'text-base font-bold', 2: 'text-sm font-bold', 3: 'text-sm font-semibold', 4: 'text-xs font-semibold' };
      return <div className={`${sizes[block.level] || sizes[3]} text-slate-900 mt-3 mb-1.5 first:mt-0`} dangerouslySetInnerHTML={{ __html: block.content }} />;
    }

    case 'code':
      return (
        <div className="my-2 rounded-lg overflow-hidden">
          {block.lang && (
            <div className="bg-slate-700 text-slate-300 text-[10px] px-3 py-1 font-mono">{block.lang}</div>
          )}
          <pre className="bg-slate-800 text-slate-200 text-[11px] px-3 py-2 overflow-x-auto font-mono leading-relaxed">
            <code dangerouslySetInnerHTML={{ __html: block.content }} />
          </pre>
        </div>
      );

    case 'ul':
      return <NestedList items={block.items} ordered={false} isRoot />;

    case 'ol':
      return <NestedList items={block.items} ordered isRoot />;

    case 'table':
      return (
        <div className="my-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="text-[11px] w-full">
            <thead>
              <tr className="bg-slate-100">
                {block.header.map((h, i) => (
                  <th key={i} className="px-2 py-1.5 text-left font-semibold text-slate-700 border-b border-slate-200" dangerouslySetInnerHTML={{ __html: renderInline(h) }} />
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1 text-slate-600 border-b border-slate-100" dangerouslySetInnerHTML={{ __html: renderInline(cell) }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'blockquote':
      return (
        <blockquote className="my-2 pl-3 border-l-2 border-indigo-300 text-slate-600 italic" dangerouslySetInnerHTML={{ __html: block.content }} />
      );

    case 'hr':
      return <hr className="my-3 border-slate-200" />;

    default:
      return null;
  }
}

export default function ChatMarkdown({ content }) {
  const blocks = useMemo(() => parseMarkdown(content || ''), [content]);

  return (
    <div className="chat-markdown">
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </div>
  );
}
