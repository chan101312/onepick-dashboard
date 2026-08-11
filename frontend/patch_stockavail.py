path = r"frontend\src\App.jsx"
with open(path, encoding="utf-8") as f:
    content = f.read()

old1 = "import TodoListTab from \"./components/TodoListTab\";"
new1 = "import TodoListTab from \"./components/TodoListTab\";\nimport StockAvailabilityTab from \"./components/StockAvailabilityTab\";"

old2 = "    { key: \"todo_list\", label: \"투두리스트\", icon: \"✅\" },\n  ];"
new2 = "    { key: \"todo_list\", label: \"투두리스트\", icon: \"✅\" },\n    { key: \"stock_availability\", label: \"재고 가용성\", icon: \"📊\" },\n  ];"

old3 = "{activeTab === \"todo_list\" && <TodoListTab />}"
new3 = "{activeTab === \"todo_list\" && <TodoListTab />}\n            {activeTab === \"stock_availability\" && <StockAvailabilityTab />}"

n1 = content.count(old1)
n2 = content.count(old2)
n3 = content.count(old3)
print("import:", n1, "/ nav:", n2, "/ render:", n3)
if n1 == 1 and n2 == 1 and n3 == 1:
    content = content.replace(old1, new1).replace(old2, new2).replace(old3, new3)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("완료")
