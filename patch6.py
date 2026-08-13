path = r"frontend\src\App.jsx"
with open(path, encoding="utf-8") as f:
    content = f.read()

old1 = "import ProductMappingTab from './components/ProductMappingTab';"
new1 = "import ProductMappingTab from './components/ProductMappingTab';\nimport MemoTab from './components/MemoTab';"

old2 = "    { key: 'product_mapping', label: '상품명 매핑', icon: '🔗' },\n  ];"
new2 = "    { key: 'product_mapping', label: '상품명 매핑', icon: '🔗' },\n    { key: 'memo', label: '메모장', icon: '📝' },\n  ];"

old3 = "{activeTab === 'product_mapping' && <ProductMappingTab />}"
new3 = "{activeTab === 'product_mapping' && <ProductMappingTab />}\n            {activeTab === 'memo' && <MemoTab />}"

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
