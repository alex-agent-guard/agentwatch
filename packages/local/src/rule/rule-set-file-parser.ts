/**
 * RuleSet 外部文件解析 — 支持 JSON / YAML，供 RuleEngine.loadRuleSetFromFile 使用
 */
import { extname } from 'node:path';

type YamlValue =
  | null
  | boolean
  | number
  | string
  | YamlValue[]
  | { [key: string]: YamlValue };

/**
 * 解析 RuleSet 外部文件内容 — 按扩展名自动选择 JSON / YAML
 * @param raw - 文件原始文本
 * @param filePath - 文件路径（用于扩展名推断）
 * @returns 解析后的 RuleSet 原始对象，由 RuleEngine 校验
 */
export function parseRuleSetFileContent(
  raw: string,
  filePath: string,
): unknown {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.json') {
    return JSON.parse(raw);
  }
  if (extension === '.yaml' || extension === '.yml') {
    return parseYaml(raw);
  }

  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(raw);
  }

  return parseYaml(raw);
}

function parseYaml(content: string): YamlValue {
  const lines = content
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#');
    });

  const { value } = parseYamlBlock(lines, 0, 0);
  return value ?? {};
}

function parseYamlBlock(
  lines: string[],
  startIndex: number,
  indent: number,
): { value: YamlValue; nextIndex: number } {
  if (startIndex >= lines.length) {
    return { value: {}, nextIndex: startIndex };
  }

  const firstLine = lines[startIndex]!;
  const firstIndent = measureIndent(firstLine);
  if (firstIndent < indent) {
    return { value: {}, nextIndex: startIndex };
  }

  if (firstLine.trimStart().startsWith('- ')) {
    return parseYamlArray(lines, startIndex, indent);
  }

  const objectValue: Record<string, YamlValue> = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index]!;
    const lineIndent = measureIndent(line);
    if (lineIndent < indent) {
      break;
    }
    if (lineIndent > indent) {
      throw new Error(`Invalid YAML indentation at line ${index + 1}`);
    }

    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      break;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid YAML mapping at line ${index + 1}`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const remainder = trimmed.slice(separatorIndex + 1).trim();

    if (remainder.length > 0) {
      objectValue[key] = parseYamlScalar(remainder);
      index += 1;
      continue;
    }

    const childStart = index + 1;
    if (childStart >= lines.length) {
      objectValue[key] = {};
      index = childStart;
      continue;
    }

    const childLine = lines[childStart]!;
    const childIndent = measureIndent(childLine);
    if (childIndent <= indent) {
      objectValue[key] = {};
      index = childStart;
      continue;
    }

    if (childLine.trimStart().startsWith('- ')) {
      const parsedArray = parseYamlArray(lines, childStart, childIndent);
      objectValue[key] = parsedArray.value;
      index = parsedArray.nextIndex;
      continue;
    }

    const parsedChild = parseYamlBlock(lines, childStart, childIndent);
    objectValue[key] = parsedChild.value;
    index = parsedChild.nextIndex;
  }

  return { value: objectValue, nextIndex: index };
}

function parseYamlArray(
  lines: string[],
  startIndex: number,
  indent: number,
): { value: YamlValue[]; nextIndex: number } {
  const items: YamlValue[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index]!;
    const lineIndent = measureIndent(line);
    if (lineIndent < indent) {
      break;
    }
    if (lineIndent !== indent || !line.trimStart().startsWith('- ')) {
      break;
    }

    const itemText = line.trimStart().slice(2).trim();
    if (itemText.length === 0) {
      const childStart = index + 1;
      if (childStart < lines.length && measureIndent(lines[childStart]!) > indent) {
        const parsedChild = parseYamlBlock(lines, childStart, indent + 2);
        items.push(parsedChild.value);
        index = parsedChild.nextIndex;
        continue;
      }
      items.push(null);
      index += 1;
      continue;
    }

    const inlineSeparator = itemText.indexOf(':');
    if (inlineSeparator > 0 && !itemText.startsWith('"') && !itemText.startsWith("'")) {
      const childStart = index + 1;
      if (childStart < lines.length && measureIndent(lines[childStart]!) > indent) {
        const objectLine = `${' '.repeat(indent + 2)}${itemText}`;
        const patched = [...lines];
        patched[index] = objectLine;
        const parsedChild = parseYamlBlock(patched, index, indent + 2);
        items.push(parsedChild.value);
        index = parsedChild.nextIndex;
        continue;
      }
    }

    items.push(parseYamlScalar(itemText));
    index += 1;
  }

  return { value: items, nextIndex: index };
}

function measureIndent(line: string): number {
  const match = line.match(/^ */);
  return match?.[0].length ?? 0;
}

function parseYamlScalar(raw: string): YamlValue {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === 'null' || value === '~') {
    return null;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}
