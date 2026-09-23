
import re
from pathlib import Path

def fix_dart_file(path):
    text = Path(path).read_text(encoding='utf-8', errors='ignore')
    orig = text
    
    # Fix common duplicate _ patterns
    text = re.sub(r'\(\s*_\s*,\s*_\s*\)', '(_, __)', text)
    text = re.sub(r'\(\s*_\s*,\s*_\s*,\s*_\s*\)', '(_, __, ___ )', text)
    text = re.sub(r'\(\s*_\s*,\s*__\s*,\s*__\s*\)', '(_, __, ___ )', text)
    
    lines = text.split('\n')
    new_lines = []
    for line in lines:
        if line.count('_') >= 2 and '(' in line and ')' in line and '=>' in line:
            m = re.search(r'\(([^)]*)\)\s*=>', line)
            if m:
                inside = m.group(1)
                if inside.count('_') > 1 and ',' in inside:
                    parts = [p.strip() for p in inside.split(',')]
                    seen = set()
                    new_parts = []
                    for p in parts:
                        if p == '_':
                            if '_' not in seen:
                                new_parts.append('_')
                                seen.add('_')
                            elif '__' not in seen:
                                new_parts.append('__')
                                seen.add('__')
                            else:
                                new_parts.append('___')
                        else:
                            new_parts.append(p)
                            if p.startswith('_'):
                                seen.add(p)
                    new_inside = ', '.join(new_parts)
                    line = line.replace(m.group(1), new_inside, 1)
        new_lines.append(line)
    text = '\n'.join(new_lines)
    
    if text != orig:
        Path(path).write_text(text, encoding='utf-8')
        return True
    return False

fixed = 0
for p in Path('lib/screens').rglob('*.dart'):
    if fix_dart_file(p):
        print(f"Fixed {p}")
        fixed += 1

print(f"Done {fixed} files")
