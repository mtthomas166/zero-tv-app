
import os, re, glob

def fix_file(path):
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    original = content

    # Fix ??? -> ? ??
    content = content.replace('as Map???', 'as Map? ??')
    content = content.replace('as Map ???', 'as Map? ??')
    content = content.replace(')??', ') ??')
    content = content.replace('?? const', ' ?? const')
    
    # Fix duplicate _ in params like (_, _) -> (_, __)
    # This is the main error at detail_screen:397,399 and home_screen:306,499,501
    content = re.sub(r'\(\s*_\s*,\s*_\s*\)', '(_, __)', content)
    content = re.sub(r'\(\s*_\s*,\s*_\s*,\s*_\s*\)', '(_, __, ___ )', content)
    content = re.sub(r'\(\s*_\s*,\s*__\s*,\s*__\s*\)', '(_, __, ___ )', content)
    
    # Fix (_, _, __) patterns that cause triple duplicate
    # More general: if line has builder: (_, _) replace second
    # We do simple line-based fix for the reported lines
    lines = content.split('
')
    new_lines = []
    for line in lines:
        # if line contains (_, _) or (_, _, _) replace
        if '_, _' in line and '=>' in line or 'builder' in line.lower():
            # replace second _ in same parentheses
            # count _ inside ()
            m = re.search(r'\(([^)]*)\)', line)
            if m and m.group(1).count('_') > 1:
                inside = m.group(1)
                parts = [p.strip() for p in inside.split(',')]
                seen = set()
                new_parts = []
                counter = 0
                for p in parts:
                    if p == '_' and '_' in seen:
                        counter += 1
                        new_parts.append('__' * counter)
                    elif p == '__' and '__' in seen:
                        counter += 1
                        new_parts.append('__' * (counter+1))
                    else:
                        new_parts.append(p)
                        if p in ['_', '__', '___']:
                            seen.add(p)
                line = line.replace(inside, ', '.join(new_parts))
        new_lines.append(line)
    content = '
'.join(new_lines)

    # Remove unused import that causes warning
    content = content.replace("import 'package:flutter/services.dart';
", "")

    if content != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed: {path}")
        return True
    return False

# Fix all dart files
count = 0
for path in glob.glob('lib/**/*.dart', recursive=True):
    if fix_file(path):
        count += 1

print(f"\nDone! Fixed {count} files")
print("Now run: flutter pub get && flutter analyze")
