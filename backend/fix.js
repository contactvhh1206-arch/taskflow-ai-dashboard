const allUsers = [
  { id: 12, name: "hoang", username: "hoang", role: "FINANCE_DEPT" },
  { id: 13, name: "Thiện", username: "@thien", role: "DEPARTMENT_HEAD" }
];

const draft = { pic: "Hoàng" };

const searchName = draft.pic.toLowerCase().trim();
const normalizeString = (str) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : "";
const normalizedSearch = normalizeString(draft.pic);

console.log("searchName:", searchName);
console.log("normalizedSearch:", normalizedSearch);

const foundUser = allUsers.find(u => {
  const nameStr = u.name || u.full_name || '';
  const emailStr = u.email || u.username || '';
  console.log("Checking user:", u.name, "nameStr:", nameStr, "emailStr:", emailStr);
  console.log("  normalizeString(nameStr):", normalizeString(nameStr));
  console.log("  normalizeString(emailStr):", normalizeString(emailStr));
  const c1 = normalizeString(nameStr).includes(normalizedSearch);
  const c2 = normalizeString(emailStr).includes(normalizedSearch);
  const c3 = nameStr.toLowerCase().includes(searchName);
  const c4 = emailStr.toLowerCase().includes(searchName);
  console.log("  c1:", c1, "c2:", c2, "c3:", c3, "c4:", c4);
  return c1 || c2 || c3 || c4;
});

console.log("Found:", foundUser);
