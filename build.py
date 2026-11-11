#!/usr/bin/env python3
"""รวม src/index.src.html + src/*.js เป็น index.html ไฟล์เดียว:  python3 build.py"""
import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
h = (src / 'index.src.html').read_text(encoding='utf8')
for f in ['lotto-core.js', 'templates.js', 'app.js']:
    tag = '<script src="%s"></script>' % f
    assert tag in h, tag
    h = h.replace(tag, '<script>\n' + (src / f).read_text(encoding='utf8').replace('</script>', '<\\/script>') + '\n</script>')
(root / 'index.html').write_text(h, encoding='utf8')
print('index.html', len(h))
