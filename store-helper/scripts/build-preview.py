"""아이폰 미리보기용 한 파일짜리 HTML을 만듭니다 (예시 데이터만 사용).

사용법: python3 scripts/build-preview.py <출력 파일>
web/index.html, style.css, demo-data.js, app.js 를 합쳐서 Artifact로 게시할 수 있게 만듭니다.
"""
import pathlib
import sys

web = pathlib.Path(__file__).resolve().parent.parent / 'web'
html = (web / 'index.html').read_text()
body = html[html.index('<body>') + 6:html.index('</body>')]
body = body.replace('<script src="demo-data.js"></script>',
                    '<script>window.PREVIEW = true;\n' + (web / 'demo-data.js').read_text() + '</script>')
body = body.replace('<script src="app.js"></script>', '<script>' + (web / 'app.js').read_text() + '</script>')
head = ('<title>생강청 주문도우미</title>\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Do+Hyeon&family=IBM+Plex+Sans+KR:wght@400;600&display=swap">\n'
        '<style>' + (web / 'style.css').read_text() + '</style>\n')
pathlib.Path(sys.argv[1]).write_text(head + body)
print('만들었습니다:', sys.argv[1])
