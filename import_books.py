#!/usr/bin/env python3
"""
calc-reader 小说导入脚本 v5
============================
新架构：不内嵌内容，只记录文件路径。
TXT 文件放在 assets/raw/books/ 目录，运行时用 @zos/fs 读取。

内置书 vs 线上书：
  - 内置书：本脚本导入，文件在 assets/raw/books/，写进 LIBRARY，不可在表上删除。
  - 线上书：手机 Zepp App 设置页填 OPENLIST 直链下载，存到手表 /data/，
            登记在 localStorage 的 dl_books，可在书架长右侧「删除」键删除。

阅读器分页（v5 重要变化）：
  - 开书时扫描全文建立「每页起始字节」索引（按 书ID+字号+文件大小 缓存到
    localStorage 的 idx_<id>），页码/跳页/翻页精确一致。
  - 字号有 9 档（13~34），运行时切换会重建索引。
  - 进度存在 localStorage 的 reading_progress（以字节 offset 为准）。

用法：
  1. 把 TXT 小说文件放到 import_books/ 目录
     文件名格式：书名_作者.txt  或  书名.txt（必须 UTF-8 编码）
  2. 运行：python import_books.py
  3. 脚本自动：
     - 复制 TXT 到 assets/raw/books/
     - 更新 page/bookshelf.js 和 page/reader.js 中的 LIBRARY 元数据
  4. 运行：zeus build && zeus preview --target "Amazfit Balance"
  5. 扫码安装
"""

import os
import sys
import shutil

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
IMPORT_DIR = os.path.join(PROJECT_DIR, 'import_books')
ASSETS_BOOKS_DIR = os.path.join(PROJECT_DIR, 'assets', 'raw', 'books')
PLACEHOLDER = '// --LIBRARY-DATA-- (由 import_books.py 自动替换，请勿手动编辑)'

# 需要更新 LIBRARY 的 JS 文件
JS_TARGETS = [
    os.path.join(PROJECT_DIR, 'page', 'bookshelf.js'),
    os.path.join(PROJECT_DIR, 'page', 'reader.js'),
]


def parse_filename(filename):
    """解析文件名 → (书名, 作者)"""
    name = os.path.splitext(filename)[0]
    if '_' in name:
        parts = name.split('_', 1)
        return parts[0].strip(), parts[1].strip()
    return name.strip(), '未知作者'


def read_books():
    """读取 import_books/ 目录下所有 TXT 文件，复制到 assets/raw/books/"""
    books = []
    if not os.path.isdir(IMPORT_DIR):
        print(f'[错误] 目录不存在: {IMPORT_DIR}')
        return books

    txt_files = sorted([f for f in os.listdir(IMPORT_DIR)
                       if f.lower().endswith('.txt') and not f.startswith('.')])
    if not txt_files:
        print(f'[提示] {IMPORT_DIR}/ 目录下没有 .txt 文件')
        return books

    os.makedirs(ASSETS_BOOKS_DIR, exist_ok=True)

    for fname in txt_files:
        src = os.path.join(IMPORT_DIR, fname)
        dst = os.path.join(ASSETS_BOOKS_DIR, fname)
        title, author = parse_filename(fname)

        try:
            shutil.copy2(src, dst)
        except OSError as e:
            print(f'  [错误] 复制失败: {fname} → {e}')
            continue

        size = os.path.getsize(dst)
        print(f'  📖 {title} (作者: {author}) — {size} 字节')
        print(f'     → assets/raw/books/{fname}')

        books.append({
            'id': len(books),
            'title': title,
            'author': author,
            'file': 'raw/books/' + fname,
        })

    return books


def build_library_js(books):
    """生成 var LIBRARY = [...] 的 JS 代码（只含元数据，不含内容）"""
    if not books:
        return 'var LIBRARY = []\n'

    lines = ['var LIBRARY = [']
    for book in books:
        lines.append('  {')
        lines.append(f'    id: {book["id"]},')
        lines.append(f'    title: "{book["title"]}",')
        lines.append(f'    author: "{book["author"]}",')
        lines.append(f'    file: "{book["file"]}",')
        lines.append('  },')
    lines.append(']\n')
    return '\n'.join(lines)


def update_js_file(js_path, library_js):
    """替换 JS 文件中 PLACEHOLDER 后的 var LIBRARY = [...] 部分"""
    fname = os.path.basename(js_path)

    with open(js_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if PLACEHOLDER not in content:
        print(f'  ⚠️  {fname}: 找不到占位符，跳过')
        return False

    lines = content.split('\n')

    # 1. 找到占位符行
    placeholder_idx = None
    for i, line in enumerate(lines):
        if PLACEHOLDER in line:
            placeholder_idx = i
            break

    if placeholder_idx is None:
        return False

    # 2. 找到占位符后的 var LIBRARY = [ 行
    lib_start = None
    for i in range(placeholder_idx + 1, len(lines)):
        if 'var LIBRARY = [' in lines[i]:
            lib_start = i
            break

    if lib_start is None:
        print(f'  ⚠️  {fname}: 占位符后找不到 var LIBRARY = [')
        return False

    # 3. 找到匹配的 ] （括号深度计数）
    lib_end = None
    depth = 0
    for i in range(lib_start, len(lines)):
        for ch in lines[i]:
            if ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
        if depth == 0:
            lib_end = i
            break

    if lib_end is None:
        print(f'  ⚠️  {fname}: 找不到 LIBRARY 数组的结束 ]')
        return False

    # 4. 替换：保留占位符行，用新的 library_js 替换旧的 LIBRARY 数组
    new_lines = (
        lines[:lib_start]
        + [library_js.rstrip('\n')]
        + lines[lib_end + 1:]
    )

    new_content = '\n'.join(new_lines)
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f'  ✅ {fname}: 已更新 {library_js.count("id:")} 本书')
    return True


def main():
    print('=== calc-reader 小说导入脚本 v5 ===\n')
    print(f'项目目录  : {PROJECT_DIR}')
    print(f'扫描目录  : {IMPORT_DIR}')
    print(f'书籍存储  : {ASSETS_BOOKS_DIR}')
    print(f'更新目标  : {len(JS_TARGETS)} 个文件\n')

    # 读取并复制书籍
    books = read_books()
    if not books:
        print('\n[提示] 没有读取到任何小说文件')
        print(f'  1. 请将 .txt 文件放入 {IMPORT_DIR}/ 目录')
        print(f'  2. 文件名格式: 书名_作者.txt')
        return

    # 生成 LIBRARY 代码
    print(f'\n共 {len(books)} 本书，生成元数据代码...')
    library_js = build_library_js(books)
    print(f'  代码长度: {len(library_js)} 字符\n')

    # 更新所有 JS 文件
    print('更新 JS 文件:')
    all_ok = True
    for js_path in JS_TARGETS:
        if not update_js_file(js_path, library_js):
            all_ok = False

    if all_ok:
        print(f'\n✅ 全部完成！')
        print(f'  📚 {len(books)} 本书已导入')
        print(f'  📁 TXT 文件 → {ASSETS_BOOKS_DIR}')
        print(f'  📝 bookshelf.js + reader.js 已更新')
        print(f'\n下一步:')
        print(f'  zeus build && zeus preview --target "Amazfit Balance"')
        print(f'\n💡 提示: import_books/ 里的原始 TXT 可以删除了（已复制到 assets/raw/books/）')
    else:
        print(f'\n⚠️ 部分文件更新失败，请检查后重试')
        sys.exit(1)


if __name__ == '__main__':
    main()
