import matter from 'gray-matter';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  description: string;
  sections: Map<string, string>;
  raw: string;
}

export function parseMarkdownFile(filepath: string): ParsedMarkdown {
  const raw = readFileSync(filepath, 'utf-8');
  return parseMarkdownString(raw);
}

export function parseMarkdownString(raw: string): ParsedMarkdown {
  const { data, content } = matter(raw);

  const description = extractFirstParagraph(content);
  const sections = extractSections(content);

  return { data, description, sections, raw };
}

function extractFirstParagraph(content: string): string {
  const lines = content.split('\n');
  const paragraphLines: string[] = [];
  let foundHeading = false;

  for (const line of lines) {
    if (line.startsWith('#')) {
      foundHeading = true;
      continue;
    }
    if (foundHeading && line.trim() === '' && paragraphLines.length > 0) {
      break;
    }
    if (foundHeading && line.trim() !== '') {
      paragraphLines.push(line.trim());
    }
  }

  return paragraphLines.join(' ');
}

function extractSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');
  let currentSection = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n').trim());
      }
      currentSection = line.slice(3).trim();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n').trim());
  }

  return sections;
}

export interface SkillParsed {
  id: string;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  tokenCostHint: string;
  icon: string;
}

export function parseSkillsFromSection(sectionContent: string): SkillParsed[] {
  const skills: SkillParsed[] = [];
  const lines = sectionContent.split('\n').filter((l) => l.startsWith('- **'));
  let idx = 0;

  for (const line of lines) {
    idx++;
    // Pattern: - **Name** (category) - Description [enabled] ~cost
    const match = line.match(
      /^- \*\*(.+?)\*\*\s*\((.+?)\)\s*-\s*(.+?)\s*\[(enabled|disabled)\]\s*(.*)$/
    );
    if (match) {
      skills.push({
        id: `s${idx}`,
        name: match[1],
        category: match[2],
        description: match[3].trim(),
        enabled: match[4] === 'enabled',
        tokenCostHint: match[5]?.trim() || '',
        icon: '',
      });
    }
  }

  return skills;
}

export interface TaskStepParsed {
  id: string;
  label: string;
  timestamp: string;
  completed: boolean;
  current?: boolean;
}

export function parseStepsFromSection(sectionContent: string): TaskStepParsed[] {
  const steps: TaskStepParsed[] = [];
  const lines = sectionContent.split('\n').filter((l) => /^- \[[ x]\]/.test(l));
  let idx = 0;

  for (const line of lines) {
    idx++;
    const completed = line.includes('[x]');
    const current = line.includes('**<-- current**');
    let label = line
      .replace(/^- \[[ x]\]\s*/, '')
      .replace(/\s*\*\*<-- current\*\*/, '')
      .trim();

    // Extract timestamp from parentheses at end
    let timestamp = '';
    const tsMatch = label.match(/\(([^)]+)\)$/);
    if (tsMatch) {
      timestamp = tsMatch[1];
      label = label.replace(/\s*\([^)]+\)$/, '').trim();
    }

    steps.push({
      id: `s${idx}`,
      label,
      timestamp,
      completed,
      ...(current && { current }),
    });
  }

  return steps;
}

export function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(dir, f));
}

export function getIdFromFilename(filepath: string): string {
  return basename(filepath, '.md');
}
