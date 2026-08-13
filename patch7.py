path = r"frontend\src\App.jsx"
with open(path, encoding="utf-8") as f:
    content = f.read()

old1 = "import MemoTab from './components/MemoTab';"
new1 = "import MemoTab from './components/MemoTab';\nimport BackgroundRemoveTab from './components/BackgroundRemoveTab';"

old2 = "    { key: 'memo', label: '메모장', icon: '📝' },\n  ];"
new2 = "    { key: 'memo', label: '메모장', icon: '📝' },\n    { key: 'bg_remove', label: '배경 제거', icon: '🖼️' },\n  ];"

old3 = "{activeTab === 'memo' && <MemoTab />}"
new3 = "{activeTab === 'memo' && <MemoTab />}\n            {activeTab === 'bg_remove' && <BackgroundRemoveTab />}"

n1 = content.count(old1)
n2 = content.count(old2)
n3 = content.count(old3)
print("import:", n1, "/ nav:", n2, "/ render:", n3)
if n1 == 1 and n2 == 1 and n3 == 1:
    content = content.replace(old1, new1).replace(old2, new2).replace(old3, new3)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("완료")
else:
    print("매칭 실패")
