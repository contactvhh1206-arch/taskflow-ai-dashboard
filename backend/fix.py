import unicodedata

def normalizeString(s):
    if not s: return ""
    return unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode('ascii').lower().strip()

draft_pic = "Hoàng"
searchName = draft_pic.lower().strip()
normalizedSearch = normalizeString(draft_pic)

print("searchName:", searchName)
print("normalizedSearch:", normalizedSearch)

nameStr = "hoang"
emailStr = "hoang"

c1 = normalizedSearch in normalizeString(nameStr)
c2 = normalizedSearch in normalizeString(emailStr)
c3 = searchName in nameStr.lower()
c4 = searchName in emailStr.lower()

print("c1:", c1, "c2:", c2, "c3:", c3, "c4:", c4)
